import type { AskMode, Depth, Source } from '@lumina/contract';
import type { Passage } from './sources.js';

/**
 * Every prompt in the service lives here, as functions of (mode, depth, memories). One file
 * to read when an answer is wrong for a promptable reason, and no prompt buried next to the
 * code that happens to send it.
 *
 * Note what these prompts do NOT do: they do not ask the model to stay under a cap, to avoid
 * `plan_research`, or to write its own citation snippets. Every one of those is enforced in
 * the loop. A rule you can only ask for politely is not a rule.
 */

export interface PromptContext {
  mode: AskMode;
  depth: Depth;
  memories?: string[];
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

/**
 * The model's training data ends long before today, and without being told the date it
 * anchors "latest" and "most recent" to what it remembers (first real run: it searched for
 * the December 2024 FOMC meeting in September 2026). One line fixes the whole class.
 */
const todayLine = (now?: Date): string =>
  `Today's date is ${(now ?? new Date()).toISOString().slice(0, 10)}. "Latest", "recent", "current" and ` +
  `"this year" are relative to that date, not to your training data.`;

const memoryBlock = (memories?: string[]): string =>
  memories?.length
    ? `\n\nWhat you already know about this user:\n${memories.map((m) => `- ${m}`).join('\n')}`
    : '';

/** Phase 1. The model gathers; it does not answer. Answer text here would be wasted tokens. */
export function researchSystemPrompt(ctx: PromptContext): string {
  const scope =
    ctx.mode === 'docs'
      ? 'Look only in the user\'s uploaded documents.'
      : ctx.mode === 'web'
        ? 'Look on the web.'
        : 'Decide for yourself whether the web, the user\'s documents, or both will answer this.';

  return [
    'You are LUMINA\'s research step. Your job in this step is to GATHER EVIDENCE, not to answer.',
    scope,
    todayLine(ctx.now),
    '',
    'How to work:',
    '- This is a QUICK search. Budget: two searches in total and two fetch_page calls at most,',
    '  then say ready. A good answer in three seconds beats a complete one in twelve; if the',
    '  first results already carry page text on the question, you are done.',
    '- Call a tool when you still need something. Say in one short sentence why, before the call.',
    '- Search results come back numbered. Those numbers are the citation numbers later, so pay',
    '  attention to which number holds which fact.',
    '- A result with no page text cannot be cited. Use fetch_page on its url if you need it.',
    '- Call recall_memory when the answer depends on who is asking.',
    '- Call save_memory only for a stable fact or standing preference the user has stated about',
    '  themselves. Never for something you just learned from a page.',
    '',
    'When you have enough to answer, stop calling tools and reply with the single word: ready',
    'Do not write the answer in this step. Someone else writes it, from what you gathered.',
    memoryBlock(ctx.memories)
  ].join('\n');
}

/** Phase 2. One streaming call, no tools, and the citation rules are the whole prompt. */
export function synthesisSystemPrompt(ctx: PromptContext): string {
  return [
    'You are LUMINA. You answer the user\'s question from the numbered passages you are given,',
    'and from nothing else.',
    todayLine(ctx.now),
    '',
    'Citation rules — these are checked, not trusted:',
    '- Cite with [n], using only the numbers in the passages below. A number that is not listed',
    '  is a failed answer even if the sentence is true.',
    '- Every factual sentence carries a citation. Group them as [1][3] when a sentence rests on',
    '  more than one passage.',
    '- If the passages do not answer the question, say so plainly, say what they do cover, and',
    '  cite nothing. Do not fill the gap from memory.',
    '- Never invent a url, a page number, a document, or a quotation.',
    '',
    'Style: answer the question first, in a sentence or two, then the detail. Plain prose. No',
    'preamble about what you are about to do.',
    ctx.depth === 'deep' ? '\nStructure: a direct answer, a section per sub-question, then what is still unknown.' : '',
    memoryBlock(ctx.memories)
  ].join('\n');
}

/**
 * The user turn for synthesis: question, thread history, and the passages, in that order.
 * `passages` are the longer verbatim windows from the registry, numbered exactly like the
 * `sources` event; the answer is written from fetched text, not from search snippets.
 */
export function synthesisUserContent(input: {
  query: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  passages: Passage[];
}): string {
  const parts: string[] = [`Question: ${input.query}`];

  if (input.history.length) {
    parts.push(
      '',
      'Earlier in this thread (oldest first):',
      ...input.history.map((m) => `${m.role}: ${truncate(m.content, 600)}`)
    );
  }

  if (input.passages.length) {
    parts.push('', 'Passages you may cite:');
    for (const s of input.passages) {
      parts.push(`[${s.n}] ${s.title}${s.url ? ` — ${s.url}` : ''}\n${s.text}`, '');
    }
    parts.push(`Citable numbers: ${input.passages.map((s) => s.n).join(', ')}. No others exist.`);
  } else {
    parts.push(
      '',
      'No passages were retrieved for this question.',
      'Say so plainly, say what you tried, and cite nothing.'
    );
  }

  return parts.join('\n');
}

/** Told to the model when candidates were dropped, so it does not cite a number it saw earlier. */
export function citableNumbersNotice(sources: Source[]): string {
  if (!sources.length) return 'Nothing retrieved so far is citable: no page text was read.';
  return `Citable source numbers so far: ${sources.map((s) => s.n).join(', ')}.`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
