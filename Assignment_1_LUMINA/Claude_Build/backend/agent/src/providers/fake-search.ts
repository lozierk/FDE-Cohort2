import type { SearchProvider, SearchResult } from './search.js';

/**
 * Two deterministic results whose `content` is a few paragraphs mentioning the query, so the
 * grounding path (snippet chosen verbatim from fetched text) is exercised for real.
 */
export class FakeSearch implements SearchProvider {
  readonly name = 'fake' as const;
  /** Every query this fake was asked. Tests assert against it. */
  readonly queries: string[] = [];

  constructor(private readonly failWith?: string) {}

  async search(query: string): Promise<SearchResult[]> {
    this.queries.push(query);
    if (this.failWith) throw new Error(this.failWith);
    return [page(query, 1), page(query, 2)];
  }
}

function page(query: string, n: number): SearchResult {
  const q = query.trim();
  const content = [
    `${q} is the subject of this page, which exists so the local loop has real prose to quote from.`,
    `The second paragraph explains that ${q} is documented here in enough words that a twelve token ` +
      `window of the passage can be found again inside the fetched text, which is what the grounding ` +
      `check actually measures.`,
    `A third paragraph adds unrelated filler about caching, latency and retrieval so that passage ` +
      `selection has something to choose between rather than one obvious answer.`
  ].join('\n\n');
  return {
    title: `${q} — reference page ${n}`,
    url: `https://example.test/${encodeURIComponent(q.toLowerCase().replace(/\s+/g, '-').slice(0, 60))}/${n}`,
    snippet: `A short result snippet about ${q}.`,
    content
  };
}
