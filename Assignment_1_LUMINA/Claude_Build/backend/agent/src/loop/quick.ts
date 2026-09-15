import {
  DoneEvent,
  SourcesEvent,
  TokenEvent,
  newId,
  unresolvedCitations,
  type AskMode,
  type Depth,
  type Source,
  type Terminated
} from '@lumina/contract';
import type { Logger } from 'pino';
import { env } from '../env.js';
import { scrub } from '../log.js';
import { MAX_TOKENS, embeddingCostUsd, emptyUsage, SEARCH_USD_PER_CALL, type TokenUsage } from '../config/model.js';
import type { Providers } from '../providers/index.js';
import { toolsForMode } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';
import { researchSystemPrompt, synthesisSystemPrompt, synthesisUserContent } from './prompts.js';
import { callLlm, runResearch, type ResearchBudget, type RunToolCall } from './research.js';
import { SourceRegistry } from './sources.js';
import { looksLikeMemoryRequest, looksStandalone } from './standalone.js';

export type { RunToolCall } from './research.js';

export interface QuickLoopInput {
  query: string;
  mode: AskMode;
  userId: string;
  threadId: string;
  requestId: string;
  spaceId?: string;
  /** The attached Space's name and filenames, for the research prompt. Absent when none is. */
  space?: { name: string; documents: string[] };
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

export async function runQuickLoop(input: QuickLoopInput): Promise<QuickLoopResult> {
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const elapsedSec = () => (now() - startedAt) / 1000;

  const sources = new SourceRegistry();
  const toolCalls: RunToolCall[] = [];
  const usage = emptyUsage();
  /** LLM dollars, priced per call against the model that made it — see callLlm in research.ts. */
  const spend = { usd: 0 };
  let terminated: Terminated = 'done';
  let ttftMs = 0;
  let step = 0;
  let uncachedSearches = 0;
  let searchCount = 0;
  let searchHits = 0;
  let embeddingTokens = 0;

  const allowed = toolsForMode(input.mode);
  const history = input.history.slice(-10);
  const standalone = history.length === 0 || looksStandalone(input.query);
  const memoryRequest = looksLikeMemoryRequest(input.query);

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
    addEmbeddingTokens(n: number) {
      if (n > 0) embeddingTokens += n;
    },
    ...(input.signal ? { signal: input.signal } : {}),
    log: input.log
  };

  // A quick run is sequential, so `inFlight` is only ever 0 or 1 here. It is implemented the
  // same way as deep's so the two gears cannot drift apart on what "budget left" means.
  let inFlight = 0;
  const budget: ResearchBudget = {
    toolCalls: () => input.caps.maxToolCalls - toolCalls.length - inFlight,
    capReached: () => elapsedSec() >= input.caps.maxWallClockSec,
    nextStep: () => (step += 1),
    claim: () => {
      inFlight += 1;
    },
    record: (call) => {
      inFlight -= 1;
      toolCalls.push(call);
    }
  };

  const deps = {
    providers: input.providers,
    requestId: input.requestId,
    log: input.log,
    ...(input.signal ? { signal: input.signal } : {})
  };

  try {
    // ---------------------------------------------------------------- phase 1: research
    const contextLines: string[] = [];
    if (history.length) {
      contextLines.push('Earlier in this thread (oldest first):');
      for (const m of history) contextLines.push(`${m.role}: ${m.content.slice(0, 600)}`);
      contextLines.push('');
    }

    const research = await runResearch({
      question: input.query,
      contextLines,
      mode: input.mode,
      tools: allowed,
      registry: sources,
      ctx,
      budget,
      // A fresh thread has nothing to follow up on, so the first retrieval call is one the
      // loop already knows it wants. So is a question that stands on its own (standalone.ts)
      // — the bench sends 40 of them down one thread. A real follow-up does not: the model
      // reads the history first.
      // "Remember that I prefer…" is an instruction, not a query: no search, and the model
      // keeps its turn, because save_memory is a tool only a model turn can call.
      preflight: {
        web: input.mode === 'web' && standalone && !memoryRequest,
        docs: Boolean(input.spaceId) && standalone && !memoryRequest && (input.mode === 'docs' || input.mode === 'auto'),
        memory: true
      },
      docsExtraSearches: env.docsExtraSearches,
      system: researchSystemPrompt({
        mode: input.mode,
        depth: 'quick',
        ...(input.space ? { space: input.space } : {})
      }),
      emit: (event, data) => input.emit(event, data),
      callLlm: (req) => callLlm(deps, { ...req, usage, spend }),
      log: input.log,
      requestId: input.requestId,
      now
    });
    terminated = research.terminated;

    // ---------------------------------------------------------------- phase 2: synthesis
    const finalSources = sources.toSources(input.query);
    input.emit('sources', SourcesEvent.parse(finalSources));

    // The synthesis model may differ from the research model (LLM_MODEL_SYNTHESIS): the
    // answer is the one call worth a pricier model, so it is the one call that opts in.
    const synthesisLlm = input.providers.synthesisLlm ?? input.providers.llm;

    // The synthesis call is NOT gated on the wall clock: when a cap has been hit the contract
    // still wants an honest partial answer, and the answer is the only thing that says so.
    const synth = await callLlm(
      deps,
      {
        system: synthesisSystemPrompt({ mode: input.mode, depth: 'quick', memories: research.memories }),
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
        usage,
        spend,
        llm: synthesisLlm
      },
      (text) => {
        if (ttftMs === 0) ttftMs = now() - startedAt;
        input.emit('token', TokenEvent.parse({ text }) satisfies TokenEvent);
      }
    );

    const answer = synth.text;
    warnOnUnresolved(input.log, input.requestId, answer, finalSources);

    return {
      answerId: newId('ans'),
      answer,
      sources: finalSources,
      toolCalls,
      terminated,
      usage,
      costUsd: totalCost(spend.usd, uncachedSearches, embeddingTokens),
      searchCached: searchCount > 0 && searchHits === searchCount,
      ttftMs,
      latencyMs: now() - startedAt,
      // The model that wrote the answer, not the one that researched it.
      model: synthesisLlm.model
    };
  } catch (err) {
    // Only a provider exception lands here. It ends the run — no plausible answer, no empty
    // success. The caller turns this into a 502 or an `error` frame.
    return {
      answerId: newId('ans'),
      answer: '',
      sources: sources.toSources(input.query),
      toolCalls,
      terminated: 'error',
      error: scrub(`${(err as Error).message}`),
      usage,
      costUsd: totalCost(spend.usd, uncachedSearches, embeddingTokens),
      searchCached: searchCount > 0 && searchHits === searchCount,
      ttftMs,
      latencyMs: now() - startedAt,
      model: (input.providers.synthesisLlm ?? input.providers.llm).model
    };
  }
}

/**
 * Every dollar this request spent: LLM dollars already priced call-by-call (`spend.usd` from
 * `callLlm` — a run can mix a research model and a synthesis model, so the price has to be
 * summed per call, not computed once here against one model), one flat rate per uncached
 * provider search, and the embedding tokens THIS request asked for.
 *
 * The embedding term used to read `providers.embedder.tokensUsed`, which is cumulative for the
 * life of the process — so the hundredth answer in a session was billed for the ninety-nine
 * before it, and `costUsd` drifted upward all day. The counter now comes from the loop.
 */
export function totalCost(llmUsd: number, uncachedSearches: number, embeddingTokens: number): number {
  return llmUsd + uncachedSearches * SEARCH_USD_PER_CALL + embeddingCostUsd(embeddingTokens);
}

/**
 * Do NOT rewrite the streamed text: the user has already seen it, and silently patching it
 * would hide exactly the failure this check exists to find.
 */
export function warnOnUnresolved(log: Logger, requestId: string, answer: string, sources: Source[]): void {
  const unresolved = unresolvedCitations(answer, sources);
  if (!unresolved.length) return;
  log.warn(
    { requestId, unresolved, citable: sources.map((s) => s.n) },
    'answer cites source numbers that are not in the sources event'
  );
}

/**
 * Build the `done` event and validate it against the contract before it goes on the wire.
 * `depth` and `subQuestions` are the caller's, not the request's: the client asked, and the
 * server reports what it actually ran.
 */
export function doneEventFor(result: QuickLoopResult, depth: Depth = 'quick', subQuestions = 0): DoneEvent {
  return DoneEvent.parse({
    answerId: result.answerId,
    latencyMs: result.latencyMs,
    ttftMs: result.ttftMs,
    model: result.model,
    tokens: { in: result.usage.input + result.usage.cacheRead + result.usage.cacheWrite, out: result.usage.output },
    costUsd: Number(result.costUsd.toFixed(6)),
    searchCached: result.searchCached,
    terminated: result.terminated,
    depth,
    subQuestions
  });
}
