import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import pino from 'pino';
import { SourceRegistry } from '../src/loop/sources.js';
import { FakeEmbedder } from '../src/providers/fake-embeddings.js';
import { FakeLlm } from '../src/providers/fake-llm.js';
import { FakeSearch } from '../src/providers/fake-search.js';
import { fetchPage } from '../src/tools/fetch-page.js';
import type { ToolContext, ToolResult } from '../src/tools/types.js';

const log = pino({ level: 'silent' });

/**
 * The ToolContext is built the way `runQuickLoop` builds one (src/loop/quick.ts): a fresh
 * `SourceRegistry` per request, `markSearch`/`addEmbeddingTokens` as counters the loop owns.
 * `fetch_page` never searches and never embeds, so those two are no-ops here — but they stay
 * on the object, because a harness that drifts from production is a harness that passes a
 * tool the real loop would break.
 */
function harness(signal?: AbortSignal): { ctx: ToolContext; sources: SourceRegistry } {
  const sources = new SourceRegistry();
  const ctx: ToolContext = {
    userId: 'test-user',
    threadId: 'thr_test',
    requestId: 'req_test',
    depth: 0,
    mode: 'web',
    providers: { llm: new FakeLlm(), search: new FakeSearch(), embedder: new FakeEmbedder() },
    sources,
    searchCacheTtlSeconds: 60,
    markSearch: () => {},
    addEmbeddingTokens: () => {},
    ...(signal ? { signal } : {}),
    log
  };
  return { ctx, sources };
}

/**
 * Register a url as a candidate of THIS request, the way `web_search` would have. Without
 * this the tool refuses the url before any socket opens — which is the point of test (b).
 */
const known = (ctx: ToolContext, url: string): number =>
  ctx.sources.add({ kind: 'web', title: 'A page the search found', url, searchSnippet: 'A short result snippet.' });

function success(result: ToolResult): { content: string; sourcesAdded?: number[] } {
  if (!result.ok) assert.fail(`expected ok:true, got a refusal: ${result.error}`);
  return result;
}

function refusal(result: ToolResult): string {
  if (result.ok) assert.fail(`expected ok:false, got content: ${result.content.slice(0, 120)}`);
  return result.error;
}

// ---------------------------------------------------------------- the local page server

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** Reassigned by each test, so one server serves whatever that test needs. */
let respond: Handler = (_req, res) => {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('no handler for this test');
};

let server: Server;
let base = '';

before(async () => {
  server = createServer((req, res) => respond(req, res));
  server.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  // The abort test deliberately leaves a request hanging; close() on its own would wait for
  // that socket and the test process would never exit.
  server.closeAllConnections();
  server.close();
});

const ARTICLE = [
  'Hybrid retrieval fuses a lexical ranking with a dense one so a support corpus can be searched by meaning and by exact identifier at the same time.',
  'BM25 alone misses a paraphrase, and a dense index alone misses a part number, which is why neither one is enough on its own for a real support corpus.',
  'Reciprocal rank fusion is the usual merge because it needs no score calibration between the two rankers and it is cheap enough to run on every query.'
].join(' ');

const PAGE =
  '<html><head><title>Hybrid retrieval, explained</title></head>' +
  `<body><article><h1>Hybrid retrieval, explained</h1><p>${ARTICLE}</p></article></body></html>`;

const serve = (body: string, contentType = 'text/html; charset=utf-8'): Handler => (_req, res) => {
  res.writeHead(200, { 'content-type': contentType });
  res.end(body);
};

// ---------------------------------------------------------------- the tests

test('a fetched HTML page becomes one citable source, and the tool_result opens with its number', async () => {
  const { ctx, sources } = harness();
  respond = serve(PAGE);
  const url = `${base}/hybrid-retrieval`;
  known(ctx, url);

  const out = success(await fetchPage.run({ url }, ctx));

  // The model is handed `[n] url` first so the number it must cite is the first thing it
  // reads. A preview that opens with prose is a preview the model cites by url, not by [n].
  assert.ok(out.content.startsWith(`[1] ${url}`), `content opened with: ${out.content.slice(0, 80)}`);
  assert.deepEqual(out.sourcesAdded, [1], 'one page fetched, one number spent');

  const all = sources.all();
  assert.equal(all.length, 1, 'the search candidate was UPDATED in place, not registered a second time');
  assert.equal(all[0]!.n, 1, 'and it kept the number it already had');
  // The stored text is the extracted article verbatim — not the preview, not a summary.
  // Grounding is checked against this string, so anything the loop added to it is a false
  // quote waiting to happen.
  const squash = (t: string) => t.replace(/\s+/g, ' ').trim();
  assert.equal(squash(all[0]!.text ?? ''), squash(ARTICLE), 'the article prose, whitespace aside; a Readability bump must not turn this red');
  assert.equal(sources.toSources('hybrid retrieval').length, 1, 'fetched text is what makes a candidate citable');
});

test('a url this request never surfaced is refused by name, before any socket opens', async () => {
  const { ctx, sources } = harness();
  respond = serve(PAGE);
  const url = 'https://not-in-this-request.test/page';

  const error = refusal(await fetchPage.run({ url }, ctx));

  // Rule A1 wants a failed step to say what failed. It also has to name the url: a model that
  // cannot tell which of its two fetches was refused will retry the wrong one.
  assert.match(error, /url not in this request's results/);
  assert.ok(error.includes(url), `the refusal names the url it refused: ${error}`);
  assert.equal(sources.all().length, 0, 'an SSRF attempt registers nothing it could later cite');
});

test('a PDF is refused rather than "extracted": HTML only, whatever the url looks like', async () => {
  const { ctx, sources } = harness();
  respond = serve('%PDF-1.7 binary-ish bytes that Readability would happily mangle', 'application/pdf');
  const url = `${base}/board-deck.pdf`;
  known(ctx, url);

  const error = refusal(await fetchPage.run({ url }, ctx));

  assert.match(error, /reads HTML only/);
  assert.ok(error.includes(url));
  // The first real run turned a PDF into 129 KB of citable garbage. A refusal is a visible
  // failed step; a garbage passage is a quiet one that reaches the reader as a citation.
  assert.equal(sources.toSources('anything').length, 0, 'nothing citable came out of it');
});

test('a page over the 1.5 MB ceiling is refused, so one fat page cannot eat the run', async () => {
  const { ctx } = harness();
  const big = `<html><head><title>Big</title></head><body><p>${'padding '.repeat(200_000)}</p></body></html>`;
  assert.ok(big.length > 1_500_000, 'the fixture really is over the ceiling');
  respond = serve(big);
  const url = `${base}/enormous`;
  known(ctx, url);

  const error = refusal(await fetchPage.run({ url }, ctx));

  assert.match(error, /too large/);
  assert.ok(error.includes(url));
});

test('the caller\'s signal cancels a hanging fetch long before the tool\'s own 8 s timeout', async () => {
  const controller = new AbortController();
  const { ctx, sources } = harness(controller.signal);
  // Headers are never written, so `fetch` itself never resolves. Only the abort can end this.
  respond = () => {};
  const url = `${base}/hangs-forever`;
  known(ctx, url);

  setTimeout(() => controller.abort(), 300);
  const startedAt = Date.now();
  const outcome = await fetchPage.run({ url }, ctx).then(
    (result) => ({ kind: 'resolved' as const, result }),
    (err) => ({ kind: 'rejected' as const, err: err as Error })
  );
  const elapsedMs = Date.now() - startedAt;

  // The request-wide signal is how a closed tab stops costing money. If only the tool's own
  // 8 s timeout could end this, a cancelled request would still hold the socket for 8 s.
  assert.ok(elapsedMs < 1000, `the abort ended it in ${elapsedMs} ms, not at the 8 s tool timeout`);
  if (outcome.kind === 'resolved') {
    assert.equal(outcome.result.ok, false, 'an aborted fetch is a failed step, never a success with no text');
  }
  assert.deepEqual(sources.toSources('anything'), [], 'a cancelled fetch registers no text to cite');
});

test('a page with no extractable text is a failed step, not an empty source', async () => {
  const { ctx, sources } = harness();
  respond = serve('<html><head><title>Nothing here</title></head><body><!-- intentionally empty --></body></html>');
  const url = `${base}/empty`;
  known(ctx, url);

  const error = refusal(await fetchPage.run({ url }, ctx));

  assert.match(error, /no readable text/);
  assert.ok(error.includes(url));
  // The candidate is still in the registry from the search, but with no text it is not
  // citable — which is the whole rule: never cite a page nobody actually read.
  assert.equal(sources.all().length, 1);
  assert.deepEqual(sources.toSources('anything'), []);
});
