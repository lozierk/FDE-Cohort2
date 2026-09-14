import type { Locator } from '@lumina/contract';
import { env } from '../env.js';

/**
 * Upload bytes → text units that each carry a locator.
 *
 * A "unit" is the smallest span a citation can name honestly: one PDF page, one Markdown
 * section, one window of a plain-text file. Chunking then works INSIDE a unit and never
 * across one (see `chunk.ts`), which is the whole reason page locators are trustworthy: a
 * chunk that straddled pages 3 and 4 would have to cite one of them and be wrong half the time.
 *
 * Nothing here is allowed to fail quietly. A PDF pdfjs cannot open throws; an empty extraction
 * returns zero units and the caller fails the document with "no text could be extracted".
 * A document silently marked `indexed` with nothing in it is the worst outcome available,
 * because it looks exactly like a working one until somebody asks it a question.
 */

export interface ParsedUnit {
  text: string;
  locator: Locator;
}

export type ParseKind = 'pdf' | 'markdown' | 'text';

/** What the bytes are, decided by mime first and filename second. */
export function kindOf(mimeType: string, filename: string): ParseKind {
  const mime = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  const name = filename.toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime === 'text/markdown' || mime === 'text/x-markdown' || name.endsWith('.md') || name.endsWith('.markdown')) {
    return 'markdown';
  }
  return 'text';
}

export async function parse(buffer: Buffer, mimeType: string, filename: string): Promise<ParsedUnit[]> {
  switch (kindOf(mimeType, filename)) {
    case 'pdf':
      return parsePdf(buffer);
    case 'markdown':
      return parseMarkdown(buffer.toString('utf8'), filename);
    default:
      return parseText(buffer.toString('utf8'));
  }
}

// ---------------------------------------------------------------- pdf

/**
 * pdfjs-dist 4.10, the `legacy` build, imported dynamically.
 *
 * `legacy/build/pdf.mjs` is the build that runs on Node without a DOM. It is imported lazily
 * so the request path never pays ~40 ms to load a PDF engine it will not use — only the worker
 * process ever calls parse().
 *
 * The options, each for a reason, all verified on Node 22.17 against
 * `eval/gold/corpus/retrieval-basics.pdf`:
 *   data                   a Uint8Array; pdfjs takes ownership, so never reuse the buffer
 *   useWorkerFetch: false   no worker thread and no network fetch for cmaps/fonts
 *   isEvalSupported: false  never eval() font programs out of an uploaded file
 *   useSystemFonts: false   do not go looking at the host's font directories
 *   verbosity: 0            silence "Ensure that the standardFontDataUrl API parameter is
 *                           provided" per page. We extract text and never render a glyph, so
 *                           a missing font file changes nothing — and 60 such warnings per
 *                           upload buries the log lines that do matter.
 * `disableWorker` was NOT needed: the legacy build falls back to an in-process fake worker on
 * its own, and passing it produced no difference.
 */
async function parsePdf(buffer: Buffer): Promise<ParsedUnit[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0
  }).promise;

  try {
    const units: ParsedUnit[] = [];
    for (let page = 1; page <= doc.numPages; page++) {
      const p = await doc.getPage(page);
      const content = await p.getTextContent();
      let text = '';
      for (const item of content.items) {
        // Marked-content items carry no `str`; text items do. Join with a newline where pdfjs
        // says the line ended and a space otherwise, so sentences survive and the anchor
        // phrases the gold set looks for stay contiguous.
        if (!('str' in item) || typeof item.str !== 'string') continue;
        text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      p.cleanup();
      const collapsed = text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
      if (collapsed) units.push({ text: collapsed, locator: { page } });
    }
    return units;
  } finally {
    await doc.destroy();
  }
}

/** Page count without extracting text — what `documents.pages` reports for a PDF. */
export async function pdfPageCount(buffer: Buffer): Promise<number> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0
  }).promise;
  try {
    return doc.numPages;
  } finally {
    await doc.destroy();
  }
}

// ---------------------------------------------------------------- markdown

/**
 * One unit per ATX heading section. The heading LINE stays as the section's first line on
 * purpose: the gold set's anchor phrases sit in the prose under a heading, and a reader (or a
 * model) handed a chunk with no heading has a paragraph with no subject.
 *
 * Nothing is stripped. Code fences stay as text, because a fenced example is frequently the
 * answer — `X-Accel-Buffering: no` in the streaming document is inside one.
 */
export function parseMarkdown(source: string, filename: string): ParsedUnit[] {
  const lines = source.split(/\r?\n/);
  const units: ParsedUnit[] = [];

  let heading = filename;
  let buf: string[] = [];
  let fenced = false;

  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) units.push({ text, locator: { heading } });
    buf = [];
  };

  for (const line of lines) {
    // A `#` inside a fenced block is a shell comment or a Python comment, not a heading.
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const atx = !fenced ? line.match(/^(#{1,6})\s+(.*)$/) : null;
    if (atx) {
      flush();
      heading = atx[2]?.trim() || filename;
      buf.push(line);
      continue;
    }
    buf.push(line);
  }
  flush();

  return units;
}

// ---------------------------------------------------------------- plain text

/**
 * Windows of `CHUNK_CHARS` broken at line boundaries, each located by its first line number.
 * A line number is the only locator a flat text file can honestly offer, and `Locator` accepts
 * it, so a `.txt` citation is as checkable as a page citation.
 */
export function parseText(source: string): ParsedUnit[] {
  const lines = source.split(/\r?\n/);
  const units: ParsedUnit[] = [];
  let buf: string[] = [];
  let startLine = 1;
  let size = 0;

  const flush = (nextStart: number) => {
    const text = buf.join('\n').trim();
    if (text) units.push({ text, locator: { line: startLine } });
    buf = [];
    size = 0;
    startLine = nextStart;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (size > 0 && size + line.length + 1 > env.chunkChars) flush(i + 1);
    buf.push(line);
    size += line.length + 1;
  }
  flush(lines.length + 1);

  return units;
}
