import assert from 'node:assert/strict';
import test from 'node:test';
import pino from 'pino';
import { searchLru } from '../src/cache/search-cache.js';
import { SourceRegistry } from '../src/loop/sources.js';
import { FakeEmbedder } from '../src/providers/fake-embeddings.js';
import { FakeLlm } from '../src/providers/fake-llm.js';
import type { SearchProvider, SearchResult } from '../src/providers/search.js';
import { webSearch } from '../src/tools/web-search.js';
import type { ToolContext, ToolResult } from '../src/tools/types.js';

const log = pino({ level: 'silent' });

/**
 * Three results, two carrying `content` and one carrying only a `snippet`. That mix is the
 * real shape of a Tavily response and it is the one the tool has to handle honestly: a
 * result with no page text is a lead, not evidence.
 *
 * `name` is 'fake' on purpose. `cachedSearch` only writes tier-2 rows for a named real
 * provider, so a fake keeps this file off Mongo entirely and tier 1 is what gets measured.
 */
class ThreeResults implements SearchProvider {
  readonly name = 'fake' as const;
  /** Every query that actually reached the provider. A cache hit never appears here. */
  readonly queries: string[] = [];

  constructor(private readonly fixed?: SearchResult[]) {}

  async search(query: string): Promise<SearchResult[]> {
    this.queries.push(query);
    return this.fixed ?? resultsFor(query);
  }
}

function resultsFor(query: string): SearchResult[] {
  const prose = (n: number): string =>
    `${query} is the subject of reference page ${n}, which exists so the tool has real prose ` +
    `to register as a source. A second sentence repeats that ${query} is documented here at ` +
    `enough length that a passage can be chosen out of it and found again in the text it came ` +
    `from, which is what the grounding check measures.`;
  return [
    {
      title: 'Reference page one',
      url: 'https://example.test/web-search/one',
      snippet: `A short result snippet about ${query}.`,
      content: prose(1)
    },
    {
      title: 'Reference page two',
      url: 'https://example.test/web-search/two',
      snippet: `Another short result snippet about ${query}.`,
      content: prose(2)
    },
    {
      // No `content`: the provider surfaced this url but returned no page text for it.
      title: 'Reference page three',
      url: 'https://example.test/web-search/three',
      snippet: `A snippet about ${query} with no extracted page behind it.`
    }
  ];
}

/** Built the way `runQuickLoop` builds one (src/loop/quick.ts), with the counters it owns. */
function harness(search: SearchProvider): {
  ctx: ToolContext;
  sources: SourceRegistry;
  searchHits: boolean[];
} {
  const sources = new SourceRegistry();
  const searchHits: boolean[] = [];
  const ctx: ToolContext = {
    userId: 'test-user',
    threadId: 'thr_test',
    requestId: 'req_test',
    depth: 0,
    mode: 'web',
    providers: { llm: new FakeLlm(), search, embedder: new FakeEmbedder() },
    sources,
    searchCacheTtlSeconds: 60,
    markSearch: (hit) => {
      searchHits.push(hit);
    },
    addEmbeddingTokens: () => {},
    log
  };
  return { ctx, sources, searchHits };
}

function success(result: ToolResult): { content: string; sourcesAdded?: number[] } {
  if (!result.ok) assert.fail(`expected ok:true, got a refusal: ${result.error}`);
  return result;
}

function refusal(result: ToolResult): string {
  if (result.ok) assert.fail(`expected ok:false, got content: ${result.content.slice(0, 120)}`);
  return result.error;
}

const QUERY = 'what hybrid retrieval fixes on a support corpus';

// ---------------------------------------------------------------- the tests

test('every result is numbered, and only the one with no page text is flagged as not yet citable', async () => {
  searchLru.clear();
  const provider = new ThreeResults();
  const { ctx } = harness(provider);

  const out = success(await webSearch.run({ query: QUERY }, ctx));

  assert.deepEqual(out.sourcesAdded, [1, 2, 3], 'all three results are candidates with stable numbers');
  for (const url of ['one', 'two', 'three']) {
    assert.ok(out.content.includes(`https://example.test/web-search/${url}`), `result ${url} is listed`);
  }

  // The flag is the whole reason the snippet-only result is allowed into the list at all:
  // the model is told which number it may NOT cite yet, and what to do about it. Without
  // it the model cites [3] from a one-line snippet and the citation is ungrounded.
  assert.ok(
    out.content.includes('(no page text yet — fetch_page this url before citing [3])'),
    `the snippet-only result carries the flag:\n${out.content}`
  );
  assert.ok(!out.content.includes('citing [1]'), 'a result with page text is not flagged');
  assert.ok(!out.content.includes('citing [2]'), 'a result with page text is not flagged');
});

test('only the results that came with page text are citable sources', async () => {
  searchLru.clear();
  const { ctx, sources } = harness(new ThreeResults());
  await webSearch.run({ query: QUERY }, ctx);

  const citable = sources.toSources(QUERY);
  assert.deepEqual(citable.map((s) => s.n), [1, 2], 'the snippet-only result is registered but not citable');
  assert.deepEqual(citable.map((s) => s.url), [
    'https://example.test/web-search/one',
    'https://example.test/web-search/two'
  ]);
  assert.equal(sources.all().length, 3, 'all three stay in the registry: [3] is fetchable, just not quotable');
  for (const s of citable) {
    assert.ok(s.snippet.trim().length > 0, `source [${s.n}] carries the verbatim passage the answer rests on`);
  }
});

test('an empty query is refused, and never reaches the provider', async () => {
  searchLru.clear();
  const provider = new ThreeResults();
  const { ctx, sources } = harness(provider);

  assert.match(refusal(await webSearch.run({ query: '   ' }, ctx)), /non-empty query/);
  assert.match(refusal(await webSearch.run({}, ctx)), /non-empty query/);

  // A blank search is a model mistake, not a provider call. Sending it anyway costs a search
  // and returns nothing, which is the worst of both.
  assert.deepEqual(provider.queries, [], 'nothing was billed');
  assert.equal(sources.all().length, 0);
});

test('no results is a real outcome with ok:true — an error is when the provider threw (rule A1)', async () => {
  searchLru.clear();
  const { ctx, sources, searchHits } = harness(new ThreeResults([]));

  const out = success(await webSearch.run({ query: 'a query nothing on the web answers' }, ctx));

  assert.match(out.content, /No results/);
  assert.deepEqual(out.sourcesAdded, [], 'an empty result set adds no candidates');
  assert.equal(sources.all().length, 0);
  // The search still happened and still cost money, so it is still counted.
  assert.deepEqual(searchHits, [false]);
});

test('an identical second search is served from the LRU: hit:false then hit:true, one provider call', async () => {
  searchLru.clear();
  const provider = new ThreeResults();
  const { ctx, searchHits } = harness(provider);
  const query = 'how hybrid retrieval fuses two rankings';

  await webSearch.run({ query }, ctx);
  await webSearch.run({ query }, ctx);

  // `markSearch` is what `done.searchCached` is built from, and /stats reports the hit rate
  // off that. If the second call reported a miss the cache would look useless in the numbers
  // even while it was working, which is a metric nobody would then trust.
  assert.deepEqual(searchHits, [false, true], 'cold then warm');
  assert.equal(provider.queries.length, 1, 'the second read never reached the provider');
});
