import assert from 'node:assert/strict';
import test from 'node:test';
import { SourceRegistry } from '../src/loop/sources.js';
import { synthesisUserContent } from '../src/loop/prompts.js';

const ARTICLE = [
  'Hybrid retrieval fuses a lexical ranking with a dense one so a support corpus can be searched by meaning and by exact identifier at the same time.',
  'BM25 alone misses a paraphrase, and a dense index alone misses a part number, which is why neither one is enough on its own for a real support corpus.',
  'Reciprocal rank fusion is the usual merge because it needs no score calibration between the two rankers and it is cheap enough to run on every query.'
].join(' ');

const URL = 'https://example.test/hybrid-retrieval';

test('the model-facing rendering wraps a fetched page in <untrusted_source>, but the citation snippet stays plain', () => {
  // Register a candidate exactly the way fetch_page.run does: kind web, a title, the url, and
  // the extracted article text.
  const registry = new SourceRegistry();
  registry.add({ kind: 'web', title: 'Hybrid retrieval, explained', url: URL, text: ARTICLE });

  const query = 'What is hybrid retrieval?';

  // What the model reads at synthesis.
  const modelText = synthesisUserContent({ query, history: [], passages: registry.toPassages(query) });
  assert.match(modelText, /<untrusted_source url="https:\/\/example\.test\/hybrid-retrieval">/, 'the wrapper carries the url');
  assert.match(modelText, /<\/untrusted_source>/, 'the wrapper is closed');

  // What the `sources` SSE event / citation grounding / run log see: the verbatim snippet,
  // never wrapped, since the grader fetches the page itself and checks this string against it.
  const sources = registry.toSources(query);
  assert.equal(sources.length, 1);
  const snippet = sources[0]!.snippet;
  assert.ok(!snippet.includes('<untrusted_source'), 'the citation snippet is not wrapped');
  assert.ok(ARTICLE.includes(snippet), 'the snippet is still a verbatim run of the fetched text');
});
