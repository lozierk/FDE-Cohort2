import type { Source } from '@lumina/contract';

/**
 * The source registry, one per request. Two rules do all the work here:
 *
 *  1. Numbers are assigned on FIRST APPEARANCE and never reassigned. The model sees `[3]`
 *     the moment a result is registered and `[3]` still means that page at synthesis, so a
 *     citation cannot drift underneath the text that cites it.
 *  2. The LOOP picks the snippet, never the model. A model-written snippet is a claim about
 *     what a page says; a verbatim passage is evidence, and evidence is what the grounding
 *     check measures (bench: 12 consecutive normalized tokens must be found in the text).
 */

export interface Candidate {
  n: number;
  kind: 'web' | 'doc';
  title: string;
  url?: string;
  docId?: string;
  /** The search result's own snippet. Only ever used if it is verbatim in `text`. */
  searchSnippet?: string;
  /** Fetched page text. A candidate with none of this is not citable. */
  text?: string;
}

export const SNIPPET_MIN = 40;
export const SNIPPET_MAX = 300;

export class SourceRegistry {
  private readonly byKey = new Map<string, Candidate>();
  private readonly order: Candidate[] = [];

  /** Register or update a candidate; returns its stable number. */
  add(input: {
    kind: 'web' | 'doc';
    title: string;
    url?: string;
    docId?: string;
    searchSnippet?: string;
    text?: string;
  }): number {
    const key = input.url ?? input.docId ?? input.title;
    const existing = this.byKey.get(key);
    if (existing) {
      if (input.text && input.text.length > (existing.text?.length ?? 0)) existing.text = input.text;
      if (!existing.searchSnippet && input.searchSnippet) existing.searchSnippet = input.searchSnippet;
      return existing.n;
    }
    const candidate: Candidate = {
      n: this.order.length + 1,
      kind: input.kind,
      title: input.title.trim() || key,
      ...(input.url ? { url: input.url } : {}),
      ...(input.docId ? { docId: input.docId } : {}),
      ...(input.searchSnippet ? { searchSnippet: input.searchSnippet } : {}),
      ...(input.text ? { text: input.text } : {})
    };
    this.byKey.set(key, candidate);
    this.order.push(candidate);
    return candidate.n;
  }

  all(): readonly Candidate[] {
    return this.order;
  }

  byNumber(n: number): Candidate | undefined {
    return this.order.find((c) => c.n === n);
  }

  hasUrl(url: string): boolean {
    return this.byKey.has(url);
  }

  /**
   * The `sources` event: every candidate that has fetched text, with a passage chosen by
   * overlap with the question. Candidates with no text are dropped — the model is told which
   * numbers remain citable — because a citation to a page nobody read is exactly the
   * ungrounded citation this whole design exists to prevent.
   */
  toSources(query: string): Source[] {
    const out: Source[] = [];
    for (const c of this.order) {
      const snippet = chooseSnippet(c, query);
      if (!snippet) continue;
      out.push({
        n: c.n,
        kind: c.kind,
        title: c.title,
        snippet,
        ...(c.url ? { url: c.url } : {}),
        ...(c.docId ? { docId: c.docId } : {})
      });
    }
    return out;
  }

  /**
   * What synthesis reads: for every citable candidate, a longer verbatim window of the fetched
   * text around the chosen snippet. The `sources` event carries the short passage the grounding
   * check verifies; the model gets the surrounding page so the answer is synthesized from
   * fetched text, not from a one-sentence snippet. Same numbers, same candidates, same order.
   */
  toPassages(query: string, maxChars = PASSAGE_MAX, limit = PASSAGE_LIMIT): Passage[] {
    // Rank by query-term overlap and keep the top `limit`. With 17 unranked passages the
    // first real run's synthesis overlooked the one that held the answer; the model can
    // only cite what it is shown, so the citable-numbers line shrinks to match. Numbers
    // are never reassigned, and the kept passages go back in number order.
    const want = new Set(terms(query));
    const scored: { p: Passage; score: number }[] = [];
    for (const c of this.order) {
      const snippet = chooseSnippet(c, query);
      if (!snippet || !c.text) continue;
      const text = windowAround(c.text, snippet, maxChars);
      let score = 0;
      for (const t of new Set(terms(text))) if (want.has(t)) score += 1;
      scored.push({ p: { n: c.n, title: c.title, ...(c.url ? { url: c.url } : {}), text }, score });
    }
    scored.sort((a, b) => b.score - a.score || a.p.n - b.p.n);
    return scored
      .slice(0, limit)
      .map((s) => s.p)
      .sort((a, b) => a.n - b.n);
  }
}

export const PASSAGE_MAX = 1500;
/** Passages synthesis reads. Enough for a quick answer to rest on several pages, few enough to be read. */
export const PASSAGE_LIMIT = 8;

export interface Passage {
  n: number;
  title: string;
  url?: string;
  /** Verbatim fetched text, up to PASSAGE_MAX chars, containing the source's snippet. */
  text: string;
}

/** A window of `text` (whitespace-collapsed) of at most `max` chars that contains `snippet`. */
export function windowAround(text: string, snippet: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const idx = clean.indexOf(snippet);
  if (idx < 0) return clean.slice(0, max).trim();
  const slack = Math.max(0, max - snippet.length);
  let start = Math.max(0, idx - Math.floor(slack / 2));
  let end = Math.min(clean.length, start + max);
  if (end - start < max) start = Math.max(0, end - max);
  // Trim to word boundaries so the window never starts or ends mid-word.
  if (start > 0) {
    const sp = clean.indexOf(' ', start);
    if (sp >= 0 && sp < idx) start = sp + 1;
  }
  if (end < clean.length) {
    const sp = clean.lastIndexOf(' ', end);
    if (sp > idx + snippet.length) end = sp;
  }
  return clean.slice(start, end).trim();
}

function chooseSnippet(c: Candidate, query: string): string | null {
  if (c.text && c.text.trim()) return bestPassage(c.text, query);
  // No fetched text. The search snippet is only evidence if it is verbatim in text we read,
  // and by definition we read none — so this candidate is dropped.
  return null;
}

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'of', 'to', 'in', 'on', 'for', 'and', 'or',
  'what', 'who', 'how', 'why', 'when', 'which', 'does', 'do', 'did', 'it', 'that', 'this',
  'with', 'from', 'by', 'as', 'at', 'be', 'can'
]);

export function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/**
 * Split into sentences, score each by query-term overlap, then GROW the winner with its
 * neighbours until it is long enough to be checkable. The bench needs 12 consecutive tokens
 * to match, so a 6-word winning sentence on its own would fail a citation that is perfectly
 * honest. Growing keeps it verbatim: the result is still a contiguous run of the source text.
 */
export function bestPassage(text: string, query: string, max = SNIPPET_MAX, min = SNIPPET_MIN): string | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (clean.length <= max) return clean.length >= 1 ? clean : null;

  const sentences = splitSentences(clean);
  if (!sentences.length) return clean.slice(0, max).trim();

  const want = new Set(terms(query));
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i] ?? '';
    if (s.length > max) continue; // cannot be used whole; prefer one that fits
    let score = 0;
    for (const t of new Set(terms(s))) if (want.has(t)) score += 1;
    // Nudge toward passages already long enough to be verifiable.
    if (s.length >= min) score += 0.5;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  let start = bestIdx;
  let end = bestIdx;
  let passage = (sentences[bestIdx] ?? '').trim();
  if (passage.length > max) passage = passage.slice(0, max).trim();

  // Grow forward first, then backward, never past `max`, and always keeping the run contiguous.
  while (passage.length < min || wordCount(passage) < 12) {
    const nextEnd = end + 1;
    const nextStart = start - 1;
    const forward = nextEnd < sentences.length ? joinRange(sentences, start, nextEnd) : null;
    if (forward && forward.length <= max) {
      end = nextEnd;
      passage = forward;
      continue;
    }
    const backward = nextStart >= 0 ? joinRange(sentences, nextStart, end) : null;
    if (backward && backward.length <= max) {
      start = nextStart;
      passage = backward;
      continue;
    }
    break;
  }

  return passage.length ? passage : null;
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

function joinRange(sentences: string[], from: number, to: number): string {
  return sentences.slice(from, to + 1).join(' ').trim();
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]*\s*/g);
  if (!parts) return [text];
  return parts.map((p) => p.trim()).filter(Boolean);
}
