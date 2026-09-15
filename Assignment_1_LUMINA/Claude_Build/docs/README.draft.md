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

Run with the course's own harness, `eval/eval.mjs --deploy-url`, against the deployed gateway on 2026-09-15 at 09:48 ET. All six gates pass. Automated 85 of 85, 15 manual points pending.

| Metric | Measured | Gate | |
|---|---|---|---|
| TTFT p95 (web) | 1,185 ms | 2,500 ms | pass |
| Answer p95 | 4,927 ms | 12,000 ms | pass |
| Upload 202 accept p95 | 92 ms | 300 ms | pass |
| Citation grounding | 0.985 | 0.95 | pass |
| Recall@5, 30 gold questions | 1.00 | 0.70 | pass |
| Search cache hit rate | 100% | 50% | pass |
| Error rate | 0 of 307 runs | 1% | pass |
| Cost per quick answer | $0.0033 | $0.05 | pass |
| Cost per deep answer | $0.131 | $0.35 | pass |
| Deep plan p95 | 3,619 ms | 4,000 ms | pass |
| Deep answer p95 | 73.3 s | 90 s | pass |
| Deep / quick source ratio | 4.0x | 2x | pass |

This is the second eval run of the day. The first, at 07:41 ET, missed one target by 45 ms: deep plan p95 4,045 ms against 4,000, the slowest of four planner calls. I reported it as measured rather than re-roll for a green. The second run followed a real change to the agent, described in claim 5 below, and is reported the same way. Both reports are in the repo.

Rubric awarded: contract 10/10, cited answers 20/20, memory 10/10, RAG 15/15, deep search 15/15, performance 10/10, logging 5/5. Red lines clear.

## Stack

The provided React UI ships static on Vercel. An Express gateway is the only public service, on Fly: CORS, the `X-User-Id` check, validation, a per-user rate limit, byte-level SSE pass-through, and the eval report. The agent runs private on Fly with no public IP, so provider keys never sit behind a public route. Storage is MongoDB Atlas M0: Atlas Vector Search and Atlas Search (BM25) fused by reciprocal rank fusion. Search is Tavily with raw page content and a six-hour cache in Atlas. Models split by where the difference shows: Claude Haiku 4.5 for planning, research and quick answers, Claude Sonnet 5 for the deep answer only. Embeddings are OpenAI `text-embedding-3-small`. The trade-off has numbers: deep fetches whole pages and pays for Sonnet, so it runs at 73 s p95 and $0.13 against a 90 s and $0.35 gate. That buys 20 to 33 fetched sources per deep answer, four to seven times what the same question retrieves quick.

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

**3. The 45 ms I chose not to buy.** On the first eval run, deep plan p95 came in 45 ms over, on one slow planner call of four. Another run costs about $1.30 and would probably have turned it green. I stood on the run and published it, because a green bought by re-rolling is not a measurement. The second run happened for a different reason: a peer's build showed me our agent had no deadline on a hung tool call and no retry policy of its own. Those went in, the agent was redeployed, and the eval was run again on the grader's path. It measured 3,619 ms. Both reports stay in the repo.

## Build and run

- [`DEPLOY.md`](DEPLOY.md), the runbook as it actually ran on deploy day.
- [`DESIGN.md`](DESIGN.md), the five design questions at v1.5, with ten trade-offs and what each gave up.
- [`docs/WRITEUP.md`](docs/WRITEUP.md), the build story and the four defects one evening of benching found.

Tests run without Atlas: in `backend/agent`, `npm test` uses an in-memory Mongo fallback, so the loop, retrieval, ingest and quota tests run offline. `npm run typecheck` covers source and tests. Configuration is environment only; `.env.example` names every key and no value.

## Honest status

- All six gates pass on the second eval run of 2026-09-15; the first run missed deep plan p95 by 45 ms and is kept alongside it.
- Automated rubric 85 of 85. Three manual sections, 15 points, pending the grader.
- Quality check: 0 errors, 2 warnings. A3 is deep mode fetching more pages in a row than the quick-mode cap, by design. P2 is the starter's TODO precedents in a provided file I chose not to edit; the real precedents are in the write-up.
- Out of scope on purpose: no re-ranker, since recall@5 was already perfect on the gold set and a re-rank turn costs about 2 s for no measured gain. No subagent deep search. The OpenRouter A/B sits behind one module, deferred.
- Known limit: auto mode with an answering Space returns documents, not the web; the UI toggle is the remedy.
- The retry policy is verified by unit tests against the extracted policy, not by a live 529 from the provider.

Built solo with Claude Code. Kurt Lozier, [LinkedIn](https://www.linkedin.com/in/kurtlozier/).
