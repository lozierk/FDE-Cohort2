import type { SubQuestion } from '@lumina/contract';
import type { Logger } from 'pino';
import { MAX_TOKENS } from '../config/model.js';
import type { LlmMessage, ToolDefinition } from '../providers/llm.js';
import { ProviderFailure, type LlmTurn } from './research.js';
import { plannerSystemPrompt, plannerUserContent } from './prompts.js';

/**
 * The planner: one forced tool call that turns a question into the sub-questions we will
 * actually go and answer.
 *
 * `plan_research` is DEFINED HERE and nowhere else. It is deliberately not in `ALL_TOOLS` or
 * `toolsForMode()`, so a quick run cannot reach it however the model is prompted — the surest
 * way to stop a quick search escalating itself into a run that costs seven times as much is
 * for the expensive tool to be unreachable rather than forbidden. The deep loop calls this
 * function directly; it never offers the tool to a research turn.
 */
export const PLAN_RESEARCH_TOOL: ToolDefinition = {
  name: 'plan_research',
  description:
    'Break the question into independent sub-questions a search engine can answer on its own, ' +
    'each with a one-line reason: the distinct parts of the question, its comparison axes, and ' +
    'the numbers someone would need. Do not answer the question.',
  input_schema: {
    type: 'object',
    properties: {
      subQuestions: {
        type: 'array',
        description: 'The sub-questions to research, in the order they should be read.',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'A standalone question a search engine can answer.' },
            reason: { type: 'string', description: 'Why this is worth researching. Six words at most.' }
          },
          required: ['question', 'reason'],
          additionalProperties: false
        }
      },
      reason: { type: 'string', description: 'How you split the question up. Eight words at most.' }
    },
    required: ['subQuestions'],
    additionalProperties: false
  }
};

export interface PlanResult {
  subQuestions: SubQuestion[];
  reason?: string;
  /** Wall clock of the planner call(s). The `trace` step's `ms`. */
  ms: number;
}

export interface PlannerInput {
  query: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  min: number;
  max: number;
  memories?: string[];
  callLlm(req: {
    system: string;
    messages: LlmMessage[];
    tools: ToolDefinition[];
    toolChoice: { name: string };
    maxTokens: number;
  }): Promise<LlmTurn>;
  log: Logger;
  requestId: string;
  now(): number;
}

/**
 * One planner turn, validated, with exactly one retry.
 *
 * One retry and no more, on purpose: the plan is deep search's first paint and the SLA gives
 * it 4 s. A second retry buys a small chance of a plan at the cost of every user watching a
 * spinner past the point the product feels broken, and a 502 that says the planner failed is
 * more useful than a slow plan nobody trusts.
 */
export async function planResearch(input: PlannerInput): Promise<PlanResult> {
  const t0 = input.now();
  const system = plannerSystemPrompt({
    mode: 'auto',
    depth: 'deep',
    min: input.min,
    max: input.max,
    ...(input.memories?.length ? { memories: input.memories } : {})
  });
  const messages: LlmMessage[] = [
    { role: 'user', content: [{ type: 'text', text: plannerUserContent({ query: input.query, history: input.history }) }] }
  ];

  let lastProblem = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const turn = await input.callLlm({
      system,
      messages,
      tools: [PLAN_RESEARCH_TOOL],
      toolChoice: { name: PLAN_RESEARCH_TOOL.name },
      maxTokens: MAX_TOKENS.plan
    });

    const use = turn.toolUses.find((t) => t.name === PLAN_RESEARCH_TOOL.name);
    const { subQuestions, problem } = validate(use?.input, input.min, input.max);

    if (!problem) {
      const reason = typeof use?.input.reason === 'string' ? use.input.reason.trim() : '';
      return {
        subQuestions,
        ...(reason ? { reason } : {}),
        ms: input.now() - t0
      };
    }

    lastProblem = problem;
    input.log.warn({ requestId: input.requestId, attempt: attempt + 1, problem }, 'planner returned an invalid plan');
    if (attempt === 0) {
      // Tell the model what was wrong with the plan it just wrote, in the same conversation.
      // A blind retry of the identical prompt usually returns the identical plan.
      if (turn.toolUses.length) messages.push({ role: 'assistant', content: turn.toolUses });
      messages.push({
        role: 'user',
        content: [
          ...(use
            ? [{ type: 'tool_result' as const, tool_use_id: use.id, content: problem, is_error: true }]
            : []),
          { type: 'text' as const, text: `That plan is not usable: ${problem} Write the plan again, correctly.` }
        ]
      });
    }
  }

  throw new ProviderFailure(`plan_research returned an invalid plan: ${lastProblem}`);
}

/**
 * Trim blanks, drop case-insensitive duplicates, keep the first `max`. Truncating an
 * over-long plan is free and a retry is 2 s of first paint, so only "too few" is worth
 * asking again for — an eight-item plan is a good plan with four items we cannot afford.
 */
function validate(
  raw: unknown,
  min: number,
  max: number
): { subQuestions: SubQuestion[]; problem: string } {
  const input = (raw ?? {}) as { subQuestions?: unknown };
  const items = Array.isArray(input.subQuestions) ? input.subQuestions : [];
  if (!items.length) {
    return { subQuestions: [], problem: 'it held no sub-questions at all.' };
  }

  const seen = new Set<string>();
  const kept: { question: string; reason?: string }[] = [];
  for (const item of items) {
    const row = (item ?? {}) as { question?: unknown; reason?: unknown };
    const question = typeof row.question === 'string' ? row.question.trim() : '';
    if (!question) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = typeof row.reason === 'string' ? row.reason.trim() : '';
    kept.push({ question, ...(reason ? { reason } : {}) });
    if (kept.length === max) break;
  }

  if (kept.length < min) {
    return {
      subQuestions: [],
      problem: `it has ${kept.length} usable sub-question(s) after dropping blanks and duplicates; ${min} to ${max} are required.`
    };
  }

  return {
    subQuestions: kept.map((k, idx) => ({ i: idx + 1, ...k })),
    problem: ''
  };
}
