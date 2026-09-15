# LUMINA

Ask a question, get a streamed answer with citations you can click, drawn from a live web search and from your own documents.

**Live:** [UI](https://lumina-claude.vercel.app) · [evals](https://lumina-claude.vercel.app/evals) · [gateway health](https://lumina-claude-gateway.fly.dev/health) · [repo](https://github.com/lozierk/Claude_Build_Submission)

Assignment 1 of Hamza Farooq's Forward Deployed Engineering bootcamp, cohort 02. The React UI, the API contract, the benchmark, the grader and the gold set were provided. The two backend services are mine.

## What it does

- Streams a cited answer from a live web search, from uploaded documents, or both, with sources on screen before the first token.
- Keeps thread history and long-term memory. A preference saved in one thread reaches the next, and the user can list and delete every memory.
- Deep mode plans at least three sub-questions, streams the plan before retrieving anything, researches each, and merges every citation into one numbering.
- Holds spend gates: a per-answer cost cap, 24 tool calls per deep run, and five deep searches per user per day. Request six returns 429 with `resetsAt`.
- Serves an `/evals` page that renders the grader's own report: gates, rubric, trajectories.

## Measured, on the deployed app

Run with the course's own harness, `eval/eval.mjs --deploy-url`, against the deployed gateway on 2026-09-15. Automated 82 of 85, 15 manual points pending.

| Metric | Measured | Gate | |
|---|---|---|---|
| TTFT p95 (web) | 1,217 ms | 2,500 ms | pass |
| Answer p95 | 5,038 ms | 12,000 ms | pass |
| Upload 202 accept p95 | 89 ms | 300 ms | pass |
| Citation grounding | 0.966 | 0.95 | pass |
| Recall@5, 30 gold questions | 1.00 | 0.70 | pass |
| Search cache hit rate | 100% | 50% | pass |
| Error rate | 0 of 199 runs | 1% | pass |
| Cost per quick answer | $0.0031 | $0.05 | pass |
| Cost per deep answer | $0.143 | $0.35 | pass |
| Deep answer p95 | 85.9 s | 90 s | pass |
| Deep / quick source ratio | 4.2x | 2x | pass |
| **Deep plan p95** | **4,045 ms** | **4,000 ms** | **fail** |

The last row is the one miss, 45 ms over, and the slowest of four planner calls; the other three came back in 2.2 to 2.4 s. I reported it as measured and did not re-roll for a green.

Rubric awarded: contract 10/10, cited answers 20/20, memory 10/10, RAG 15/15, deep search 15/15, logging 5/5, performance 7/10. Red lines clear.

## Stack

The provided React UI ships static on Vercel. An Express gateway is the only public service, on Fly: CORS, the `X-User-Id` check, validation, a per-user rate limit, byte-level SSE pass-through, and the eval report. The agent runs private on Fly with no public IP, so provider keys never sit behind a public route. Storage is MongoDB Atlas M0: Atlas Vector Search and Atlas Search (BM25) fused by reciprocal rank fusion. Search is Tavily with raw page content and a six-hour cache in Atlas. Models split by where the difference shows: Claude Haiku 4.5 for planning, research and quick answers, Claude Sonnet 5 for the deep answer only. Embeddings are OpenAI `text-embedding-3-small`. The trade-off has numbers: deep fetches whole pages and pays for Sonnet, so it runs at 86 s p95 and $0.14 against a 90 s and $0.35 gate. That buys 36 fetched sources across five sub-questions on the benchmark deep question, well past snippet-only alternatives.

## For engineering leaders

1. **Termination is explicit, never inferred.** Every run ends `done`, `cap` or `error`, set in the loop and carried into the `done` event. Error runs go to `runs/failing/` at write time, so an honest failure cannot score as a success. → [`backend/agent/src/loop/quick.ts`](backend/agent/src/loop/quick.ts), [`backend/agent/src/runlog.ts`](backend/agent/src/runlog.ts)
2. **A document is `indexed` only after a read-your-write probe.** An Atlas Search index is eventually consistent: an acknowledged write is not yet a searchable chunk. The probe runs the same `$vectorSearch` the retrieval tool runs, with the chunk's own embedding, and asks for that chunk back, retrying across about 63 s of backoff before failing loudly. Without it a document looks fine and answers "no matching passages", the most expensive kind of wrong. → [`backend/agent/src/ingest/probe.ts`](backend/agent/src/ingest/probe.ts)
3. **Web mode answers from a preflight search keyed on the user's own words.** No model turn is spent deciding to search when the mode already said so. Repeats hit the cache, and sources stream before the first token. A heuristic marks the follow-ups that still need the turn. → [`backend/agent/src/loop/research.ts`](backend/agent/src/loop/research.ts), [`backend/agent/src/loop/standalone.ts`](backend/agent/src/loop/standalone.ts)
4. **The deep loop is a bounded pool over the plan.** Concurrency is capped, and each worker checks the shared 24-call budget before starting the next sub-question, so a run out of budget stops launching work instead of queueing more preflights. Every step and source carries its sub-question tag. → [`backend/agent/src/loop/deep.ts`](backend/agent/src/loop/deep.ts)
5. **Nothing waits forever, and retries are ours.** Every tool call runs under a 20 s deadline and a timed-out tool is a failed step with an error, never a run that never ends. The Anthropic client runs with SDK retries off and an explicit policy instead: at most two retries, each wait capped at 2 s whatever the provider's `retry-after` says, only before the first token, abortable when the client disconnects. Retrieved page text reaches the model inside an `<untrusted_source>` boundary, as data to cite rather than instructions to follow. → [`backend/agent/src/tools/with-deadline.ts`](backend/agent/src/tools/with-deadline.ts), [`backend/agent/src/providers/llm-retry.ts`](backend/agent/src/providers/llm-retry.ts)

The gateway pipes the agent's SSE bytes through chunk by chunk with no parsing, so frame order survives, and aborts upstream when the client disconnects. → [`backend/gateway/src/app.ts`](backend/gateway/src/app.ts)

## Three bugs worth the interview

**1. A model turn kept for flexibility set the p95.** With a Space attached, auto mode searched the documents, then spent a model turn on whether to add the web. On the benchmark's `mode=auto` probe it spent that turn fetching a document source over HTTP, which cannot work, then searched: 6.9 s and 9.4 s to first token, and the eval's smoke gate blocks every gate after it. A productive document search now goes straight to synthesis. TTFT fell to 0.4 to 1.0 s (DESIGN v1.5, trade-off 10).

**2. Markdown is not page text.** Tavily returns raw content as markdown; the grader scores grounding against tag-stripped HTML. Snippets opening with a markdown link matched nothing, and grounding sat at 0.913 against a 0.95 gate. Raw content is now cleaned to plain text, link text kept, syntax dropped. One subtlety cost a run: the six-hour cache held dirty rows, so the search tool cleans again on registering a result. Grounding went 0.913, 0.917, 0.943, 0.981.

**3. The 45 ms I chose not to buy.** Deep plan p95 came in 45 ms over, on one slow planner call of four. Another eval run costs about $1.30 and would probably have turned it green. I stood on the run, because a green bought by re-rolling is not a measurement.

## Build and run

- [`DEPLOY.md`](DEPLOY.md), the runbook as it actually ran on deploy day.
- [`DESIGN.md`](DESIGN.md), the five design questions at v1.5, with ten trade-offs and what each gave up.
- [`docs/WRITEUP.md`](docs/WRITEUP.md), the build story and the four defects one evening of benching found.

Tests run without Atlas: in `backend/agent`, `npm test` uses an in-memory Mongo fallback, so the loop, retrieval, ingest and quota tests run offline. `npm run typecheck` covers source and tests. Configuration is environment only; `.env.example` names every key and no value.

## Honest status

- Gates 0 through 3 pass: static, contract, run, trajectory. Gate 4 fails on the deep-plan row.
- Automated rubric 82 of 85. Three manual sections, 15 points, pending the grader.
- Quality check: 0 errors, 2 warnings, one of them deep mode exceeding the quick-mode `fetch_page` cap, by design.
- Out of scope on purpose: no re-ranker, since recall@5 was already perfect on the gold set and a re-rank turn costs about 2 s for no measured gain. No subagent deep search. The OpenRouter A/B sits behind one module, deferred.
- Known limit: auto mode with an answering Space returns documents, not the web; the UI toggle is the remedy.

Built solo with Claude Code. Kurt Lozier, [LinkedIn](https://www.linkedin.com/in/kurtlozier/).
