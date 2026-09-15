import { cachedSearch } from '../cache/search-cache.js';
import { cleanRawContent } from '../providers/tavily.js';
import { str, type Tool, type ToolResult } from './types.js';

/**
 * Search, through the two-tier cache, registering every result as a source candidate.
 *
 * What goes back to the model is a numbered list with the FIRST 300 CHARACTERS of each
 * result, not the whole page. The full text stays in the registry and comes back at
 * synthesis as a chosen passage. That keeps the loop's context small (the cheap part of the
 * bill) and, more importantly, keeps the model from quoting a snippet it half-remembers.
 */
export const webSearch: Tool = {
  name: 'web_search',
  description:
    'Search the web. Returns a numbered list of results; the number is the [n] you cite. ' +
    'Results carry extracted page text where the provider had it.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query. Be specific; one idea per search.' }
    },
    required: ['query'],
    additionalProperties: false
  },

  async run(input, ctx): Promise<ToolResult> {
    const query = str(input.query).trim();
    if (!query) return { ok: false, error: 'web_search needs a non-empty query' };

    const { results, hit } = await cachedSearch(
      ctx.providers.search,
      query,
      { ttlSeconds: ctx.searchCacheTtlSeconds },
      ctx.signal
    );
    ctx.markSearch(hit);

    if (!results.length) {
      // An empty result set is a real outcome and says so. It is NOT an error: an error is
      // when the provider threw, and the two must stay distinguishable (rule A1).
      return { ok: true, content: `No results for "${query}".`, sourcesAdded: [] };
    }

    const added: number[] = [];
    const lines: string[] = [];
    for (const r of results.filter((r) => citableUrl(r.url))) {
      // Cleaned HERE as well as in the provider: the search cache holds results for six hours,
      // and a row written before the cleaning existed still carries the markdown.
      const text = r.content ? cleanRawContent(r.content) : '';
      const n = ctx.sources.add({
        kind: 'web',
        title: r.title,
        url: r.url,
        searchSnippet: r.snippet,
        ...(text ? { text } : {}),
        ...(ctx.subQuestion ? { subQuestion: ctx.subQuestion } : {})
      });
      added.push(n);
      const preview = (r.content ?? r.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      lines.push(`[${n}] ${r.title} — ${r.url} — ${preview}`);
      if (!r.content) lines.push(`     (no page text yet — fetch_page this url before citing [${n}])`);
    }

    return { ok: true, content: lines.join('\n'), sourcesAdded: added };
  }
};

/**
 * Hosts whose "page text" is not in the page. A YouTube result's raw content is the
 * transcript or description; the HTML a grader fetches is a player shell, so a citation to
 * it can never be verified and counts as ungrounded (4 of 18 failures on the first full
 * bench). Login walls are the same story. Such a result is not evidence, so it is not a source.
 */
const UNCITABLE_HOSTS = [
  'youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com',
  'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'linkedin.com'
];

export function citableUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return !UNCITABLE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
