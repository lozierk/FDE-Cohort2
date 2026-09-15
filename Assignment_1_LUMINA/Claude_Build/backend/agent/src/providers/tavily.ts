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
    return (body.results ?? []).map((r) => {
      const content = r.raw_content ? cleanRawContent(r.raw_content) : '';
      return {
        title: r.title || r.url,
        url: r.url,
        snippet: r.content ?? '',
        ...(content ? { content } : {})
      };
    });
  }
}

/**
 * Tavily's `raw_content` is the page as MARKDOWN: `[text](url)`, `![alt](src)`, `# headings`,
 * nav bars rendered as link lists. The bench verifies a citation by fetching the URL itself,
 * stripping tags, and looking for 12 consecutive tokens of our snippet — and a snippet that
 * begins `[Previous](/learn/bm25) [Next](/learn/…` never matches, because the page's HTML
 * text has "Previous Next" and none of the path tokens. The first full bench (2026-09-14)
 * lost 9 of its 18 grounding failures to exactly this. Keep the link text, drop the syntax:
 * what is left is what the HTML's text nodes say, which is what the grader reads.
 */
export function cleanRawContent(md: string): string {
  let s = md.replace(/!\[[^\]]*\]\([^)]*\)/g, ' '); // images: alt text is not page text
  // Links: keep the anchor text, drop the target. Twice, because a linked image or a logo
  // link nests one inside another and the inner one only appears once the outer is gone.
  for (let pass = 0; pass < 2; pass++) s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  return s
    .replace(/\]\([^)]*\)/g, ' ') // a target left behind by a link the passes above could not parse
    .replace(/https?:\/\/\S+/g, ' ') // bare URLs
    .replace(/(^|\s)#{1,6}(?=\s)/g, ' ') // heading markers, at a line start or inline after a strip
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '') // list markers
    .replace(/[*_`>|\\[\]]+/g, ' ') // emphasis, code, quotes, table pipes, stray brackets
    .replace(/\s+/g, ' ')
    .trim();
}

interface TavilyResult {
  title?: string;
  url: string;
  content?: string;
  raw_content?: string | null;
}
