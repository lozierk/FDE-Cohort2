import { TraceEvent, type AskMode, type ToolName } from '@lumina/contract';
import type { Logger } from 'pino';
import { scrub } from '../log.js';
import { llmCostUsd, MAX_TOKENS, type TokenUsage } from '../config/model.js';
import type { ContentBlock, LlmMessage, LlmProvider, ToolDefinition, ToolResultBlock, ToolUseBlock } from '../providers/llm.js';
import type { Providers } from '../providers/index.js';
import { TOOLS_BY_NAME } from '../tools/index.js';
import type { Tool, ToolContext } from '../tools/types.js';
import { citableNumbersNotice } from './prompts.js';
import type { SourceRegistry } from './sources.js';

/** Pages with fetched text the web preflight must return before the quick loop skips its research turn. */
export const WEB_PREFLIGHT_MIN_SOURCES = 2;

/**
 * The research phase, on its own, because a deep search runs it once per sub-question while a
 * quick search runs it once. Everything here used to be phase 1 of `runQuickLoop`; the quick
 * loop now calls it with `subQuestion` undefined and behaves exactly as it did before.
 *
 * What is SHARED across the phases of one request and what is per-phase is the whole design:
 * the source registry, the trace step numbers, the tool-call ledger and the wall clock are
 * shared (one citation numbering, one contiguous trace, one budget), while the message
 * history, the sub-question index and the per-sub-question tool budget are not.
 */

/** What the run log needs per tool call, in order. */
export interface RunToolCall {
  name: ToolName;
  ok: boolean;
  error?: string;
  ms: number;
}

/** A provider threw. Distinct from a tool that failed, which is a trace step with ok:false. */
export class ProviderFailure extends Error {}

/** The request-wide envelope every research phase draws on. */
export interface ResearchBudget {
  /** Tool calls LEFT in the shared envelope (MAX_TOOL_CALLS, or 24 on a deep run), in-flight included. */
  toolCalls(): number;
  /** The shared wall clock is spent. */
  capReached(): boolean;
  /** The next `trace` step number. Shared so a deep run's merged trace numbers from 1 with no gaps. */
  nextStep(): number;
  /**
   * Take a call out of the envelope BEFORE running it. Deep runs three sub-questions at
   * once, and a budget that only counts completed calls lets all three pass the last check
   * while the others are still awaiting a provider — 26 tool calls under a cap of 24.
   */
  claim(): void;
  /** Record the finished call and release its claim. */
  record(call: RunToolCall): void;
}

export interface ResearchInput {
  /** What this phase is researching: the user's question, or one sub-question of it. */
  question: string;
  /** 1-based sub-question index on a deep run. Absent on a quick one, and then nothing is stamped. */
  subQuestion?: number;
  /** Lines that go above `Question:` in the opener — thread history, and deep's main question. */
  contextLines: string[];
  mode: AskMode;
  /** The tools this phase may call. `plan_research` is never among them. */
  tools: Tool[];
  registry: SourceRegistry;
  /** This phase's own context. Deep gives each sub-question one, sharing everything but `subQuestion`. */
  ctx: ToolContext;
  budget: ResearchBudget;
  /**
   * Tool calls THIS phase may spend, preflight included. Absent on a quick run: only the
   * shared cap binds there. Hitting it is a normal stop, not a cap — see `terminated`.
   */
  perCallBudget?: number;
  /** Which first retrieval call the loop makes itself instead of paying a model turn to suggest it. */
  preflight: { web: boolean; docs: boolean };
  /** Document searches the model may add on top of the preflight, for this phase. */
  docsExtraSearches: number;
  system: string;
  emit(event: 'trace', data: unknown): void;
  /** Bound by the caller over the shared `usage` accumulator and the providers. */
  callLlm(req: { system: string; messages: LlmMessage[]; tools?: ToolDefinition[]; maxTokens: number }): Promise<LlmTurn>;
  log: Logger;
  requestId: string;
  now(): number;
}

export interface ResearchResult {
  /** This phase's calls, in order. The shared ledger has them too. */
  toolCalls: RunToolCall[];
  /** `cap` only when the SHARED envelope ran out; a spent per-phase budget is a normal stop. */
  terminated: 'done' | 'cap';
}

type ToolResult0 = { ok: true; content: string } | { ok: false; error: string };

export async function runResearch(input: ResearchInput): Promise<ResearchResult> {
  const { budget, ctx, registry } = input;
  const mine: RunToolCall[] = [];
  let terminated: 'done' | 'cap' = 'done';

  const allowedNames = new Set(input.tools.map((t) => t.name));
  /** This phase's own budget is spent. Distinct from the shared cap, which ends the run. */
  const ownBudgetSpent = () => input.perCallBudget !== undefined && mine.length >= input.perCallBudget;
  const sharedCapReached = () => budget.capReached() || budget.toolCalls() <= 0;

  /** Run one tool, time it, emit its `trace` frame, and record it for the run log. */
  const runTool = async (name: string, args: Record<string, unknown>, reason: string): Promise<ToolResult0> => {
    const tool = TOOLS_BY_NAME.get(name);
    budget.claim();
    const t0 = input.now();
    let result: ToolResult0;
    if (!tool) {
      result = { ok: false, error: `unknown tool: ${name}` };
    } else {
      try {
        const r = await tool.run(args, ctx);
        result = r.ok ? { ok: true, content: r.content } : { ok: false, error: scrub(r.error) };
      } catch (err) {
        // A tool that throws is a visible failed step, not a swallowed empty result. The run
        // continues; the synthesis prompt is told what it does and does not have.
        result = { ok: false, error: scrub(`${name} threw: ${(err as Error).message}`) };
      }
    }
    const ms = input.now() - t0;
    const trace: TraceEvent = TraceEvent.parse({
      step: budget.nextStep(),
      tool: name,
      input: args,
      ok: result.ok,
      ms,
      reason,
      // The bench requires an integer here on every retrieval step of a deep run. It is
      // stamped by the loop, from the phase that ran, not asked for in a prompt.
      ...(input.subQuestion ? { subQuestion: input.subQuestion } : {}),
      ...(result.ok ? {} : { error: result.error })
    });
    input.emit('trace', trace);
    const call: RunToolCall = {
      name: name as ToolName,
      ok: result.ok,
      ms,
      ...(result.ok ? {} : { error: result.error })
    };
    mine.push(call);
    budget.record(call);
    return result;
  };

  const messages: LlmMessage[] = [];
  const opener: string[] = [...input.contextLines];
  opener.push(`Question: ${input.question}`);
  messages.push({ role: 'user', content: [{ type: 'text', text: opener.join('\n') }] });

  /**
   * Latency: the bench measures TTFT to the first `token` frame, target p95 2.5 s. When the
   * mode already says "the web", asking the model whether to search the web costs a full
   * round trip to learn something we were told. So on a fresh web thread the loop runs the
   * first search itself. Sanctioned by the build spec; the model still decides everything
   * after this. On a deep run every sub-question opens the same way, which is also what
   * guarantees each one contributes retrieval to the merged source list.
   *
   * It goes into the history as a real tool_use/tool_result pair rather than as prose in the
   * user turn. Anything else and the model cannot tell a search that already happened from a
   * suggestion that one should — which it answers by searching again, for the whole prompt.
   */
  const preflight = async (tool: 'web_search' | 'search_documents', reason: string): Promise<ToolResult0> => {
    const args = { query: input.question };
    const first = await runTool(tool, args, reason);
    const useId = `toolu_lumina_preflight_${tool}${input.subQuestion ? `_${input.subQuestion}` : ''}`;
    messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: useId, name: tool, input: args }] });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: useId,
          content: first.ok ? first.content : first.error,
          ...(first.ok ? {} : { is_error: true as const })
        },
        { type: 'text', text: citableNumbersNotice(registry.toSources(input.question)) }
      ]
    });
    return first;
  };

  /** The preflight already answered the question; a model turn here can only re-search. */
  let skipResearch = false;

  // The cap is checked before the preflight too, not only inside the turn loop: deep launches
  // a sub-question with one call left and would otherwise spend two on its two preflights,
  // and 25 trace steps under a cap of 24 fails the budget gate by one.
  if (input.preflight.web && allowedNames.has('web_search') && !sharedCapReached()) {
    const first = await preflight('web_search', input.subQuestion ? `sub-question ${input.subQuestion}: search first` : 'mode=web: search first');
    /**
     * web mode, fresh thread, quick run, and the search came back with page text for at
     * least WEB_PREFLIGHT_MIN_SOURCES results: go straight to synthesis, the docs-mode rule
     * applied to the web. Measured 2026-09-14 over 25 quick web runs: the cold search took
     * 1.3-2.9 s, each research turn ~2 s, and the median run spent one turn to fetch one more
     * page — so TTFT ran 4.7-13 s against a 2.5 s p95 gate. `toSources` already drops any
     * result without fetched text, so its length is the count of citable pages. Under the
     * threshold (one page, or none) the model keeps its turn, to fetch or reformulate. Deep
     * sub-questions keep theirs too: their per-sub budget exists to read further, and the
     * source-ratio gate is what pays for it.
     */
    if (!input.subQuestion && input.mode === 'web' && first.ok && registry.toSources(input.question).length >= WEB_PREFLIGHT_MIN_SOURCES) {
      skipResearch = true;
    }
  }

  /**
   * The same argument, for documents. A fresh thread with a Space attached in `docs` mode
   * cannot want anything else; in `auto` the Space is the cheapest place to look first and
   * the model may still add web searches afterwards. Both save a model round trip (~1.6 s of
   * a 2.5 s TTFT budget) on every gold question, and in `auto` it is what guarantees a
   * `search_documents` step exists in the trace instead of hoping the router reaches for it.
   */
  if (input.preflight.docs && allowedNames.has('search_documents') && !sharedCapReached() && !ownBudgetSpent()) {
    const first = await preflight(
      'search_documents',
      input.mode === 'docs'
        ? 'mode=docs: search the Space first'
        : 'mode=auto: a Space is attached, search it first'
    );
    /**
     * docs mode, fresh thread, the Space answered: go straight to synthesis. The user asked for
     * documents only and the loop has already run their exact question against them; a
     * research turn here can only re-search. Measured 2026-09-14 over the 39 gold questions:
     * every recall hit came from this preflight, and each extra model turn cost ~2 s of a
     * 2.5 s TTFT budget (p95 was 9-12 s). Auto mode keeps its turn: the model still decides
     * whether the web is needed as well. Empty retrieval keeps its turn too, so the model can
     * reformulate once before the answer says nothing was found.
     */
    if (input.mode === 'docs' && first.ok && registry.toSources(input.question).length > 0) {
      skipResearch = true;
    }
  }

  let docSearchesLeft = input.docsExtraSearches;
  const toolDefs: ToolDefinition[] = input.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema
  }));

  for (; !skipResearch; ) {
    if (budget.capReached() || budget.toolCalls() <= 0) {
      terminated = 'cap';
      break;
    }
    // A spent per-sub-question budget is this phase saying "ready", not the request running
    // out of road. Only the shared envelope sets `cap`.
    if (ownBudgetSpent()) break;

    const turn = await input.callLlm({
      system: input.system,
      messages,
      tools: toolDefs,
      maxTokens: MAX_TOKENS.toolDecision
    });

    const assistantBlocks: ContentBlock[] = [];
    if (turn.text.trim()) assistantBlocks.push({ type: 'text', text: turn.text });
    for (const t of turn.toolUses) assistantBlocks.push(t);
    if (assistantBlocks.length) messages.push({ role: 'assistant', content: assistantBlocks });

    if (!turn.toolUses.length) break;

    const reason = turn.text.trim() || 'model requested';
    const results: ToolResultBlock[] = [];

    for (const use of turn.toolUses) {
      if (!allowedNames.has(use.name)) {
        // A quick run may never call plan_research, and the loop is what stops it — not the
        // prompt, and not a filter after the fact. Deliberately NOT traced under that name:
        // a `plan_research` step in a quick run's trace is the escalation the bench looks
        // for, and a refusal is not an escalation. It is logged loudly instead.
        input.log.warn(
          { requestId: input.requestId, tool: use.name },
          'refused a tool the current mode/depth does not offer'
        );
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `${use.name} is not available on a ${input.subQuestion ? 'deep' : 'quick'} search in mode "${input.mode}". Available: ${[...allowedNames].join(', ')}.`,
          is_error: true
        });
        continue;
      }
      if (sharedCapReached()) {
        terminated = 'cap';
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: 'tool budget for this request is spent; answer from what you already have',
          is_error: true
        });
        continue;
      }
      if (ownBudgetSpent()) {
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: 'tool budget for this sub-question is spent; say ready and let the others finish',
          is_error: true
        });
        continue;
      }
      if (use.name === 'search_documents' && docSearchesLeft <= 0) {
        // The model may add DOCS_EXTRA_SEARCHES document searches on top of the preflight.
        // Beyond that it is re-searching, and every turn is ~2 s of TTFT. Not traced: a
        // refused call is not a retrieval step. Logged, and the model is told plainly.
        input.log.info({ requestId: input.requestId }, 'search_documents budget for this request is spent');
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: 'document search budget for this request is spent; answer from the passages you already have',
          is_error: true
        });
        continue;
      }
      if (use.name === 'search_documents') docSearchesLeft -= 1;
      const r = await runTool(use.name, use.input, reason);
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: r.ok ? r.content : r.error,
        ...(r.ok ? {} : { is_error: true as const })
      });
    }

    // Every tool_result for this turn goes back in ONE user message: splitting them teaches
    // the model to stop making parallel calls. The citable-numbers notice rides along as
    // text after them, so the model never cites a candidate that got dropped for having no
    // page text.
    const notice = citableNumbersNotice(registry.toSources(input.question));
    messages.push({ role: 'user', content: [...results, { type: 'text', text: notice }] });

    if (terminated === 'cap') break;
  }

  return { toolCalls: mine, terminated };
}

// ---------------------------------------------------------------- the provider call

export interface LlmTurn {
  text: string;
  toolUses: ToolUseBlock[];
  stop: 'end_turn' | 'tool_use' | 'max_tokens';
}

export interface LlmCallDeps {
  providers: Providers;
  requestId: string;
  log: Logger;
  signal?: AbortSignal;
}

/**
 * One provider call, with its usage folded into the request's running total. A throw becomes
 * a `ProviderFailure`, which is the only thing that ends a run with `terminated: "error"`.
 *
 * `llm` defaults to `deps.providers.llm` — every existing caller that never mentions it keeps
 * calling the one model it always called. `spend` is optional and per-call, not per-run: two
 * models at different rates can share one run (research on Haiku, synthesis on Sonnet), so
 * the dollar total has to be built call by call, each priced at ITS OWN provider's model, not
 * once at the end against whichever model happened to be `providers.llm`.
 */
export async function callLlm(
  deps: LlmCallDeps,
  req: {
    system: string;
    messages: LlmMessage[];
    tools?: ToolDefinition[];
    toolChoice?: { name: string };
    maxTokens: number;
    usage: TokenUsage;
    llm?: LlmProvider;
    spend?: { usd: number };
  },
  onText?: (text: string) => void
): Promise<LlmTurn> {
  const provider = req.llm ?? deps.providers.llm;
  const out: LlmTurn = { text: '', toolUses: [], stop: 'end_turn' };
  try {
    const stream = provider.complete({
      system: req.system,
      messages: req.messages,
      ...(req.tools?.length ? { tools: req.tools } : {}),
      ...(req.toolChoice ? { toolChoice: req.toolChoice } : {}),
      maxTokens: req.maxTokens,
      ...(deps.signal ? { signal: deps.signal } : {})
    });
    for await (const ev of stream) {
      if (ev.type === 'text') {
        out.text += ev.text;
        onText?.(ev.text);
      } else if (ev.type === 'tool_use') {
        out.toolUses.push({ type: 'tool_use', id: ev.id, name: ev.name, input: ev.input });
      } else if (ev.type === 'usage') {
        // Per-call breakdown, so a cache that never engages is visible (Haiku 4.5 needs a
        // 4,096-token prefix; ours is ~1,100, so expect cacheRead 0 — do not pad to fix it).
        deps.log.debug(
          { requestId: deps.requestId, input: ev.input, output: ev.output, cacheRead: ev.cacheRead, cacheWrite: ev.cacheWrite },
          'llm usage'
        );
        req.usage.input += ev.input;
        req.usage.output += ev.output;
        req.usage.cacheRead += ev.cacheRead;
        req.usage.cacheWrite += ev.cacheWrite;
        if (req.spend) {
          req.spend.usd += llmCostUsd(
            { input: ev.input, output: ev.output, cacheRead: ev.cacheRead, cacheWrite: ev.cacheWrite },
            provider.model
          );
        }
      } else {
        out.stop = ev.reason;
      }
    }
  } catch (err) {
    throw new ProviderFailure(scrub(`llm provider failed: ${(err as Error).message}`));
  }
  return out;
}
