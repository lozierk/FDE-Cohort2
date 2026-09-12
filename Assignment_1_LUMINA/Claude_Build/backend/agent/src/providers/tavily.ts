import type { SearchProvider, SearchResult } from './search.js';

/**
 * Tavily's REST endpoint directly — no SDK, because the request is one POST and a dependency
 * that wraps one POST is a dependency that can break a build for nothing.
 *
 * `include_raw_content: true` is the point of using Tavily at all: the extracted page text
 * comes back with the result, so the answer is synthesised from the page and `fetch_page` is
 * only needed for the results Tavily could not extract.
 */
export class TavilySearch implements SearchProvider {
  readonly name = 'tavily' as const;

  constructor(private readonly apiKey: string) {}

  async search(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ query, max_results: 5, include_raw_content: true }),
      signal
    });

    if (!res.ok) {
      // Body text, never the key, and never a swallowed empty result set.
      const detail = await res.text().catch(() => '');
      throw new Error(`tavily search failed: ${res.status} ${detail.slice(0, 200)}`);
    }

    const body = (await res.json()) as { results?: TavilyResult[] };
    return (body.results ?? []).map((r) => ({
      title: r.title || r.url,
      url: r.url,
      snippet: r.content ?? '',
      ...(r.raw_content ? { content: r.raw_content } : {})
    }));
  }
}

interface TavilyResult {
  title?: string;
  url: string;
  content?: string;
  raw_content?: string | null;
}
