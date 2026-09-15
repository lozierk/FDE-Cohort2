import assert from 'node:assert/strict';
import test from 'node:test';
import { Source } from '@lumina/contract';
import { SNIPPET_MAX, SourceRegistry, bestPassage } from '../src/loop/sources.js';

const PAGE = [
  'Retrieval augmented generation puts the evidence in front of the model instead of trusting it to remember.',
  'Tavily is a search API built for retrieval pipelines, and it returns extracted page text alongside each result.',
  'That extracted text is what an answer should be synthesised from, because a search snippet is an advertisement for a page rather than the page itself.',
  'Caching the search keeps the bill down and has nothing at all to do with grounding.'
].join(' ');

test('the chosen passage is verbatim, within bounds, and long enough to be checkable', () => {
  const snippet = bestPassage(PAGE, 'What is Tavily?');
  assert.ok(snippet, 'a passage was chosen');
  assert.ok(PAGE.includes(snippet!), 'the passage is a contiguous run of the source text');
  assert.ok(snippet!.length <= SNIPPET_MAX, `${snippet!.length} <= ${SNIPPET_MAX}`);
  assert.ok(snippet!.length >= 40, `${snippet!.length} >= 40`);
  assert.ok(snippet!.split(/\s+/).length >= 12, 'at least 12 tokens, which is the grounding window');
  assert.ok(snippet!.toLowerCase().includes('tavily'), 'it picked the passage about the query');
});

test('a short winning sentence is grown with its neighbours rather than returned too short', () => {
  const text = 'Tavily is a search API. It is used inside retrieval pipelines by teams who want the page text and not just the link, which is the part that matters here.';
  const snippet = bestPassage(text, 'Tavily');
  assert.ok(snippet);
  assert.ok(text.includes(snippet!), 'still verbatim after growing');
  assert.ok(snippet!.split(/\s+/).length >= 12);
});

test('candidates keep their number and are never renumbered', () => {
  const reg = new SourceRegistry();
  const a = reg.add({ kind: 'web', title: 'A', url: 'https://a.test', text: PAGE });
  const b = reg.add({ kind: 'web', title: 'B', url: 'https://b.test', searchSnippet: 'only a snippet' });
  const c = reg.add({ kind: 'web', title: 'C', url: 'https://c.test', text: PAGE });
  assert.deepEqual([a, b, c], [1, 2, 3]);
  // Re-registering the same url returns the same number, whatever else changed.
  assert.equal(reg.add({ kind: 'web', title: 'A again', url: 'https://a.test', text: PAGE }), 1);
});

test('a candidate with no fetched text is dropped, and the survivors keep their original numbers', () => {
  const reg = new SourceRegistry();
  reg.add({ kind: 'web', title: 'A', url: 'https://a.test', text: PAGE });
  reg.add({ kind: 'web', title: 'B', url: 'https://b.test', searchSnippet: 'a snippet nobody read' });
  reg.add({ kind: 'web', title: 'C', url: 'https://c.test', text: PAGE });

  const sources = reg.toSources('Tavily');
  assert.deepEqual(sources.map((s) => s.n), [1, 3], 'the unfetched candidate is gone, 3 stays 3');
  for (const s of sources) {
    Source.parse(s);
    assert.ok(PAGE.includes(s.snippet), 'every emitted snippet is verbatim in the fetched text');
  }
});

test('toPassages: same numbers as toSources, longer verbatim window containing the snippet', () => {
  const reg = new SourceRegistry();
  const filler = Array.from({ length: 80 }, (_, i) => `Filler sentence number ${i} says nothing about the topic.`).join(' ');
  reg.add({ kind: 'web', title: 'Long page', url: 'https://example.test/long', text: `${filler} Tavily is a search API built for agents and it returns page content. ${filler}` });
  const sources = reg.toSources('What is Tavily?');
  const passages = reg.toPassages('What is Tavily?');
  assert.equal(passages.length, sources.length);
  assert.equal(passages[0]!.n, sources[0]!.n);
  assert.ok(passages[0]!.text.includes(sources[0]!.snippet), 'window contains the snippet');
  assert.ok(passages[0]!.text.length <= 1500, 'window is capped');
  assert.ok(passages[0]!.text.length > sources[0]!.snippet.length, 'window is longer than the snippet');
});

test('the passage chooser skips a formula or a nav bar and picks the prose next to it', async () => {
  const { looksLikeMarkup } = await import('../src/loop/sources.js');
  assert.equal(looksLikeMarkup('WeightedRRF(d)=r∈R∑​wr​⋅k+rankr​(d)1​ Where d is a document'), true);
  assert.equal(looksLikeMarkup('Reciprocal rank fusion combines two ranked lists by summing one over k plus rank, and it needs no calibration.'), false);
  const text = 'WeightedRRF(d)=r∈R∑​wr​⋅k+rankr​(d)1​ where d ∈ R. Reciprocal rank fusion combines two ranked lists by summing one over k plus rank for every document, and it needs no score calibration between the lists, which is what makes it the default choice for hybrid retrieval. The constant k is usually sixty, which damps the effect of the very top ranks so that one list cannot dominate the other on its own.';
  const snippet = bestPassage(text, 'How does reciprocal rank fusion combine two ranked lists?');
  assert.ok(snippet && !snippet.includes('∑'), `the formula is not the snippet: ${snippet}`);
});
