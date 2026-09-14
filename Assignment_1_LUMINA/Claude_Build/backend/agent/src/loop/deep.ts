import {
  PlanEvent,
  SourcesEvent,
  TokenEvent,
  TraceEvent,
  newId,
  type Source,
  type SubQuestion,
  type Terminated,
} from "@lumina/contract";
import { env } from "../env.js";
import { scrub } from "../log.js";
import { MAX_TOKENS, emptyUsage } from "../config/model.js";
import { toolsForMode } from "../tools/index.js";
import type { ToolContext } from "../tools/types.js";
import { planResearch } from "./planner.js";
import {
  deepSynthesisUserContent,
  researchSystemPrompt,
  synthesisSystemPrompt,
} from "./prompts.js";
import {
  callLlm,
  runResearch,
  type ResearchBudget,
  type RunToolCall,
} from "./research.js";
import {
  totalCost,
  warnOnUnresolved,
  type QuickLoopInput,
  type QuickLoopResult,
} from "./quick.js";
import { SourceRegistry, type Passage } from "./sources.js";

/**
 * Deep search: reserve → plan → fan out → merge → synthesise.
 *
 * The order is the feature. The plan is emitted BEFORE any retrieval because a plan streamed
 * after the fetches is a rationalisation of what happened, not a decision about what to do —
 * and the loop enforces that ordering rather than asking a prompt to. Everything the
 * sub-questions find lands in ONE registry, so the merge is free and the citation numbering
 * is one numbering by construction rather than by a renumbering pass nobody can audit.
 */

export interface DeepConfig {
  subQuestionsMin: number;
  subQuestionsMax: number;
  concurrency: number;
  subToolCalls: number;
  passagesPerSub: number;
  passageLimit: number;
}

export interface DeepLoopInput extends Omit<QuickLoopInput, "emit"> {
  deep: DeepConfig;
  /** Same as quick, plus the `plan` frame that goes out before anything is retrieved. */
  emit(event: "plan" | "trace" | "sources" | "token", data: unknown): void;
}

export interface DeepLoopResult extends QuickLoopResult {
  subQuestions: SubQuestion[];
  /** True when the run died in the planner, before any retrieval — the route refunds the credit. */
  failedBeforeRetrieval?: boolean;
}

export async function runDeepLoop(
  input: DeepLoopInput,
): Promise<DeepLoopResult> {
  const now = input.now ?? (() => Date.now());
  const startedAt = now();
  const elapsedSec = () => (now() - startedAt) / 1000;

  const sources = new SourceRegistry();
  const toolCalls: RunToolCall[] = [];
  const usage = emptyUsage();
  /** LLM dollars, priced per call against the model that made it — see callLlm in research.ts. */
  const spend = { usd: 0 };
  let terminated: Terminated = "done";
  let ttftMs = 0;
  let step = 0;
  let uncachedSearches = 0;
  let searchCount = 0;
  let searchHits = 0;
  let embeddingTokens = 0;
  let plan: SubQuestion[] = [];

  const allowed = toolsForMode(input.mode);
  const history = input.history.slice(-10);

  /**
   * One failure ends the run. Every provider call in the fan-out shares this controller, so
   * the first exception cancels the other sub-questions' in-flight calls instead of leaving
   * them to spend money on a request whose `error` frame has already gone out. Chained to
   * the request's own signal so a client that disconnects still cancels everything.
   */
  const abort = new AbortController();
  const signal = input.signal
    ? AbortSignal.any([input.signal, abort.signal])
    : abort.signal;
  let failure: Error | undefined;
  const deps = {
    providers: input.providers,
    requestId: input.requestId,
    log: input.log,
    signal,
  };
  // Nothing goes out after the run has decided it failed: the route's `error` frame is last.
  const emit: DeepLoopInput["emit"] = (event, data) => {
    if (!failure) input.emit(event, data);
  };

  /**
   * ONE envelope for the whole request, shared by every sub-question. Per-sub-question
   * budgets sit inside it: a sub-question that spends its four calls stops, but the 24 and
   * the 240 s are the request's and nothing resets them.
   */
  let inFlight = 0;
  const budget: ResearchBudget = {
    toolCalls: () => input.caps.maxToolCalls - toolCalls.length - inFlight,
    // A failed sibling counts as the cap for the workers still running: they stop at their
    // next step without another model turn, and the run reports the failure, not `cap`.
    capReached: () =>
      failure !== undefined || elapsedSec() >= input.caps.maxWallClockSec,
    nextStep: () => (step += 1),
    claim: () => {
      inFlight += 1;
    },
    record: (call) => {
      inFlight -= 1;
      toolCalls.push(call);
    },
  };

  const baseCtx = {
    userId: input.userId,
    threadId: input.threadId,
    requestId: input.requestId,
    ...(input.spaceId ? { spaceId: input.spaceId } : {}),
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
    signal,
    log: input.log,
  };

  // The model that writes the answer, not the one that researched it — same reasoning as
  // quick.ts. Computed once: neither provider changes mid-request.
  const synthesisLlm = input.providers.deepSynthesisLlm ?? input.providers.synthesisLlm ?? input.providers.llm;

  const result = (over: Partial<DeepLoopResult>): DeepLoopResult => ({
    answerId: newId("ans"),
    answer: "",
    sources: sources.toSources(input.query),
    toolCalls,
    terminated,
    subQuestions: plan,
    usage,
    costUsd: totalCost(spend.usd, uncachedSearches, embeddingTokens),
    searchCached: searchCount > 0 && searchHits === searchCount,
    ttftMs,
    latencyMs: now() - startedAt,
    model: synthesisLlm.model,
    ...over,
  });

  // ---------------------------------------------------------------- phase 0: the plan
  try {
    const planned = await planResearch({
      query: input.query,
      history,
      min: input.deep.subQuestionsMin,
      max: input.deep.subQuestionsMax,
      callLlm: (req) => callLlm(deps, { ...req, usage, spend }),
      log: input.log,
      requestId: input.requestId,
      now,
    });
    plan = planned.subQuestions;

    /**
     * The planner serves the WHOLE question, so this step carries no `subQuestion` — and the
     * bench exempts it from the attribution check for exactly that reason.
     *
     * It is charged to the shared budget like any other step, because the budget gate counts
     * TRACE STEPS: leaving the plan uncharged makes a run that used every one of its 24
     * retrieval calls emit 25 steps and fail a cap it never actually broke.
     */
    budget.claim();
    const planStep = TraceEvent.parse({
      step: budget.nextStep(),
      tool: "plan_research",
      input: { question: input.query },
      ok: true,
      ms: planned.ms,
      ...(planned.reason ? { reason: planned.reason } : {}),
    });
    budget.record({ name: "plan_research", ok: true, ms: planned.ms });
    emit("trace", planStep);
    emit(
      "plan",
      PlanEvent.parse({
        subQuestions: plan,
        ...(planned.reason ? { reason: planned.reason } : {}),
      }),
    );
  } catch (err) {
    // Nothing was retrieved and no frame is out yet, so the route can still answer 502 with
    // a JSON body — and it refunds the deep credit, because no research happened.
    input.log.error(
      { requestId: input.requestId, err: (err as Error).message },
      "deep search failed in the planner",
    );
    terminated = "error";
    return result({
      terminated: "error",
      error: scrub((err as Error).message),
      failedBeforeRetrieval: true,
    });
  }

  try {
    // ---------------------------------------------------------------- phase 1: fan-out
    const contextLines: string[] = [];
    if (history.length) {
      contextLines.push("Earlier in this thread (oldest first):");
      for (const m of history)
        contextLines.push(`${m.role}: ${m.content.slice(0, 600)}`);
      contextLines.push("");
    }
    // Every sub-question is researched alone, but it is told the question it is part of:
    // "which one is cheaper" is unanswerable without knowing what is being compared.
    contextLines.push(`The user's full question: ${input.query}`, "");

    const researchSystem = researchSystemPrompt({
      mode: input.mode,
      depth: "deep",
      ...(input.space ? { space: input.space } : {}),
    });

    /**
     * A pool rather than `Promise.all` over everything: `DEEP_CONCURRENCY` bounds how many
     * provider calls are in flight, and — the part that matters for the bill — a worker
     * checks the SHARED cap before it starts the next sub-question, so a run that has used
     * its 24 calls stops launching work instead of queueing six more preflights.
     */
    /**
     * The per-sub-question budget is derived, not just configured: `DEEP_SUB_TOOL_CALLS`
     * times the plan size, plus the plan step, has to fit inside the shared cap. Otherwise a
     * six-question plan that spends every call ends `terminated: 'cap'` on work that
     * finished — and the quality checker (rule A2) fails any run that did not end `done`.
     * Six sub-questions get three calls each; five or fewer keep the configured four.
     */
    const perSub = Math.max(
      1,
      Math.min(
        input.deep.subToolCalls,
        Math.floor((input.caps.maxToolCalls - 1) / plan.length),
      ),
    );

    let next = 0;
    let researched = 0;
    const width = Math.max(1, Math.min(input.deep.concurrency, plan.length));
    const workers = Array.from({ length: width }, async () => {
      for (;;) {
        if (budget.capReached() || budget.toolCalls() <= 0) return;
        const sq = plan[next++];
        if (!sq) return;
        researched += 1;

        const ctx: ToolContext = { ...baseCtx, depth: 1, subQuestion: sq.i };
        let phase: Awaited<ReturnType<typeof runResearch>>;
        try {
          phase = await runResearch({
            question: sq.question,
            subQuestion: sq.i,
            contextLines: [
              ...contextLines,
              `Sub-question ${sq.i} of ${plan.length}.`,
            ],
            mode: input.mode,
            tools: allowed,
            registry: sources,
            ctx,
            budget,
            perCallBudget: perSub,
            // Every sub-question opens with a real retrieval call. That is what makes the fan-out
            // read more than a quick search rather than reasoning more about the same pages.
            preflight: {
              web: input.mode === "web" || input.mode === "auto",
              docs:
                Boolean(input.spaceId) &&
                (input.mode === "docs" || input.mode === "auto"),
            },
            docsExtraSearches: env.docsExtraSearches,
            system: researchSystem,
            emit,
            callLlm: (req) => callLlm(deps, { ...req, usage, spend }),
            log: input.log,
            requestId: input.requestId,
            now,
          });
        } catch (err) {
          // First failure wins; the siblings' abort errors that follow are its consequence.
          if (!failure) {
            failure = err as Error;
            abort.abort();
          }
          return;
        }
        if (phase.terminated === "cap") terminated = "cap";
      }
    });
    await Promise.allSettled(workers);
    if (failure) throw failure;
    // A sub-question the pool never got to is the cap doing its job, and the answer has to
    // say so rather than present four sections out of six as the whole of the research.
    if (researched < plan.length) terminated = "cap";

    // ---------------------------------------------------------------- phase 2: merge
    // The merge is free because there was only ever one registry: numbers were assigned on
    // first appearance, duplicates folded into the candidate that already held that url or
    // docId+locator, and each kept the sub-question that found it first.
    const finalSources: Source[] = sources.toSources(input.query);
    emit("sources", SourcesEvent.parse(finalSources));

    // ---------------------------------------------------------------- phase 3: synthesis
    const passagesBySub = selectPassages(sources, plan, input.deep);

    const synth = await callLlm(
      deps,
      {
        system: synthesisSystemPrompt({ mode: input.mode, depth: "deep" }),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: deepSynthesisUserContent({
                  query: input.query,
                  history,
                  plan,
                  passagesBySub,
                }),
              },
            ],
          },
        ],
        maxTokens: MAX_TOKENS.deepSynthesis,
        usage,
        spend,
        llm: synthesisLlm,
      },
      (text) => {
        if (ttftMs === 0) ttftMs = now() - startedAt;
        emit("token", TokenEvent.parse({ text }) satisfies TokenEvent);
      },
    );

    warnOnUnresolved(input.log, input.requestId, synth.text, finalSources);
    return result({ answer: synth.text, sources: finalSources, terminated });
  } catch (err) {
    // A provider exception after the plan frame. The stream is already open, so the route
    // sends an `error` frame — and the credit stays spent, because retrieval happened.
    failure ??= err as Error;
    return result({
      terminated: "error",
      error: scrub(`${(err as Error).message}`),
    });
  }
}

/**
 * What synthesis reads: each sub-question's own best `passagesPerSub`, then the whole set
 * trimmed to `passageLimit` by taking one from each sub-question in turn.
 *
 * Round-robin rather than "the first N": six sub-questions at four passages each is 24 for a
 * limit of 20, and slicing a flat list would silently leave the last sub-question with
 * nothing to write its section from.
 */
function selectPassages(
  registry: SourceRegistry,
  plan: SubQuestion[],
  deep: DeepConfig,
): { i: number; question: string; passages: Passage[] }[] {
  const perSub = plan.map((sq) => ({
    i: sq.i,
    question: sq.question,
    ranked: registry.toPassagesFor(sq.i, sq.question, deep.passagesPerSub),
  }));

  const keep = new Set<number>();
  const depth = Math.max(0, ...perSub.map((g) => g.ranked.length));
  for (let rank = 0; rank < depth && keep.size < deep.passageLimit; rank++) {
    for (const group of perSub) {
      if (keep.size >= deep.passageLimit) break;
      const p = group.ranked[rank];
      if (p) keep.add(p.n);
    }
  }

  return perSub.map((g) => ({
    i: g.i,
    question: g.question,
    passages: g.ranked.filter((p) => keep.has(p.n)).sort((a, b) => a.n - b.n),
  }));
}
