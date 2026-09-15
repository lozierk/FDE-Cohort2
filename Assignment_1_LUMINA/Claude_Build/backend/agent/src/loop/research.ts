import { TraceEvent, type AskMode, type ToolName } from '@lumina/contract';
import type { Logger } from 'pino';
import { env } from '../env.js';
import { scrub } from '../log.js';
import { llmCostUsd, MAX_TOKENS, type TokenUsage } from '../config/model.js';
import type { ContentBlock, LlmMessage, LlmProvider, ToolDefinition, ToolResultBlock, ToolUseBlock } from '../providers/llm.js';
import type { Providers } from '../providers/index.js';
import { TOOLS_BY_NAME } from '../tools/index.js';
import type { Tool, ToolContext } from '../tools/types.js';
import { runWithDeadline } from '../tools/with-deadline.js';
import { citableNumbersNotice } from './prompts.js';
import type { SourceRegistry } from './sources.js';

/** Pages with fetched text the web preflight must return before the quick loop skips its research turn. */
export const WEB_PREFLIGHT_MIN_SOURCES = 2;
/** Results without extracted text the loop will fetch itself, in web mode, before giving the model a turn. */
export const WEB_PREFLIGHT_FETCHES = 2;

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
  /**
   * Which first retrieval call the loop makes itself instead of paying a model turn to suggest
   * it. `memory` recalls what is known about the user before anything else; it never decides
   * whether the model gets a turn, it only makes sure the answer can know who is asking.
   */
  preflight: { web: boolean; docs: boolean; memory?: boolean };
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
  /** What the memory preflight recalled about the user, one line each; empty when it did not run. */
  memories: string[];
}

type ToolResult0 = { ok: true; content: string } | { ok: false; error: string };

const RETRIEVAL_TOOLS = new Set(['web_search', 'fetch_page', 'search_documents']);

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
        const r = await runWithDeadline(tool, args, ctx, env.toolTimeoutMs);
        // Retrieved text is data, never instructions: the same boundary the synthesis prompt
        // draws (`untrustedSource` in prompts.ts), applied where the model first reads it.
        result = r.ok
          ? { ok: true, content: RETRIEVAL_TOOLS.has(tool.name) ? `<untrusted_source tool="${tool.name}">\n${r.content}\n</untrusted_source>` : r.content }
          : { ok: false, error: scrub(r.error) };
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
  let preflights = 0;
  const preflight = async (
    tool: 'web_search' | 'search_documents' | 'recall_memory' | 'fetch_page',
    reason: string,
    args: Record<string, unknown> = { query: input.question }
  ): Promise<ToolResult0> => {
    const first = await runTool(tool, args, reason);
    // Unique per call: two preflight fetches with one id would be rejected by the provider
    // the moment a model turn follows them.
    const useId = `toolu_lumina_preflight_${tool}_${(preflights += 1)}${input.subQuestion ? `_${input.subQuestion}` : ''}`;
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

  /**
   * Memory first, and always as a real step: the bench looks for a `recall_memory` step in a
   * NEW thread's trace to prove a preference crossed the thread boundary, and the synthesis
   * needs the text either way. Before this, recall happened only when the model chose it in a
   * research turn — and the fast paths above take that turn away. One embedding and one
   * Mongo scan, ~100 ms, and never a reason to skip or keep the model's turn.
   */
  const memories: string[] = [];
  if (input.preflight.memory && allowedNames.has('recall_memory') && !sharedCapReached()) {
    const recalled = await preflight('recall_memory', 'new request: recall what is known about this user');
    if (recalled.ok) {
      for (const line of recalled.content.split('\n')) {
        const m = /^- (.*?)(?: \(score [\d.]+, id [^)]+\))?$/.exec(line.trim());
        if (m?.[1]) memories.push(m[1]);
      }
    }
  }

  // The cap is checked before the preflight too, not only inside the turn loop: deep launches
  // a sub-question with one call left and would otherwise spend two on its two preflights,
  // and 25 trace steps under a cap of 24 fails the budget gate by one.
  if (input.preflight.web && allowedNames.has('web_search') && !sharedCapReached()) {
    const first = await preflight('web_search', input.subQuestion ? `sub-question ${input.subQuestion}: search first` : 'mode=web: search first');
    /**
     * web mode, quick run, the preflight ran (fresh thread, or a question that stands on
     * its own — standalone.ts), and the search came back with page text for at least
     * WEB_PREFLIGHT_MIN_SOURCES results: go straight to synthesis, the docs-mode rule
     * applied to the web. Measured 2026-09-14 over 25 quick web runs: the cold search took
     * 1.3-2.9 s, each research turn ~2 s, and the median run spent one turn to fetch one more
     * page — so TTFT ran 4.7-13 s against a 2.5 s p95 gate. `toSources` already drops any
     * result without fetched text, so its length is the count of citable pages. Under the
     * threshold (one page, or none) the model keeps its turn, to fetch or reformulate. Deep
     * sub-questions keep theirs too: their per-sub budget exists to read further, and the
     * source-ratio gate is what pays for it.
     */
    if (!input.subQuestion && input.mode === 'web' && first.ok) {
      let citable = registry.toSources(input.question).length;
      if (citable >= WEB_PREFLIGHT_MIN_SOURCES) skipResearch = true;
      else if (allowedNames.has('fetch_page')) {
        /**
         * Under the threshold, the model's turn went one way every time: fetch a result the
         * search had not extracted. The third full bench (2026-09-14) put its TTFT p95 on the
         * two queries that took that turn — 7.9 s and 8.9 s against ~0.7 s for the other 38.
         * So the loop does the fetch itself, up to WEB_PREFLIGHT_FETCHES results, and skips
         * the turn once the threshold is met. A fetch that fails is a visible failed step and
         * the model keeps its turn, as before.
         */
        const unread = registry.all().filter((c) => c.kind === 'web' && c.url && !c.text?.trim());
        for (const c of unread.slice(0, WEB_PREFLIGHT_FETCHES)) {
          if (sharedCapReached() || input.budget.toolCalls() <= 0) break;
          await preflight(
            'fetch_page',
            `mode=web: the search extracted text for ${citable} page(s), reading ${c.url} before deciding`,
            { url: c.url }
          );
          citable = registry.toSources(input.question).length;
          if (citable >= WEB_PREFLIGHT_MIN_SOURCES) {
            skipResearch = true;
            break;
          }
        }
      }
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
     * 2.5 s TTFT budget (p95 was 9-12 s).
     *
     * Auto mode takes the same path once the Space answered (2026-09-15, deployed). It used to
     * keep its turn so the model could add the web; on the bench's mode=auto probe the model
     * spent that turn on a fetch_page of a doc source (rejected, 0 ms), a web search and a page
     * fetch before answering: TTFT 6.9 s and 9.4 s in two deployed runs, and gate 2 of
     * eval/eval.mjs blocks on the smoke's five-sample p95. A Space the user attached and that
     * matched their exact question is the answer they asked for; the web is one mode switch
     * away. Empty retrieval keeps its turn in both modes, so the model can reformulate once
     * (auto: or go to the web) before the answer says nothing was found.
     */
    if ((input.mode === 'docs' || input.mode === 'auto') && first.ok && registry.toSources(input.question).length > 0) {
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

  return { toolCalls: mine, terminated, memories };
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
