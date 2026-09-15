import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import type { FakeTurn } from '../src/providers/fake-llm.js';

process.env.RUNS_DIR = mkdtempSync(join(tmpdir(), 'lumina-runs-'));
process.env.MONGODB_URI = '';
process.env.LOG_LEVEL = 'silent';
process.env.LLM_PROVIDER = 'fake';
process.env.WORKER = 'none';

const CORPUS = resolve(import.meta.dirname, '../../../eval/gold/corpus');

const { default: express } = await import('express');
const { AskStreamEvent, Source, newId } = await import('@lumina/contract');
const { askRoutes } = await import('../src/routes/ask.js');
const { threadRoutes } = await import('../src/routes/threads.js');
const { spaceRoutes } = await import('../src/routes/spaces.js');
const { requestId } = await import('../src/routes/context.js');
const { closeDb } = await import('../src/db.js');
const store = await import('../src/store/index.js');
const { putFile } = await import('../src/store/gridfs.js');
const { indexDocument } = await import('../src/ingest/index-document.js');
const { FakeEmbedder } = await import('../src/providers/fake-embeddings.js');
const { FakeLlm } = await import('../src/providers/fake-llm.js');
const { FakeSearch } = await import('../src/providers/fake-search.js');
const { SourceRegistry, locatorKey, mergePieces } = await import('../src/loop/sources.js');
const { fuseRrf } = await import('../src/retrieval/search-chunks.js');
const { default: pino } = await import('pino');

type Providers = Parameters<typeof askRoutes>[0];

const log = pino({ level: 'silent' });
const embedder = new FakeEmbedder();
const providers = { llm: new FakeLlm(), search: new FakeSearch(), embedder };
const useScript = (turns?: FakeTurn[]) => {
  providers.llm = new FakeLlm(turns);
};

let server: ReturnType<ReturnType<typeof express>['listen']>;
let base = '';
let spaceId = '';
const docIds: Record<string, string> = {};

before(async () => {
  const app = express();
  app.use(requestId);
  app.use((req, res, next) =>
    req.path.endsWith('/documents') && req.method === 'POST' ? next() : express.json()(req, res, next)
  );
  app.use(threadRoutes);
  app.use(spaceRoutes);
  app.use(askRoutes(providers as unknown as Providers));
  await store.ensureIndexes();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // One Space with two real corpus documents, indexed by the real job body against the
  // cosine-scan backend with FakeEmbedder vectors. The fake embedder is not semantic, so these
  // tests assert the SHAPE of retrieval — locators, snippets, numbering, trace order — and
  // never that a particular chunk wins. Recall is measured against the real embedder by
  // bin/recall.py.
  const space = await store.createSpace('dev', 'gold');
  spaceId = space._id;
  for (const [filename, mimeType] of [
    ['retrieval-basics.pdf', 'application/pdf'],
    ['agent-loops-and-failure.md', 'text/markdown']
  ] as const) {
    const buffer = readFileSync(join(CORPUS, filename));
    const docId = newId('doc');
    docIds[filename] = docId;
    const fileId = await putFile(buffer, filename, mimeType, { docId, spaceId, userId: 'dev' });
    await store.insertDocument({
      _id: docId,
      spaceId,
      userId: 'dev',
      title: filename,
      mimeType,
      bytes: buffer.byteLength,
      status: 'pending',
      pct: 0,
      fileId,
      createdAt: new Date()
    });
    await indexDocument({ docId, spaceId, userId: 'dev', embedder, log });
  }
});

after(async () => {
  server.close();
  await closeDb();
});

const post = (path: string, body: unknown, user = 'dev') =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': user },
    body: JSON.stringify(body)
  });

async function newThread(): Promise<string> {
  return ((await (await post('/threads', {})).json()) as { threadId: string }).threadId;
}

function parseSse(text: string): { event: string; data: unknown }[] {
  return text
    .split('\n\n')
    .filter((f) => f.trim())
    .map((frame) => {
      const event = frame.match(/^event: (.+)$/m)?.[1] ?? 'message';
      const data = JSON.parse(frame.replace(/^event: .+$/m, '').replace(/^data: /m, '').trim());
      return { event, data };
    });
}

interface SourceRow {
  n: number;
  kind: string;
  title: string;
  snippet: string;
  docId?: string;
  locator?: { page?: number; heading?: string; line?: number };
}

async function ask(body: Record<string, unknown>): Promise<{ frames: { event: string; data: unknown }[] }> {
  const res = await post(`/threads/${await newThread()}/ask`, body);
  const frames = parseSse(await res.text());
  for (const f of frames) AskStreamEvent.parse(f);
  return { frames };
}

const sourcesOf = (frames: { event: string; data: unknown }[]): SourceRow[] =>
  (frames.find((f) => f.event === 'sources')?.data as SourceRow[] | undefined) ?? [];
const tracesOf = (frames: { event: string; data: unknown }[]) =>
  frames.filter((f) => f.event === 'trace').map((f) => f.data as { tool: string; ok: boolean; reason?: string });

// ---------------------------------------------------------------- the tool through a real ask

test('mode=docs searches the Space first and every doc source carries docId, locator and the chunk text', async () => {
  // ONE scripted turn: in docs mode on a fresh thread the preflight answered, so the loop goes
  // straight to synthesis and never asks the model whether to search again.
  useScript([{ text: 'The documents say what they say [1].' }]);
  const { frames } = await ask({ query: 'What is the default value of the k1 parameter?', mode: 'docs', spaceId });

  const traces = tracesOf(frames);
  assert.equal(traces.length, 2, 'memory recall, then the preflight: no research turn after a hit in docs mode');
  assert.equal(traces[0]?.tool, 'recall_memory', 'the loop recalls memory first, on every run');
  assert.equal(traces[1]?.tool, 'search_documents', 'the preflight search is the first retrieval in the trace');
  const answer = frames.filter((f) => f.event === 'token').map((f) => (f.data as { text: string }).text).join('');
  assert.match(answer, /say what they say \[1\]/, 'the single scripted turn was the synthesis');
  assert.equal(traces[1]?.ok, true);
  assert.match(traces[1]?.reason ?? '', /mode=docs/, 'the trace says why the step happened');

  const sources = sourcesOf(frames);
  assert.ok(sources.length > 0, 'the Space produced sources');
  assert.ok(sources.length <= 5, 'RAG_TOP_K caps the first search at five chunks');

  const stored = await (await store.chunks()).find({ spaceId }).toArray();
  for (const s of sources) {
    Source.parse(s);
    assert.equal(s.kind, 'doc');
    assert.ok(s.docId, 'a doc source carries its docId');
    assert.ok(s.locator, 'a doc source carries a locator — without it a citation names nothing');
    assert.ok(
      s.locator!.page !== undefined || s.locator!.heading !== undefined || s.locator!.line !== undefined,
      'the locator is a page, a heading, or a line'
    );
    assert.ok(
      Object.values(docIds).includes(s.docId!),
      'the docId is one of the documents this Space actually holds'
    );
    // The snippet IS the retrieved chunk text of that page/section, verbatim (merged when more
    // than one chunk of the same locator was retrieved): every chunk it came from is a substring
    // of it, and it contains nothing that is not a stored chunk. Locators are unique per source.
    const same = stored.filter((c) => c.docId === s.docId && JSON.stringify(c.locator) === JSON.stringify(s.locator));
    assert.ok(same.some((c) => s.snippet.includes(c.text)), 'the snippet contains at least one stored chunk of that locator verbatim');
    assert.ok(same.length > 0, 'the locator matches stored chunks');
  }
  const keys = sources.map((s) => `${s.docId}#${JSON.stringify(s.locator)}`);
  assert.equal(new Set(keys).size, keys.length, 'no two sources share a docId + locator');

  assert.ok(
    frames.findIndex((f) => f.event === 'sources') < frames.findIndex((f) => f.event === 'token'),
    'sources arrive before the first token'
  );
});

test('at least one doc citation carries locator.page, which is what the bench checks', async () => {
  useScript([{ text: 'ready' }, { text: 'Answer [1].' }]);
  const { frames } = await ask({ query: 'How does BM25 score a document?', mode: 'docs', spaceId });
  const pages = sourcesOf(frames).filter((s) => s.locator?.page !== undefined);
  assert.ok(pages.length > 0, `no doc source carried a page locator: ${JSON.stringify(sourcesOf(frames).map((s) => s.locator))}`);
  assert.ok(pages[0]!.title.endsWith('.pdf'), 'a page locator belongs to the PDF, and the title is its filename');
});

test('mode=auto with a Space attached reaches for the documents on its own, and answers straight from them', async () => {
  // ONE scripted turn: the Space answered, so there is no research turn — the single model
  // call is the synthesis. (Before 2026-09-15 auto kept its turn; on the bench's mode=auto
  // probe the model spent it on a doc-source fetch, a web search and a page fetch: TTFT 6.9 s
  // and 9.4 s deployed, and the eval's smoke gate blocks on a five-sample p95.)
  useScript([{ text: 'From the Space [1].' }]);
  const { frames } = await ask({ query: 'What does the terminated field mean?', mode: 'auto', spaceId });

  const traces = tracesOf(frames);
  assert.equal(traces[1]?.tool, 'search_documents', 'auto searches the Space before the first model turn (after the memory recall)');
  assert.match(traces[1]?.reason ?? '', /mode=auto/);
  assert.equal(traces.length, 2, 'recall, then the Space search: no research step');
  assert.ok(sourcesOf(frames).some((s) => s.kind === 'doc'), 'and it produced a doc source');
  const answer = frames
    .filter((f) => f.event === 'token')
    .map((f) => (f.data as { text: string }).text)
    .join('');
  assert.match(answer, /From the Space \[1\]/, 'the one scripted turn was the synthesis');
});

test('search_documents with no Space is a visible failed step, and the answer cites nothing', async () => {
  // The model reaching for the tool without a Space attached: an honest ok:false step, not an
  // empty result set that would read as "the documents do not say".
  useScript([
    { tool: 'search_documents', input: { query: 'anything' } },
    { text: 'ready' },
    { text: 'No documents are attached to this thread, so I cannot answer from them.' }
  ]);
  const { frames } = await ask({ query: 'What do my documents say?', mode: 'docs' });

  const step = tracesOf(frames).find((t) => t.tool === 'search_documents');
  assert.ok(step, 'the attempt is in the trace');
  assert.equal(step!.ok, false);
  const failed = frames.find((f) => f.event === 'trace' && (f.data as { tool: string }).tool === 'search_documents')!.data as { error?: string };
  assert.match(failed.error ?? '', /no Space is attached/);

  assert.deepEqual(sourcesOf(frames), [], 'nothing is citable');
  const answer = frames
    .filter((f) => f.event === 'token')
    .map((f) => (f.data as { text: string }).text)
    .join('');
  assert.deepEqual(answer.match(/\[\d+\]/g), null, 'and the answer cites nothing');
});

test('an unknown spaceId is a 404 before any streaming starts', async () => {
  useScript([{ text: 'ready' }, { text: 'x' }]);
  const res = await post(`/threads/${await newThread()}/ask`, { query: 'x', mode: 'docs', spaceId: 'spc_nope' });
  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /no space/);

  // Someone else's real space is the same 404.
  useScript([{ text: 'ready' }, { text: 'x' }]);
  const other = await post(`/threads/${await newThread()}/ask`, { query: 'x', mode: 'docs', spaceId }, 'dev');
  assert.equal(other.status, 200, 'the owner is fine');
});

test('a Space with a document still indexing says so instead of pretending it is not there', async () => {
  const space = await store.createSpace('dev', 'half-indexed');
  const docId = newId('doc');
  const body = '# Only section\n\nSome indexed prose about streaming.\n';
  const fileId = await putFile(Buffer.from(body), 'indexed.md', 'text/markdown', {
    docId,
    spaceId: space._id,
    userId: 'dev'
  });
  await store.insertDocument({
    _id: docId,
    spaceId: space._id,
    userId: 'dev',
    title: 'indexed.md',
    mimeType: 'text/markdown',
    bytes: body.length,
    status: 'pending',
    pct: 0,
    fileId,
    createdAt: new Date()
  });
  await indexDocument({ docId, spaceId: space._id, userId: 'dev', embedder, log });

  // A second document that never got a worker.
  await store.insertDocument({
    _id: newId('doc'),
    spaceId: space._id,
    userId: 'dev',
    title: 'still-working.pdf',
    mimeType: 'application/pdf',
    bytes: 10,
    status: 'embedding',
    pct: 50,
    fileId: '000000000000000000000000',
    createdAt: new Date()
  });

  const { searchDocuments } = await import('../src/tools/search-documents.js');
  const registry = new SourceRegistry();
  const result = await searchDocuments.run(
    { query: 'streaming' },
    {
      userId: 'dev',
      threadId: 'thr_x',
      requestId: 'req_x',
      spaceId: space._id,
      depth: 0,
      mode: 'docs',
      providers: providers as unknown as Providers,
      sources: registry,
      searchCacheTtlSeconds: 1,
      markSearch: () => {},
      addEmbeddingTokens: () => {},
      log
    }
  );
  assert.equal(result.ok, true);
  assert.match(
    (result as { content: string }).content,
    /Not yet searchable \(still indexing\): still-working\.pdf \(embedding\)/
  );
});

// ---------------------------------------------------------------- registry and fusion

test('the registry folds chunks of one page into one source, keyed by locator, texts merged in order', () => {
  const reg = new SourceRegistry();
  // Consecutive chunks overlap by construction; the overlap must appear once in the merge.
  const a = reg.add({ kind: 'doc', title: 'r.pdf', docId: 'doc_1', locator: { page: 1 }, ord: 1, text: 'chunk one text with a tail of overlapping words here' });
  const b = reg.add({ kind: 'doc', title: 'r.pdf', docId: 'doc_1', locator: { page: 1 }, ord: 0, text: 'chunk zero text with a tail of overlapping words here' });
  const c = reg.add({ kind: 'doc', title: 'r.pdf', docId: 'doc_1', locator: { page: 2 }, ord: 3, text: 'chunk three text' });
  assert.deepEqual([a, b, c], [1, 1, 2], 'two chunks of page 1 are one source; page 2 is another');

  // The same chunk retrieved twice in one request changes nothing.
  assert.equal(
    reg.add({ kind: 'doc', title: 'r.pdf', docId: 'doc_1', locator: { page: 1 }, ord: 0, text: 'chunk zero text with a tail of overlapping words here' }),
    1
  );

  const sources = reg.toSources('chunk');
  assert.deepEqual(sources.map((s) => s.n), [1, 2]);
  assert.deepEqual(sources.map((s) => s.locator), [{ page: 1 }, { page: 2 }]);
  // Merged in ordinal order (ord 0 before ord 1) regardless of retrieval order, and every
  // chunk's text is still a verbatim substring of the snippet — grounding needs exactly that.
  assert.ok(sources[0]!.snippet.startsWith('chunk zero text'), sources[0]!.snippet);
  assert.ok(sources[0]!.snippet.includes('chunk one text'), sources[0]!.snippet);
  assert.equal(sources[1]!.snippet, 'chunk three text');

  const passages = reg.toPassages('chunk');
  assert.equal(passages.length, 2);
  assert.deepEqual(passages.map((p) => p.title), ['r.pdf, p. 1', 'r.pdf, p. 2'], 'the passage title carries the locator and no url');
  for (const p of passages) assert.equal(p.url, undefined, 'a doc passage has no url');

  assert.equal(locatorKey({ page: 3 }), 'p3');
  assert.equal(locatorKey({ heading: 'The loop' }), 'h:The loop');
  assert.equal(locatorKey({ line: 42 }), 'l42');
});

test('mergePieces drops the shared overlap between consecutive chunks and marks a gap', () => {
  const merged = mergePieces([
    { ord: 0, text: 'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron' },
    { ord: 1, text: 'iota kappa lambda mu nu xi omicron pi rho sigma tau' },
    { ord: 3, text: 'far away text' }
  ]);
  assert.equal(
    merged,
    'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau … far away text'
  );
});

test('RRF fuses two rankers, rewards agreement, and breaks ties on the lower ord', () => {
  const row = (id: string, ord: number) =>
    ({ _id: id, docId: 'doc_1', spaceId: 'spc_1', userId: 'dev', text: id, locator: { page: 1 }, ord }) as Parameters<
      typeof fuseRrf
    >[0][number];

  const dense = [row('a', 5), row('b', 1), row('c', 2)];
  const lexical = [row('c', 2), row('d', 9)];

  const fused = fuseRrf(dense, lexical, 5);
  assert.equal(fused[0]!.chunk._id, 'c', 'the chunk both rankers found wins even from rank 3 and rank 1');
  assert.deepEqual(fused[0]!.ranks, { vector: 3, text: 1 });
  assert.deepEqual(
    fused.map((h) => h.chunk._id),
    ['c', 'a', 'b', 'd'],
    'then dense rank 1, dense rank 2, and the lexical-only chunk last'
  );
  // b (dense rank 2) and d (lexical rank 2) score identically at 1/(60+2); the tie-break is
  // the lower ord, so b (ord 1) comes before d (ord 9).
  assert.equal(fused[2]!.score, fused[3]!.score, 'b and d tie on score');
  assert.equal(fused[2]!.chunk.ord, 1, 'and the lower ord wins the tie');
});

test('RRF keeps at most topK', () => {
  const row = (id: string, ord: number) =>
    ({ _id: id, docId: 'doc_1', spaceId: 'spc_1', userId: 'dev', text: id, locator: { page: 1 }, ord }) as Parameters<
      typeof fuseRrf
    >[0][number];
  const many = Array.from({ length: 12 }, (_, i) => row(`x${i}`, i));
  assert.equal(fuseRrf(many, [], 5).length, 5);
});
