# Review: Saurabh Bhardwaj's LUMINA deployment (grader's eye)

Reviewed 2026-09-15 ≈ 08:20–08:35 ET by Claude for Kurt. Scope: the live submission only
(https://lumina-theta-woad.vercel.app); the repo review follows in a second pass.
Method: same checks the provided `eval/eval.mjs` and `eval/rubric.json` make, run by hand
against the live gateway; 7 asks total (5 quick, 1 deep, 1 memory recall) ≈ $0.05 of his spend.
Not run: his eval harness, his RAG upload path, the deep daily cap (would burn 5 deeps).
**Keep this file out of any public repo: it reviews a classmate's work.**

## Verdict
Strong engineering, weak submission hygiene. The stack is real (Cloud Run gateway, IAM-gated
agent, Atlas vector search, Tavily, gpt-5.4-mini), every contract probe passes, memory works end
to end, deep streams a plan first, and the report validates against the zod contract. But the
page a grader opens shows **a failing gate 2, a failing bench (TTFT p95 4666 ms vs 2500), and
both P1 trajectories as the literal "MISSING" placeholders.** Automated 82/85 on the page, but the
grader re-runs the bench, and the live TTFT is worse than the report says.

## What passes (verified live)
| Check | Result |
|---|---|
| UI = provided web/, `/evals` renders `GET /evals/report.json`, SPA rewrite works | pass |
| Report validates against `EvalsReport` (zod) | pass |
| `/health` names model, search provider, vector store, db | gpt-5.4-mini · tavily · atlas-vector-search · ok |
| 401 without X-User-Id, 404 unknown thread, 400 empty ask body | pass, zod issue text in the 400 |
| No key / connection string in the client bundle | clean |
| Agent not publicly reachable | `lumina-agent-…run.app` → 403 (IAM) |
| CORS | preflight from a foreign origin gets no allow-origin |
| SSE order | trace → sources → token → done; deep: plan → trace → … ; sources before first token on all 7 |
| Citations | contiguous, every [n] resolves, deep tags every source with subQuestion |
| Memory | save_memory in thread A → GET /memory lists it → recall_memory in thread B, answer honoured it → DELETE 204 → gone |
| Deep vs quick, same question | 32 distinct sources vs 8/10; 4 sub-questions; structured, honest "evidence is less detailed" line; 14 s, $0.0096 |
| Cost | quick $0.004–0.007, deep $0.0096 (gpt-5.4-mini pricing) |

## What a grader will mark down
1. **P1 human gate not done.** Both trajectories are the builder's MISSING placeholder text.
   That is 5 manual points at risk and the rubric says it "cannot be skipped".
2. **Gate 2 RUN failed and the page says so.** The gates table stops at gate 2 ("the smoke run
   missed a target"); gates 3–5 never ran. The rubric row was scored from a separate
   `bench.mjs` run (79 answers), not from `eval.mjs`. Performance & SLA 7/10 partial.
3. **TTFT is the miss, and it is worse live than reported.** Report: p95 4666 ms. My asks: the
   server's own `ttftMs` was 6236, 3261, 4391, 3929 ms quick and 9365 ms deep. His `/stats`
   showed ttftP95 3285 before my asks and 6236 after. Cause visible in the trace: two
   sequential web_search calls before any token (341 + 2605 ms, then model time); no
   preflight search, no fast path.
4. **Search cache does not hit on an identical repeat.** Same query, same thread, twice:
   `searchCached: false` both times, because the second search query is model-written and
   differs each run. Rubric text: "second identical query reports searchCached=true". His
   bench reports 95% hits, so the bench's repeats must hit on the first, verbatim search
   only; the `done` flag still says false. `/stats` cache rate fell to 33% under my 7 asks.
5. **No fetch_page anywhere.** Quick = 2× web_search, deep = plan + 4× web_search; sources are
   500-char Tavily snippets. The bench grounds by fetching the URL itself, so 0.97 grounding is
   legitimate, but the rubric's search row says "trace shows fetch_page not snippet-only".
   A grader reading a trace will see snippet-only.
6. **A3 tool-thrash warning on 22 runs:** web_search called 5–8× consecutively (cap 4).
   Warning severity, so not a gate, but it is on the page.
7. **Design text contradicts the deployment.** Trade-off 2 says "hand-rolled agent loop over
   the Anthropic SDK"; responsibilities says the agent calls Anthropic; `/health` and every
   `done` event say gpt-5.4-mini. The design tables also render as raw Markdown pipes on the
   page (the provided page shows the strings verbatim).
8. **Missing optional report fields:** no `repo`, no `video`, no `runNotes` (LLM, provider,
   Atlas tier). The deploy-docs manual row asks for run notes on the page.
9. **`/stats.answers` reconciliation:** evidence says "1092 against 71 answers this run" and
   marks it pass; cumulative vs per-run is not "within 1%". Same shape as our own report; a
   grader may or may not care.
10. **Rate limit not observed:** 60 concurrent GET /memory all 200. Either the limit is above
    60/min or it is per route. Not a fail, just unverified.

## What we can learn for ours
- **He runs deep in ~14–20 s at $0.01.** Four parallel web_search calls, no fetch, mini model.
  Ours is 85.9 s p95 and $0.143 because we fetch pages and use Sonnet for the deep answer.
  Ours is the more grounded answer; his is the faster product. Worth one sentence in the
  write-up's model-split section: what the extra 70 s and $0.13 buy.
- **His memory recall step is explicit and cheap (159 ms)** and the answer honoured the
  preference without being told. Ours does the same since session 8; good to confirm.
- **His design answers are better prose than ours in two places:** "the only component
  allowed to…" framing for responsibilities, and the Atlas eventual-consistency
  read-your-write probe before a document is called `indexed`. Worth checking whether our
  ingest marks `indexed` before the vector index can serve the chunk.
- **Cloud Run instance-based billing note** (request-billed Cloud Run throttles CPU and
  freezes a polling worker) is a real gotcha; Fly does not have it, nothing to do.
- **Do not ship with MISSING trajectories.** Ours has both trajectories filled; Kurt still
  owes the P1 words.

## Peer feedback for Saurabh (if Kurt wants to pass it on)
1. Run `--successful` / `--failing` and write the two P1 paragraphs; it is the cheapest 5 points.
2. Get gate 2 green: the smoke's p95 is the max of five, so one slow query fails it. A
   preflight search that streams sources first, or a fast path for a Space that answers,
   fixed the same problem for us (TTFT 2.95 s → 1.1 s).
3. Make the repeat hit the cache: key the cache on the user query for the first search, or
   set `searchCached` true when any search in the run hit.
4. Fix the Anthropic/OpenAI mismatch in the design text; add `runNotes`, `repo`, `video`.
5. Consider one `fetch_page` per top source in deep mode; the rubric wording expects it.

## Evidence
- Report: `x-published-at 2026-09-14T11:17:24Z`, bench ran 11:00:24Z, gates array = [0 pass, 1 pass (exitCode 1), 2 fail].
- My request ids: quick `req_7cd914b9-20d`, `req_b4cfc9b8-cf0`; deep `req_0ab8929c-d32`; memory `thr_mu2n9j305ytdbp` → `thr_mu2n9n1i2yccjz`, `mem_mu2n9k35to6apy`.
- Raw SSE streams and the report copy: session scratchpad `saurabh/` (not kept).
- Full-page screenshot: `Assignment_1_LUMINA/.playwright-mcp/saurabh-evals-full.png` (git-ignored).
