import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanRawContent } from '../src/providers/tavily.js';
import { citableUrl } from '../src/tools/web-search.js';

// Openings of snippets the first full bench (2026-09-14) could not verify: Tavily's markdown
// rendering of nav bars, image links and headings, none of which is in the page's HTML text.
test('markdown syntax from Tavily raw content is stripped, its visible text kept', () => {
  assert.equal(
    cleanRawContent('[Previous](/learn/search-concepts/bm25) [Next](/learn/search-concepts/retrieval) Reciprocal rank fusion combines lists.'),
    'Previous Next Reciprocal rank fusion combines lists.'
  );
  assert.equal(
    cleanRawContent('![](https://img.test/x.png?auto=format%252Ccompress) # Create a Atlas Vector Search Index with Kubernetes'),
    'Create a Atlas Vector Search Index with Kubernetes'
  );
  assert.equal(cleanRawContent('[! [SerpApi home](/assets/logo.png)](/) ## Pricing\n\n- **Free** plan: 100 searches'), '! SerpApi home Pricing Free plan: 100 searches');
  assert.equal(cleanRawContent('See https://example.test/docs for `code` and _emphasis_.'), 'See for code and emphasis .');
});

test('prose without markdown passes through unchanged apart from whitespace', () => {
  const prose = 'A TTL index isn’t used for traditional indexing functions like optimizing lookups.';
  assert.equal(cleanRawContent(`  ${prose}\n\n`), prose);
});

test('video and login-walled hosts are not citable, everything else is', () => {
  for (const u of [
    'https://www.youtube.com/watch?v=hjbZfVP6g2Q',
    'https://youtu.be/abc',
    'https://m.youtube.com/watch?v=x',
    'https://x.com/someone/status/1',
    'https://www.linkedin.com/posts/x'
  ]) assert.equal(citableUrl(u), false, u);
  for (const u of [
    'https://www.mongodb.com/docs/atlas/atlas-vector-search/',
    'https://brandur.org/fragments/ttl-indexes',
    'https://notyoutube.com/page'
  ]) assert.equal(citableUrl(u), true, u);
  assert.equal(citableUrl('not a url'), false);
});
