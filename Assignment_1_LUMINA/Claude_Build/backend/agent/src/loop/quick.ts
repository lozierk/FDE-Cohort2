import {
  DoneEvent,
  SourcesEvent,
  TokenEvent,
  TraceEvent,
  newId,
  unresolvedCitations,
  type AskMode,
  type Source,
  type Terminated,
  type ToolName
} from '@lumina/contract';
import type { Logger } from 'pino';
import { scrub } from '../log.js';
import {
  MAX_TOKENS,
  embeddingCostUsd,
  emptyUsage,
  llmCostUsd,
  SEARCH_USD_PER_CALL,
  type TokenUsage
} from '../config/model.js';
import type { ContentBlock, LlmMessage, ToolResultBlock, ToolUseBlock } from '../providers/llm.js';
import type { Providers } from '../providers/index.js';
import { TOOLS_BY_NAME, toolsForMode } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';
import { citableNumbersNotice, researchSystemPrompt, synthesisSystemPrompt, synthesisUserContent } from './prompts.js';
import { SourceRegistry } from './sources.js';

/** What the run log needs per tool call, in order. */
export interface RunToolCall {
  name: ToolName;
  ok: boolean;
  error?: string;
  ms: number;
}

export interface QuickLoopInput {
  query: string;
  mode: AskMode;
  userId: string;
  threadId: string;
  requestId: string;
  spaceId?: string;
  /** Prior thread messages, oldest first. The loop uses the last 10. */
  history: { role: 'user' | 'assistant'; content: string }[];
  providers: Providers;
  caps: { maxToolCalls: number; maxWallClockSec: number };
  searchCacheTtlSeconds: number;
  /** One SSE frame. The caller owns headers, so an error before the first frame can still be a 502. */
  emit(event: 'trace' | 'sources' | 'token', data: unknown): void;
  log: Logger;
  signal?: AbortSignal;
  now?: () => number;
}

export interface QuickLoopResult {
  answerId: string;
  answer: string;
  sources: Source[];
  toolCalls: RunToolCall[];
  terminated: Terminated;
  /** Set only when terminated === 'error'. The caller turns it into a 502 or an error frame. */
  error?: string;
  usage: TokenUsage;
  costUsd: number;
  searchCached: boolean;
  ttftMs: number;
  latencyMs: number;
  model: string;
}

/** A provider threw. Distinct from a tool that failed, which is a trace step with ok:false. */
class ProviderFailure extends Error {}

export async function runQuickLoop(input: QuickLoopInput): Promise<QuickLoopResult> {
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const elapsedSec = () => (now() - startedAt) / 1000;
  const capReached = () => elapsedSec() >= input.caps.maxWallClockSec;

  const sources = new SourceRegistry();
  const toolCalls: RunToolCall[] = [];
  const usage = emptyUsage();
  let terminated: Terminated = 'done';
  let error: string | undefined;
  let ttftMs = 0;
  let step = 0;
  let uncachedSearches = 0;
  let searchCount = 0;
  let searchHits = 0;

  const allowed = toolsForMode(input.mode);
  const allowedNames = new Set(allowed.map((t) => t.name));
  const history = input.history.slice(-10);

  const ctx: ToolContext = {
    userId: input.userId,
    threadId: input.threadId,
    requestId: input.requestId,
    ...(input.spaceId ? { spaceId: input.spaceId } : {}),
    depth: 0,
    mode: input.mode,
    providers: input.providers,
    sources,
    searchCacheTtlSeconds: input.searchCacheTtlSeconds,
    markSearch(hit: boolean) {
      searchCount += 1;
      if (hit) searchHits += 1;
      else uncachedSearches += 1;
    },
    ...(input.signal ? { signal: input.signal } : {}),
    log: input.log
  };

  /** Run one tool, time it, emit its `trace` frame, and record it for the run log. */
  const runTool = async (name: string, args: Record<string, unknown>, reason: string): Promise<ToolResult0> => {
    const tool = TOOLS_BY_NAME.get(name);
    const t0 = now();
    let result: { ok: true; content: string } | { ok: false; error: string };
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
    const ms = now() - t0;
    step += 1;
    const trace: TraceEvent = TraceEvent.parse({
      step,
      tool: name,
      input: args,
      ok: result.ok,
      ms,
      reason,
      ...(result.ok ? {} : { error: result.error })
    });
    input.emit('trace', trace);
    toolCalls.push({
      name: name as ToolName,
      ok: result.ok,
      ms,
      ...(result.ok ? {} : { error: result.error })
    });
    return result;
  };

  try {
    // ---------------------------------------------------------------- phase 1: research
    const messages: LlmMessage[] = [];
    const opener: string[] = [];
    if (history.length) {
      opener.push('Earlier in this thread (oldest first):');
      for (const m of history) opener.push(`${m.role}: ${m.content.slice(0, 600)}`);
      opener.push('');
    }
    opener.push(`Question: ${input.query}`);

    messages.push({ role: 'user', content: [{ type: 'text', text: opener.join('\n') }] });

    /**
     * Latency: the bench measures TTFT to the first `token` frame, target p95 2.5 s. When the
     * mode already says "the web", asking the model whether to search the web costs a full
     * round trip to learn something we were told. So on a fresh web thread the loop runs the
     * first search itself. Sanctioned by the build spec; the model still decides everything
     * after this.
     *
     * It goes into the history as a real tool_use/tool_result pair rather than as prose in the
     * user turn. Anything else and the model cannot tell a search that already happened from a
     * suggestion that one should — which it answers by searching again, for the whole prompt.
     */
    if (input.mode === 'web' && history.length === 0 && allowedNames.has('web_search')) {
      const first = await runTool('web_search', { query: input.query }, 'mode=web: search first');
      const useId = 'toolu_lumina_preflight';
      messages.push({
        role: 'assistant',
        content: [{ type: 'tool_use', id: useId, name: 'web_search', input: { query: input.query } }]
      });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: useId,
            content: first.ok ? first.content : first.error,
            ...(first.ok ? {} : { is_error: true as const })
          },
          { type: 'text', text: citableNumbersNotice(sources.toSources(input.query)) }
        ]
      });
    }

    const researchSystem = researchSystemPrompt({ mode: input.mode, depth: 'quick' });
    const toolDefs = allowed.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema
    }));

    for (;;) {
      if (capReached()) {
        terminated = 'cap';
        break;
      }
      if (toolCalls.length >= input.caps.maxToolCalls) {
        terminated = 'cap';
        break;
      }

      const turn = await callLlm(input, {
        system: researchSystem,
        messages,
        tools: toolDefs,
        maxTokens: MAX_TOKENS.toolDecision,
        usage
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
            content: `${use.name} is not available on a quick search in mode "${input.mode}". Available: ${[...allowedNames].join(', ')}.`,
            is_error: true
          });
          continue;
        }
        if (toolCalls.length >= input.caps.maxToolCalls || capReached()) {
          terminated = 'cap';
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            content: 'tool budget for this request is spent; answer from what you already have',
            is_error: true
          });
          continue;
        }
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
      const notice = citableNumbersNotice(sources.toSources(input.query));
      messages.push({ role: 'user', content: [...results, { type: 'text', text: notice }] });

      if (terminated === 'cap') break;
    }

    // ---------------------------------------------------------------- phase 2: synthesis
    const finalSources = sources.toSources(input.query);
    input.emit('sources', SourcesEvent.parse(finalSources));

    // The synthesis call is NOT gated on the wall clock: when a cap has been hit the contract
    // still wants an honest partial answer, and the answer is the only thing that says so.
    const synth = await callLlm(
      input,
      {
        system: synthesisSystemPrompt({ mode: input.mode, depth: 'quick' }),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: synthesisUserContent({ query: input.query, history, passages: sources.toPassages(input.query) })
              }
            ]
          }
        ],
        maxTokens: MAX_TOKENS.synthesis,
        usage
      },
      (text) => {
        if (ttftMs === 0) ttftMs = now() - startedAt;
        input.emit('token', TokenEvent.parse({ text }) satisfies TokenEvent);
      }
    );

    const answer = synth.text;
    const unresolved = unresolvedCitations(answer, finalSources);
    if (unresolved.length) {
      // Do NOT rewrite the streamed text: the user has already seen it, and silently patching
      // it would hide exactly the failure this check exists to find.
      input.log.warn(
        { requestId: input.requestId, unresolved, citable: finalSources.map((s) => s.n) },
        'answer cites source numbers that are not in the sources event'
      );
    }

    const costUsd = totalCost(usage, uncachedSearches, input.providers);
    return {
      answerId: newId('ans'),
      answer,
      sources: finalSources,
      toolCalls,
      terminated,
      usage,
      costUsd,
      searchCached: searchCount > 0 && searchHits === searchCount,
      ttftMs,
      latencyMs: now() - startedAt,
      model: input.providers.llm.model
    };
  } catch (err) {
    // Only a provider exception lands here. It ends the run — no plausible answer, no empty
    // success. The caller turns this into a 502 or an `error` frame.
    terminated = 'error';
    error = scrub(err instanceof ProviderFailure ? err.message : `${(err as Error).message}`);
    return {
      answerId: newId('ans'),
      answer: '',
      sources: sources.toSources(input.query),
      toolCalls,
      terminated,
      error,
      usage,
      costUsd: totalCost(usage, uncachedSearches, input.providers),
      searchCached: searchCount > 0 && searchHits === searchCount,
      ttftMs,
      latencyMs: now() - startedAt,
      model: input.providers.llm.model
    };
  }
}

type ToolResult0 = { ok: true; content: string } | { ok: false; error: string };

function totalCost(usage: TokenUsage, uncachedSearches: number, providers: Providers): number {
  return (
    llmCostUsd(usage) +
    uncachedSearches * SEARCH_USD_PER_CALL +
    embeddingCostUsd(providers.embedder.tokensUsed)
  );
}

interface LlmTurn {
  text: string;
  toolUses: ToolUseBlock[];
  stop: 'end_turn' | 'tool_use' | 'max_tokens';
}

async function callLlm(
  input: QuickLoopInput,
  req: {
    system: string;
    messages: LlmMessage[];
    tools?: { name: string; description: string; input_schema: Record<string, unknown> }[];
    maxTokens: number;
    usage: TokenUsage;
  },
  onText?: (text: string) => void
): Promise<LlmTurn> {
  const out: LlmTurn = { text: '', toolUses: [], stop: 'end_turn' };
  try {
    const stream = input.providers.llm.complete({
      system: req.system,
      messages: req.messages,
      ...(req.tools?.length ? { tools: req.tools } : {}),
      maxTokens: req.maxTokens,
      ...(input.signal ? { signal: input.signal } : {})
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
        input.log.debug(
          { requestId: input.requestId, input: ev.input, output: ev.output, cacheRead: ev.cacheRead, cacheWrite: ev.cacheWrite },
          'llm usage'
        );
        req.usage.input += ev.input;
        req.usage.output += ev.output;
        req.usage.cacheRead += ev.cacheRead;
        req.usage.cacheWrite += ev.cacheWrite;
      } else {
        out.stop = ev.reason;
      }
    }
  } catch (err) {
    throw new ProviderFailure(scrub(`llm provider failed: ${(err as Error).message}`));
  }
  return out;
}

/** Build the `done` event and validate it against the contract before it goes on the wire. */
export function doneEventFor(result: QuickLoopResult): DoneEvent {
  return DoneEvent.parse({
    answerId: result.answerId,
    latencyMs: result.latencyMs,
    ttftMs: result.ttftMs,
    model: result.model,
    tokens: { in: result.usage.input + result.usage.cacheRead + result.usage.cacheWrite, out: result.usage.output },
    costUsd: Number(result.costUsd.toFixed(6)),
    searchCached: result.searchCached,
    terminated: result.terminated,
    depth: 'quick',
    subQuestions: 0
  });
}
