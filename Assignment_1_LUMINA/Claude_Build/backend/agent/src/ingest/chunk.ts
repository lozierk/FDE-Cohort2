import type { Locator } from '@lumina/contract';
import { env } from '../env.js';
import type { ParsedUnit } from './parse.js';

/**
 * Units → chunk drafts.
 *
 * The one hard rule: a chunk NEVER crosses a unit. Within a PDF page or a Markdown section,
 * fine; across them, never — because the chunk's locator is what a citation shows the reader,
 * and a chunk spanning pages 3 and 4 has to claim one of them and lie about half its text.
 * The bench checks `locator.page === gold.page`, so this rule is also the difference between
 * a recall hit and a miss.
 *
 * Boundaries prefer a sentence end, then a newline, then a word. Overlap is measured backwards
 * from the break so a fact split across a boundary appears whole in one of the two chunks —
 * the reason for overlap at all, and the reason it is 15% rather than a token or two.
 *
 * The chunk's text is stored exactly as it will be shown as the citation snippet. There is no
 * second, prettier version of it anywhere: what retrieval matched, what the model read, and
 * what the reader is shown are one string.
 */

export interface ChunkDraft {
  ord: number;
  text: string;
  locator: Locator;
}

export function chunk(units: ParsedUnit[]): ChunkDraft[] {
  const size = env.chunkChars;
  const overlap = Math.min(env.chunkOverlapChars, Math.max(0, size - 1));
  const out: ChunkDraft[] = [];
  let ord = 0;

  for (const unit of units) {
    for (const text of splitUnit(unit.text, size, overlap)) {
      // Whitespace-only chunks are dropped rather than embedded: an empty vector is a
      // uniformly mediocre match for every query, which is the worst thing to have in an index.
      if (!text.trim()) continue;
      out.push({ ord, text, locator: unit.locator });
      ord += 1;
    }
  }

  return out;
}

/** One unit's text, as windows of at most `size` chars that overlap by about `overlap`. */
function splitUnit(raw: string, size: number, overlap: number): string[] {
  const text = raw.trim();
  if (!text) return [];
  // Short units stay whole. The slack means a 1,100-char page is one chunk, not a 1,000-char
  // chunk plus a 100-char orphan that matches nothing.
  if (text.length <= size + overlap) return [text];

  const parts: string[] = [];
  let start = 0;

  while (start < text.length) {
    const hardEnd = Math.min(text.length, start + size);
    const end = hardEnd >= text.length ? text.length : breakBefore(text, start, hardEnd);
    const piece = text.slice(start, end).trim();
    if (piece) parts.push(piece);
    if (end >= text.length) break;

    // Step the window back by the overlap, then forward to the next word boundary so a chunk
    // never opens mid-word.
    let next = Math.max(start + 1, end - overlap);
    if (next > start && next < text.length) {
      const space = text.indexOf(' ', next);
      if (space > 0 && space - next < overlap) next = space + 1;
    }
    start = next;
  }

  return parts;
}

/**
 * The last sentence end before `hardEnd`, else the last newline, else the last space. Scanning
 * only the final third keeps a chunk from collapsing to a sentence when the text has one long
 * paragraph and one early full stop.
 */
function breakBefore(text: string, start: number, hardEnd: number): number {
  const floor = start + Math.floor((hardEnd - start) * 0.6);
  const window = text.slice(start, hardEnd);

  for (const pattern of [/[.!?]["')\]]?\s/g, /\n/g, / /g]) {
    let best = -1;
    for (const m of window.matchAll(pattern)) {
      const at = start + m.index + m[0].length;
      if (at > floor && at <= hardEnd) best = at;
    }
    if (best > 0) return best;
  }
  return hardEnd;
}
