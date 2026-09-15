import type { LlmEvent, LlmProvider, LlmRequest } from './llm.js';

/**
 * A scripted LLM. Selected by LLM_PROVIDER=fake, and constructed directly by tests.
 *
 * Rule for anyone extending it: the fake exists so the LOOP can be exercised without a key.
 * It is never allowed to grow knowledge of the loop's internals, and nothing in the loop may
 * be tuned to make the fake look good.
 */
export type FakeTurn =
  | { tool: string; input: Record<string, unknown> }
  | { text: string }
  /** Throw on this turn — the only honest way to test the terminated:"error" path. */
  | { throws: string };

const DEFAULT_ANSWER =
  'Tavily is a search API built for retrieval pipelines [1]. It returns extracted page text ' +
  'alongside each result, which is what lets an answer be synthesised from the page rather ' +
  'than the snippet [2].';

export class FakeLlm implements LlmProvider {
  readonly name = 'fake';
  readonly model: string;
  /** Every request this fake was asked to complete. Tests assert against it. */
  readonly calls: LlmRequest[] = [];
  private turn = 0;

  constructor(
    private readonly script?: FakeTurn[],
    model = 'fake-llm'
  ) {
    this.model = model;
  }

  async *complete(req: LlmRequest): AsyncIterable<LlmEvent> {
    // `toolChoice` is recorded (tests assert the planner forced `plan_research`) and then
    // ignored: the script already says what this turn does, and a fake that "honoured" a
    // forced tool would be inventing the tool input the loop is supposed to be tested on.
    this.calls.push(req);
    const next = this.script ? this.script[this.turn] : this.improvise(req);
    this.turn += 1;

    if (next && 'throws' in next) throw new Error(next.throws);

    // No tools were offered, so no tool can be called — a real model answers here, and so does
    // this one. That is what makes a scripted tool turn land harmlessly on the synthesis call.
    if (next && 'tool' in next && !req.tools?.length) {
      yield { type: 'usage', input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };
      for (const piece of chunk(DEFAULT_ANSWER)) yield { type: 'text', text: piece };
      yield { type: 'stop', reason: 'end_turn' };
      return;
    }

    if (next && 'tool' in next) {
      yield { type: 'usage', input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };
      yield { type: 'tool_use', id: `toolu_fake_${this.turn}`, name: next.tool, input: next.input };
      yield { type: 'stop', reason: 'tool_use' };
      return;
    }

    // A text turn, or the script ran out: answer. Chunked so the loop's token frames are
    // exercised the way a real stream exercises them.
    const text = next ? next.text : DEFAULT_ANSWER;
    yield { type: 'usage', input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };
    for (const piece of chunk(text)) yield { type: 'text', text: piece };
    yield { type: 'stop', reason: 'end_turn' };
  }

  /**
   * The documented default script: one `web_search` for the user's question, then a text
   * answer citing [1] and [2]. "Then" is decided by looking for a search result already in
   * the conversation, because that is what a model does — not by counting the loop's phases.
   */
  private improvise(req: LlmRequest): FakeTurn {
    // A search, specifically: the loop's own memory recall also lands as a tool_result, and a
    // model that took "I remembered something" for "I searched" would answer without sources.
    const hasResults = req.messages.some((m) =>
      m.role === 'assistant' && m.content.some((b) => b.type === 'tool_use' && b.name === 'web_search')
    );
    const offersSearch = req.tools?.some((t) => t.name === 'web_search') ?? false;
    if (!hasResults && offersSearch) {
      return { tool: 'web_search', input: { query: firstUserText(req) } };
    }
    return { text: DEFAULT_ANSWER };
  }
}

/**
 * The question out of the first user turn. The loop puts thread history above it and labels
 * the question `Question: …`, so reading that label is what a model does with the prompt —
 * it is not knowledge of the loop's internals.
 */
function firstUserText(req: LlmRequest): string {
  for (const m of req.messages) {
    if (m.role !== 'user') continue;
    for (const b of m.content) {
      if (b.type !== 'text' || !b.text.trim()) continue;
      const labelled = b.text.match(/^Question:\s*(.+)$/m);
      return (labelled?.[1] ?? b.text).trim();
    }
  }
  return 'unknown query';
}

function chunk(text: string, size = 24): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}
