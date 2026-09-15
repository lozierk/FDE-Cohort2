import type { Locator, Source } from '@lumina/contract';

/**
 * The source registry, one per request. Two rules do all the work here:
 *
 *  1. Numbers are assigned on FIRST APPEARANCE and never reassigned. The model sees `[3]`
 *     the moment a result is registered and `[3]` still means that page at synthesis, so a
 *     citation cannot drift underneath the text that cites it.
 *  2. The LOOP picks the snippet, never the model. A model-written snippet is a claim about
 *     what a page says; a verbatim passage is evidence, and evidence is what the grounding
 *     check measures (bench: 12 consecutive normalized tokens must be found in the text).
 *
 * Document chunks join the same registry and the same numbering. There is deliberately no
 * second path to a citation number: `search_documents` registers a hit here or the model
 * cannot cite it, which is what makes "never cite something this request did not retrieve"
 * a property of the code rather than a line in a prompt.
 */

export interface Candidate {
  n: number;
  kind: 'web' | 'doc';
  title: string;
  url?: string;
  docId?: string;
  /** Where in the document this chunk is. Doc candidates only, and they all have one. */
  locator?: Locator;
  /**
   * The retrieved chunks of this page/section, by ordinal. Doc candidates only. `text` is
   * their merge (see `mergePieces`), rebuilt whenever a new piece of the same locator arrives.
   */
  pieces?: { ord: number; text: string }[];
  /** The search result's own snippet. Only ever used if it is verbatim in `text`. */
  searchSnippet?: string;
  /** Fetched page text, or a chunk's own text. A candidate with none of this is not citable. */
  text?: string;
  /**
   * Which sub-question of a deep search first turned this up. Set on FIRST appearance and
   * never overwritten, for the same reason `n` is not: a source that changes which
   * sub-question it belongs to halfway through is untraceable. Absent on a quick run.
   */
  subQuestion?: number;
}

/**
 * 160, not 40: the grounding check needs 12 consecutive matching tokens, and a page often
 * serves one token differently from what we read (an apostrophe as `&rsquo;`, which the
 * grader's tag-stripper turns into a space). A 15-token snippet with one such token in the
 * middle has no clean run of 12; a 25-token one has a run on one side of it.
 */
export const SNIPPET_MIN = 160;
export const SNIPPET_MAX = 300;

/** `p3` / `h:Bounded, or not a loop` / `l42`. Part of a doc candidate's dedupe key. */
export function locatorKey(locator?: Locator): string {
  if (!locator) return '';
  if (locator.page !== undefined) return `p${locator.page}`;
  if (locator.heading !== undefined) return `h:${locator.heading}`;
  if (locator.line !== undefined) return `l${locator.line}`;
  return '';
}

export class SourceRegistry {
  private readonly byKey = new Map<string, Candidate>();
  private readonly order: Candidate[] = [];

  /** Register or update a candidate; returns its stable number. */
  add(input: {
    kind: 'web' | 'doc';
    title: string;
    url?: string;
    docId?: string;
    locator?: Locator;
    ord?: number;
    searchSnippet?: string;
    text?: string;
    /** The deep sub-question on whose behalf this tool ran. Quick runs pass nothing. */
    subQuestion?: number;
  }): number {
    // A web page is identified by its url. A document source is identified by document and
    // PLACE in that document (page, heading, or line): every chunk retrieved from page 1 of
    // one PDF folds into one source, with the chunks' texts merged in reading order. One
    // citation per page is what the reader expects ("board-deck.pdf, p. 14"), and it keeps
    // locators unique across the sources list, which the grounding check keys on.
    const key =
      input.kind === 'doc'
        ? `${input.docId ?? input.title}#${locatorKey(input.locator)}`
        : (input.url ?? input.docId ?? input.title);
    const existing = this.byKey.get(key);
    if (existing) {
      if (input.kind === 'doc' && input.text) {
        const ord = input.ord ?? existing.pieces?.length ?? 0;
        existing.pieces ??= [];
        if (!existing.pieces.some((p) => p.ord === ord)) {
          existing.pieces.push({ ord, text: input.text });
          existing.text = mergePieces(existing.pieces);
        }
      } else if (input.text && input.text.length > (existing.text?.length ?? 0)) {
        existing.text = input.text;
      }
      if (!existing.searchSnippet && input.searchSnippet) existing.searchSnippet = input.searchSnippet;
      // Deliberately NOT updated: two sub-questions finding the same page is the dedupe
      // working, and the answer should credit whichever one went looking for it first.
      return existing.n;
    }
    const candidate: Candidate = {
      n: this.order.length + 1,
      kind: input.kind,
      title: input.title.trim() || key,
      ...(input.url ? { url: input.url } : {}),
      ...(input.docId ? { docId: input.docId } : {}),
      ...(input.locator ? { locator: input.locator } : {}),
      ...(input.kind === 'doc' && input.text ? { pieces: [{ ord: input.ord ?? 0, text: input.text }] } : {}),
      ...(input.searchSnippet ? { searchSnippet: input.searchSnippet } : {}),
      ...(input.text ? { text: input.text } : {}),
      ...(input.subQuestion ? { subQuestion: input.subQuestion } : {})
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
        ...(c.docId ? { docId: c.docId } : {}),
        // The locator is the whole value of a document citation. Without it a reader is told
        // "it is somewhere in this 40-page PDF", which is not a citation.
        ...(c.locator ? { locator: c.locator } : {}),
        // Deep merges several result sets into one numbering; without this a reader cannot
        // tell why a source is in the list. The bench checks every source carries it.
        ...(c.subQuestion ? { subQuestion: c.subQuestion } : {})
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
    return this.rank(this.order, query, maxChars, limit);
  }

  /**
   * The same ranking, over ONE sub-question's own candidates. Deep synthesis gives each
   * sub-question a fixed share of what the model reads, so a sub-question that found three
   * good pages is not crowded out by one that found fifteen mediocre ones.
   */
  toPassagesFor(subQuestion: number, query: string, limit: number, maxChars = PASSAGE_MAX): Passage[] {
    return this.rank(this.order.filter((c) => c.subQuestion === subQuestion), query, maxChars, limit);
  }

  private rank(candidates: readonly Candidate[], query: string, maxChars: number, limit: number): Passage[] {
    // Rank by query-term overlap and keep the top `limit`. With 17 unranked passages the
    // first real run's synthesis overlooked the one that held the answer; the model can
    // only cite what it is shown, so the citable-numbers line shrinks to match. Numbers
    // are never reassigned, and the kept passages go back in number order.
    const want = new Set(terms(query));
    const scored: { p: Passage; score: number }[] = [];
    for (const c of candidates) {
      const snippet = chooseSnippet(c, query);
      if (!snippet || !c.text) continue;
      // A doc passage is the whole chunk, and its title carries the locator: the chunk is
      // already the right size, and windowing it would mean the model reads one thing while
      // the reader is shown another.
      const text = c.kind === 'doc' ? c.text : windowAround(c.text, snippet, maxChars);
      let score = 0;
      for (const t of new Set(terms(text))) if (want.has(t)) score += 1;
      scored.push({
        p: {
          n: c.n,
          title: c.kind === 'doc' ? passageTitle(c) : c.title,
          ...(c.url ? { url: c.url } : {}),
          ...(c.subQuestion ? { subQuestion: c.subQuestion } : {}),
          text
        },
        score
      });
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
  /** Which deep sub-question found it. Absent on a quick run. */
  subQuestion?: number;
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

/** Longest suffix of `a` that is also a prefix of `b`, up to `max` chars. Consecutive chunks overlap. */
function overlapLength(a: string, b: string, max: number): number {
  const limit = Math.min(max, a.length, b.length);
  for (let len = limit; len >= 12; len--) {
    if (a.endsWith(b.slice(0, len))) return len;
  }
  return 0;
}

/**
 * Merge the retrieved chunks of one page/section into one verbatim text, in ordinal order.
 * Consecutive chunks (ord n, n+1) share CHUNK_OVERLAP_CHARS of text by construction; the overlap
 * is dropped once so no sentence appears twice. A gap between non-consecutive chunks is marked
 * with an ellipsis so the reader is not shown two distant passages as one continuous quote.
 * Every chunk's text remains a verbatim substring of the result, which is what grounding needs.
 */
export function mergePieces(pieces: { ord: number; text: string }[], maxOverlap = 400): string {
  const sorted = [...pieces].sort((a, b) => a.ord - b.ord);
  let out = '';
  let prevOrd: number | null = null;
  for (const p of sorted) {
    if (!out) {
      out = p.text;
    } else if (prevOrd !== null && p.ord === prevOrd + 1) {
      const cut = overlapLength(out, p.text, maxOverlap);
      out = cut ? `${out}${p.text.slice(cut)}` : `${out} ${p.text}`;
    } else {
      out = `${out} … ${p.text}`;
    }
    prevOrd = p.ord;
  }
  return out;
}

/** `retrieval-basics.pdf, p. 1` / `agent-loops-and-failure.md, § Grounding` / `notes.txt, line 42`. */
export function passageTitle(c: Candidate): string {
  const l = c.locator;
  if (!l) return c.title;
  if (l.page !== undefined) return `${c.title}, p. ${l.page}`;
  if (l.heading !== undefined) return `${c.title}, § ${l.heading}`;
  if (l.line !== undefined) return `${c.title}, line ${l.line}`;
  return c.title;
}

function chooseSnippet(c: Candidate, query: string): string | null {
  // A document source's snippet is the WHOLE retrieved text of that page/section (the merged
  // chunks), not a 300-char passage chosen out of it. That text is what retrieval matched and
  // what the model was shown; a narrower quote would cite less than the evidence, and the
  // grounding check keys on document + locator. Bounded by the page/section length.
  if (c.kind === 'doc') return c.text?.trim() ? c.text : null;
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
/**
 * A rendered formula (`WeightedRRF(d)=r∈R∑wr⋅k+rank…`) or a stretch of link syntax is text
 * we were given, but never text a grader finds in the page's HTML — MathML and nav bars do
 * not strip to the same characters. More than 8% of a sentence outside plain prose
 * characters marks it as such, and the chooser moves on to the next sentence. (Prose with
 * curly quotes and a dash sits under 3%; the RRF formula above sits at 15%.)
 */
export function looksLikeMarkup(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return false;
  const odd = (s.match(/[^a-z0-9\s.,;:'"()\-?!%$/&+]/gi) ?? []).length;
  return odd / s.length > 0.08;
}

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
    if (looksLikeMarkup(s)) continue; // a formula or a nav bar is never verbatim in the page's text
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
