/**
 * Does this question stand on its own, or does it lean on the thread?
 *
 * The preflight search (research.ts) runs the user's words as the first retrieval, and in web
 * and docs mode the loop answers straight from it when it returned enough. That is only safe
 * when the words ARE the question. On a fresh thread they always are. On a thread with
 * history, "How does it compare to BM25?" is not a query anyone should search, so the model
 * reads the history first — at the price of a model turn before the first token.
 *
 * Found 2026-09-14 on the first full bench: it sends all 40 web queries down ONE thread, so
 * 39 of them took the slow path (TTFT p95 12.8 s against a 2.5 s gate, cache hit rate 10%
 * because the model rephrased every search). Every one of those 40 questions was
 * self-contained. This check lets the preflight decide without a model turn.
 *
 * A heuristic, chosen for its failure mode: a false "standalone" wastes one search and hands
 * the synthesis some off-topic passages alongside the history it always sees; a false
 * "contextual" costs one model turn, which is what every follow-up paid before. Three signals,
 * each cheap and each explained in a test:
 *   - fewer than four words: "Why?", "Tell me more", "And GridFS?" — never self-contained;
 *   - opens like a continuation: "And …", "What about …", "So …";
 *   - a pronoun or deictic in the opening words or as the last word: "How does it …",
 *     "What are its limits", "… expand on that?". Only the opening and the tail are checked
 *     because standalone questions carry pronouns in the middle all the time ("when does it
 *     save money", "price its search requests").
 */

const OPENING_WORDS = 4;

const ANAPHORA = new Set([
  'it', 'its', 'that', 'this', 'these', 'those', 'they', 'them', 'their', 'theirs',
  'he', 'she', 'him', 'her', 'his', 'hers', 'one', 'ones', 'same', 'above', 'previous',
  'earlier', 'again', 'also', 'else', 'there', 'then', 'instead', 'too', 'more'
]);

const CONTINUATION = /^(and|but|so|or|also|then|what about|how about|why not|ok|okay|yes|no|now)\b/;

/**
 * Is this an instruction about the user rather than a question about the world?
 *
 * "Remember this preference for all future answers: …" is not a search query, and answering
 * it straight from a preflight web search is how the first full bench lost every memory gate:
 * the fresh thread plus two pages of search text skipped the model turn, and `save_memory` is
 * a tool only a model turn can call. Such a request keeps its turn, and skips the search.
 */
const MEMORY_REQUEST =
  /\b(remember|forget|don't forget|do not forget|keep in mind|from now on|for (all )?(future|later) (answers|replies|responses|conversations)|my preference|i prefer|note that i|save this|call me|my name is)\b/i;

export function looksLikeMemoryRequest(query: string): boolean {
  return MEMORY_REQUEST.test(query);
}

export function looksStandalone(query: string): boolean {
  const q = query
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = q.split(' ').filter(Boolean);
  if (words.length < 4) return false;
  if (CONTINUATION.test(q)) return false;
  if (words.slice(0, OPENING_WORDS).some((w) => ANAPHORA.has(w))) return false;
  if (ANAPHORA.has(words[words.length - 1]!)) return false;
  return true;
}
