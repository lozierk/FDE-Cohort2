# Week 2 build spec, part B: Deep search — Claude_Build

Written 2026-09-14 by Claude (session 5). Builds on part A (`docs/week2-rag-build-spec.md`),
which must be merged first. Read alongside `SPEC.md` §5.5, §7, `AGENTS.md` "Deep search",
`TECHNICAL.md` Part 1 item 8, `packages/contract/src/sse.ts` (PlanEvent, SubQuestion,
TraceEvent.subQuestion, Source.subQuestion, DoneEvent), and `benchmark/bench.mjs` phase 4
(`runDeepSearch`, `scoreDeep`, `probeDeepCap`) which is what grades this. 15 of 100 points.

## Hard rules (automatic fail if broken)
- Never edit `web/`, `packages/contract/`, `benchmark/`, `eval/`, `quality/`, `scripts/`, `backend/gateway/`.
- No new npm dependencies. Do not print or copy `.env` or any key.
- Do not raise `MAX_TOOL_CALLS_DEEP` (24), `MAX_WALL_CLOCK_SEC_DEEP` (240), `DEEP_DAILY_CAP` (5),
  `DEEP_SUB_QUESTIONS_MIN/MAX` (3/6), or any quick cap. All come from `env.ts` already.
- `depth` is opted into. The quick loop must stay incapable of calling the planner: `plan_research`
  never enters `ALL_TOOLS` or `toolsForMode()`. The deep loop calls the planner directly.
- The `plan` event is emitted before any retrieval tool runs. The loop enforces the order, not the prompt.
- Every retrieval `trace` step (`web_search`, `fetch_page`, `search_documents`) and every `source`
  on a deep run carries `subQuestion`. One citation numbering, contiguous from 1.
- The daily cap is reserved atomically before planning and refunded if planning fails before any retrieval.
- Fail loud. A provider exception ends the run with `terminated: "error"` and a `502` (or an `error` frame after headers).
- `npm test` and `npm run typecheck` stay green; existing quick-loop tests are unchanged in behaviour.

## 1. What the grader measures
From `bench.mjs` phase 4 and `sla.json`, all arithmetic on the stream:
- `deepPlan`: every deep run has ≥ 3 sub-questions in `plan.subQuestions` AND `plan` arrived
  before the first `web_search`/`fetch_page`/`search_documents` trace step. `deep_plan_p95_ms ≤ 4000`.
- `deepAttribution`: every retrieval trace step has an integer `subQuestion`; every source has one.
  (`plan_research` and `recall_memory` steps are exempt.)
- `deepReadsMore`: distinct sources (dedupe by `url`, or `docId:page|heading`) in the deep run ≥ 2.0×
  the same question run quick, mode web, on a fresh user. Quick on a fresh web thread reads
  1–2 searches → 3–8 citable sources today. Deep must show ≥ 2× of that in its `sources` event.
- `deepBudget`: `done.costUsd ≤ 0.35` and ≤ 24 trace steps. `deep_answer_p95_s ≤ 90`.
- `deepCap429`: on a throwaway user, the (cap+1)th deep ask returns HTTP `429` with a JSON body
  carrying `resetsAt`. The bench reads the cap from `/stats.deepDailyCap`.
- `quickNeverEscalates`: no quick run's trace contains `plan_research`.
- Rubric (manual): structured answer — direct answer, a section per sub-question, what is still unknown.

## 2. Files to create or change (agent service only)
```
src/loop/research.ts      NEW   the research phase extracted from quick.ts (§4.1); quick.ts calls it, behaviour unchanged
src/loop/quick.ts         EDIT  use research.ts; no other change
src/loop/deep.ts          NEW   runDeepLoop(): reserve → plan → fan-out → merge → synthesis
src/loop/planner.ts       NEW   planResearch(): the forced plan_research call, validation, one retry
src/loop/prompts.ts       EDIT  plannerSystemPrompt, plannerUserContent, deep synthesis content (§5)
src/loop/sources.ts       EDIT  Candidate.subQuestion (first appearance wins); toSources/toPassages pass it through;
                                toPassages(query, …) gains an optional per-sub-question selection helper (§4.3)
src/providers/llm.ts      EDIT  LlmRequest.toolChoice?: { name: string }
src/providers/anthropic.ts EDIT  map toolChoice → tool_choice: { type: 'tool', name }
src/providers/fake-llm.ts EDIT  accept and ignore toolChoice
src/store/deep-quota.ts   NEW   reserveDeep(userId) / refundDeep(userId), collection deepQuota (§3)
src/store/index.ts        EDIT  appendMessage accepts subQuestions; index for deepQuota
src/routes/ask.ts         EDIT  depth === 'deep' → cap → runDeepLoop; persist subQuestions; run log depth 'deep'
src/routes/threads.ts     EDIT  GET /threads/:id returns subQuestions on assistant messages when present
src/runlog.ts             EDIT  accept the deep result type (same fields) — no shape change
src/env.ts                EDIT  DEEP_CONCURRENCY, DEEP_SUB_TOOL_CALLS, DEEP_PASSAGES_PER_SUB, DEEP_PASSAGE_LIMIT (§3)
src/config/model.ts       EDIT  MAX_TOKENS.plan = 1024, MAX_TOKENS.deepSynthesis = 6144
test/deep.test.ts         NEW   §7
bin/ask.py                EDIT  --depth deep flag; print plan, per-sub-question source counts, distinct sources
```

## 3. Config, env, and the cap
| Env var | Default | Meaning |
|---|---|---|
| `DEEP_CONCURRENCY` | `3` | sub-questions researched at once |
| `DEEP_SUB_TOOL_CALLS` | `4` | tool calls one sub-question may spend, preflight included; the shared 24 cap still binds |
| `DEEP_PASSAGES_PER_SUB` | `4` | passages synthesis reads per sub-question |
| `DEEP_PASSAGE_LIMIT` | `20` | passages synthesis reads in total |

Add each to `.env.example` with a comment. Existing: `DEEP_DAILY_CAP`, `DEEP_SUB_QUESTIONS_MIN/MAX`,
`MAX_TOOL_CALLS_DEEP`, `MAX_WALL_CLOCK_SEC_DEEP`.

**Cap** (`src/store/deep-quota.ts`). Collection `deepQuota`, `_id = "${userId}:${YYYY-MM-DD}"`
(UTC day, the same day boundary `/stats` uses), fields `count`, `expiresAt` (UTC midnight + 48 h,
TTL index `expireAfterSeconds: 0`). `reserveDeep(userId, cap)`:
`findOneAndUpdate({ _id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { upsert: true, returnDocument: 'after' })`.
If the returned `count > cap`: `$inc: { count: -1 }` and return `{ ok: false, resetsAt }` where
`resetsAt` is the next UTC midnight as ISO. Otherwise `{ ok: true }`. `refundDeep(userId)` does
the `-1`. Concurrent requests cannot both pass on the last credit because `$inc` is atomic.
`/stats.deepToday` keeps counting `requests` rows; it is a report, the quota is the gate. Note in
a comment that the two can differ by refunded planning failures.

## 4. The deep loop (`src/loop/deep.ts`)
`runDeepLoop(input)` takes the same input as `runQuickLoop` plus `caps` from the deep envelope,
`deep: { subQuestionsMin, subQuestionsMax, concurrency, subToolCalls, passagesPerSub, passageLimit }`,
and an `emit` that also accepts `'plan'`. Returns `QuickLoopResult & { subQuestions: SubQuestion[] }`.

Order of operations, and the reasons the order is fixed:
1. **Reserve** the cap in `routes/ask.ts` before anything else. Over cap → `sendError(res, 429, 'deep search daily cap reached', { resetsAt })`
   (the `ErrorBody` extra field). No thread lookup cost before the cap check is fine; do the
   thread `404` check first anyway so a bad thread does not burn a credit.
2. **Plan** (`planner.ts`). One LLM call, tools = `[plan_research]` only, `toolChoice: { name: 'plan_research' }`,
   `maxTokens: MAX_TOKENS.plan`. Schema: `{ subQuestions: [{ question, reason }], reason }`. Validate:
   `subQuestionsMin ≤ length ≤ subQuestionsMax` after trimming blanks and deduping
   (case-insensitive); if more than max, keep the first max; if fewer than min, retry once with the
   validation message appended to the user turn. Second failure → throw `ProviderFailure('plan_research returned an invalid plan: …')`.
   Emit a `trace` step `{ tool: 'plan_research', input: { question }, ok, ms, reason: plan.reason }`
   (no `subQuestion` field; it serves the whole question). Then emit `plan` with `i` numbered from 1.
   A planner failure → `refundDeep`, and the route answers `502` (headers are not out yet: the
   plan is the first frame). Time budget: the planner is one Haiku turn; keep the prompt short.
3. **Fan-out** with a pool of `DEEP_CONCURRENCY` over the sub-questions. Each runs
   `runResearch()` (§4.1) with: its own message history (opener = thread history + the main
   question for context + "Sub-question i: …"), the shared `SourceRegistry`, the shared tool-call
   counter and wall clock, `subQuestion: i` stamped on every trace step and every source it
   registers, and a per-sub budget of `DEEP_SUB_TOOL_CALLS`. Preflight exactly as quick does:
   `web_search(subQuestion)` when mode is `web`/`auto`, `search_documents(subQuestion)` when a
   `spaceId` is attached and mode is `docs`/`auto` (both when `auto` with a space). A sub-question
   that hits its own budget stops with "ready"; only the shared 24/240 cap sets `terminated: 'cap'`.
   The pool must stop launching new sub-questions once the shared cap is reached.
4. **Merge** is free: one registry, numbers on first appearance, dedupe by url / docId+locator.
   `sources` event = `registry.toSources(mainQuestion)` with `subQuestion` on each entry.
5. **Synthesis**: one streaming call, `MAX_TOKENS.deepSynthesis`. Passages: for each sub-question,
   the top `DEEP_PASSAGES_PER_SUB` of that sub-question's own candidates by overlap with the
   sub-question; union; cap at `DEEP_PASSAGE_LIMIT`, back in number order. The synthesis user
   content lists the plan, then the passages grouped under `Sub-question i: …` headings.
   Structure demanded by the prompt (§5). `sources` goes out before the first token, as in quick.
6. **Done**: `depth: 'deep'`, `subQuestions: plan.length`, `model`, measured cost and tokens across
   planner + every research turn + synthesis. Run log `depth: 'deep'`. The assistant message
   persists `subQuestions` (the `SubQuestion[]`), and `GET /threads/:id` returns it.

### 4.1 `runResearch()` (`src/loop/research.ts`)
Extract phase 1 of `runQuickLoop` (opener, preflight, the tool loop, the citable-numbers notice)
into a function with this shape:
```
runResearch({
  question, subQuestion?, contextLines: string[],   // opener text before "Question:"
  mode, tools, registry, ctx, budget: { toolCalls: () => number /* remaining */, capReached: () => boolean },
  perCallBudget?: number, preflight: boolean, emit, callLlm, usage, log, now
}) → { toolCalls: RunToolCall[], terminated: 'done' | 'cap' }
```
`runQuickLoop` calls it once with `subQuestion` undefined; every existing test passes unchanged.
The trace step builder stamps `subQuestion` when defined. `registry.add` gets `subQuestion` from ctx.

### 4.2 Ratio safety
Quick on the bench's deep questions (mode web, fresh thread) will register 5 search results and
fetch 0–2 pages; citable ≈ 3–8. Deep with 3–6 sub-questions × 5 results + fetches should register
15–30 citable. If a measured ratio is under 2.0 on any of the four `benchmark/queries.json` deep
questions, the fix is more sub-question breadth or one more fetch per sub-question, never fewer
quick sources.

### 4.3 Registry additions (`sources.ts`)
`Candidate.subQuestion?: number` set on first `add`. `toSources` and `toPassages` include it.
Add `toPassagesFor(subQuestion, query, limit)` that ranks only that sub-question's candidates.
Existing `sources.test.ts` unchanged.

## 5. Prompts (`prompts.ts`)
- `plannerSystemPrompt(ctx)`: LUMINA's planning step; today line; "Break the question into
  N–M independent sub-questions a search engine can answer, each with a one-line reason. Cover
  the distinct parts of the question, the comparison axes, and the numbers someone would need.
  Do not answer." Tool description on `plan_research` says the same in one sentence.
- Research prompt: unchanged text; the sub-question opener carries the main question for context.
- `synthesisSystemPrompt` with `depth: 'deep'` already appends the structure line. Strengthen it to:
  "Structure: (1) a direct answer in 2–4 sentences; (2) one section per sub-question, with the
  sub-question as its heading, in plan order; (3) a final section titled 'What is still unknown'
  naming what the passages did not settle. Cite every factual sentence." Markdown headings are fine;
  the UI renders markdown.
- `deepSynthesisUserContent({ query, history, plan, passagesBySub })`.

## 6. Route (`routes/ask.ts`)
Replace the `501 deep search not built yet` branch: thread `404` check → `reserveDeep` →
`runDeepLoop` with `caps: { maxToolCalls: env.maxToolCallsDeep, maxWallClockSec: env.maxWallClockSecDeep }`.
On `terminated === 'error'` from the planner (no headers out) the route refunds and answers `502`;
on any error after the plan frame, the error frame goes out and the credit stays spent (retrieval
happened). Persistence and run log as quick, with `depth: 'deep'` and `subQuestions`.

## 7. Tests (`test/deep.test.ts`, fakes, in-memory Mongo)
Script the FakeLlm per request: turn 1 = `tool_use plan_research` with 3 sub-questions; then per
sub-question one `web_search` turn and one `ready`; then the synthesis text citing `[1]` and `[2]`.
- Frame order: `trace(plan_research)` → `plan` → retrieval traces → `sources` → `token` → `done`;
  `plan` precedes every retrieval trace.
- Every retrieval trace and every source has `subQuestion`; numbering is 1..n contiguous; the same
  url found by two sub-questions appears once with the first sub-question.
- `done.depth === 'deep'`, `done.subQuestions === 3`; run log file has `depth: 'deep'`;
  `GET /threads/:id` shows `subQuestions` on the assistant message.
- Planner returns 2 sub-questions twice → `502`, no `plan` frame, and the next deep ask on the same
  user still succeeds (refund worked: assert the quota count).
- Cap: `DEEP_DAILY_CAP` is read from env at boot, so run this test with a small cap set before the
  env import (like `RUNS_DIR` is): cap+1 asks → the last is `429` with `resetsAt` ISO string.
- Shared cap: FakeLlm scripted to request tools forever → run ends `terminated: 'cap'` at 24 trace
  steps, honest partial answer streamed.
- A quick ask whose FakeLlm asks for `plan_research` → refused as today (not traced under that name); `done.depth === 'quick'`.

## 8. Acceptance (I run these on Atlas + real providers after review)
1. `npm run typecheck && npm test` green.
2. `python3 bin/ask.py --depth deep "<bench deep question 1>"`: plan within 4 s, 3–6 sub-questions
   worth asking (read them out loud, per TECHNICAL.md item 8: if they are not ones we would have
   asked, fix the planner prompt before anything else), every trace step tagged, sources ≥ 2× the
   quick run of the same question, cost ≤ $0.35, wall clock ≤ 90 s.
3. Repeat for the other three bench deep questions; record plan ms, sources, ratio, cost, seconds.
4. Cap probe on a throwaway user: 6th deep ask → `429` with `resetsAt`.
5. Deep under ingest: upload `fixtures/bench-60p.pdf` (sha256 in `fixtures/README.md`) to a Space
   and, while it is `parsing`/`embedding`, run one deep ask on the same question as step 2. Plan
   time and wall clock must stay inside the step 2 numbers by no more than 1.3×, and the document
   must still reach `indexed`. Record both runs side by side with the fixture hash.

## 9. Out of scope
Follow-up reuse of a sub-question's pages (Could). User-editable plans (Could). Deep in docs mode
beyond what the preflight gives. Any gateway or deploy change.

## 10. Report back with
File list; test counts before/after; three real plans read out loud with a one-line judgment
each; the measured table from acceptance 2–3 if you ran it; anything not done, stated plainly.
