import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { str, type Tool, type ToolResult } from './types.js';

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_500_000;

/**
 * Read a page the search already surfaced. Two limits are the point of this tool:
 *
 *  - It refuses a url that is not already a candidate in THIS request. A model that can
 *    fetch arbitrary urls is a server-side request forgery surface and a way to cite a page
 *    that retrieval never found.
 *  - 8 s and 1.5 MB. The wall-clock cap is for the whole run; one slow page must not eat it.
 */
export const fetchPage: Tool = {
  name: 'fetch_page',
  description:
    'Fetch and read one url that appeared in this request\'s search results, for the full ' +
    'page text. Use it when a result had no page text, or when the preview is not enough.',
  input_schema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'A url from this request\'s search results.' } },
    required: ['url'],
    additionalProperties: false
  },

  async run(input, ctx): Promise<ToolResult> {
    const url = str(input.url).trim();
    if (!url) return { ok: false, error: 'fetch_page needs a url' };
    if (!ctx.sources.hasUrl(url)) {
      return { ok: false, error: `url not in this request's results: ${url}` };
    }

    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;

    const res = await fetch(url, { signal, redirect: 'follow', headers: { 'user-agent': 'LuminaBot/0.1' } });
    if (!res.ok) return { ok: false, error: `fetch_page got ${res.status} for ${url}` };

    // HTML only. The first real run fetched a PDF, Readability "extracted" 129 KB of binary,
    // and that became a citable source with a garbage snippet. A refusal is a visible failed
    // step; a garbage passage is a quiet one.
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (type && !HTML_TYPES.has(type)) {
      return { ok: false, error: `fetch_page reads HTML only; ${url} is ${type}` };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (looksBinary(buf)) return { ok: false, error: `fetch_page reads HTML only; ${url} is not text` };
    if (buf.byteLength > MAX_BYTES) {
      return { ok: false, error: `page too large (${buf.byteLength} bytes > ${MAX_BYTES}) for ${url}` };
    }

    const html = buf.toString('utf8');
    const text = extractText(html, url);
    if (!text.trim()) return { ok: false, error: `no readable text extracted from ${url}` };

    const n = ctx.sources.add({
      kind: 'web',
      title: titleOf(html) || url,
      url,
      text,
      ...(ctx.subQuestion ? { subQuestion: ctx.subQuestion } : {})
    });
    const preview = text.replace(/\s+/g, ' ').slice(0, 2000);
    return { ok: true, content: `[${n}] ${url}\n${preview}`, sourcesAdded: [n] };
  }
};

const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/plain']);

/** `%PDF-` or NUL bytes in the first KB: not a page, whatever the server said. */
function looksBinary(buf: Buffer): boolean {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return true;
  const head = buf.subarray(0, 1024);
  let nul = 0;
  for (const b of head) if (b === 0) nul += 1;
  return nul > 8;
}

function extractText(html: string, url: string): string {
  const dom = new JSDOM(html, { url });
  const article = new Readability(dom.window.document).parse();
  if (article?.textContent?.trim()) return article.textContent;
  return dom.window.document.body?.textContent ?? '';
}

function titleOf(html: string): string {
  const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m?.[1]?.trim() ?? '';
}
