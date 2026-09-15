# Review: Michal Olczak's LUMINA deployment (grader's eye)

Reviewed 2026-09-15 ≈ 10:25–10:50 ET by Claude for Kurt. Scope: the live submission only
(https://lumina-web-sage.vercel.app, gateway https://lumina-gateway.vercel.app). No repo is
linked from the report, so no repo pass. Method: the checks `eval/eval.mjs` and `eval/rubric.json`
make, run by hand; 7 asks (5 quick incl. one verbatim repeat, 1 deep, 2 in the memory round trip)
= $0.129 of his spend, 1 of 5 deep quota. Not run: his harness, document upload, the deep cap.
**Keep this file out of any public repo: it reviews a classmate's work.**

## Verdict
The mirror image of Saurabh's. Submission hygiene is the best in the cohort — **85/85 automated,
all six gates green, design prose better than ours, run notes on the page, every contract probe
clean.** But the report is four days stale and **the deployment has drifted underneath it.** Live,
the quick path retrieves nothing: four of six quick asks emitted an empty `sources` event and zero
citations. His own `/stats` reported `ttftP95Ms` 23,285 after my asks against a published 2,441 ms
and a 2,500 ms target. One quick run cost **$0.0937** — above the $0.05 cap the page says nothing
exceeded — and one 502'd mid-stream. Deep search is excellent. A grader who reads the page gives
him 85 plus most of the manual 15. A grader who asks one question gets "No usable web evidence
was retrieved."

## What passes (verified live)
| Check | Result |
|---|---|
| Provided web/, `/evals` renders `GET /evals/report.json`, SPA rewrite | pass (`/evals` 200) |
| Report validates against `EvalsReport` (zod) | pass, no issues |
| `/health` names model, provider, store, db | gpt-5.6-luna · tavily · atlas-vector-search · ok |
| 401 without X-User-Id, 404 unknown thread, 400 empty body | pass; 400 carries zod text (`Expected 'quick' \| 'deep', received 'ultra'`) |
| No key or connection string in the client bundle | clean (230 KB bundle; only `VITE_API_URL`) |
| CORS | foreign-origin preflight → 204 with **no** allow-origin; real origin gets one |
| SSE order | quick trace → sources → token → done; deep **plan** first; sources before the first token on all 7 |
| Search cache on a verbatim repeat | **`searchCached: true`**, `web_search` 0.24 ms vs 3,073 ms first run — the row Saurabh failed |
| Memory | save_memory 389 ms → `GET /memory` lists it → new thread's trace shows recall_memory 227 ms → answer honoured it ("colour", one sentence) → DELETE 204 → empty |
| Deep search | 3 sub-questions planned before retrieval, 13 trace steps and 9 sources all `subQuestion`-tagged, citations contiguous 1–9, every used `[n]` resolves, 18.6 s, **$0.0015** |
| Deep answer honesty | names what the evidence does *not* support, with a "What is still unknown" section |
| Agent publicly reachable | no host found under guessable names — **not verified** |

## What a grader will mark down
1. **Quick-path retrieval is dead live.** Q1 (web_search ok, 3,073 ms) → 0 sources; Q2 (search ok,
   fetch_page FAIL) → 0; Q3 repeat → 0; M1 → 0. Only M2 produced 1 source. Answers are honest
   ("No usable web evidence was retrieved") so E2 holds, but **live retrievalRate is ~0.17, not
   the reported 1.0** — and `search_cited_answers` is 20 points resting on that number.
2. **TTFT p95 live is 23,285 ms** (his `/stats`) against 2,441 ms on the page and a 2,500 ms
   target. Server `ttftMs` per ask: 12,691 / 15,051 / 5,113 / 3,457 / 10,883 quick, 12,875 deep.
   Not one quick ask met the SLA.
3. **A quick run blew the cost cap and still reported `terminated: "done"`.** Q2: `tokens.in
   467,051`, `costUsd 0.09366`. The page reads "0/75 quick run(s) exceeded $0.05 or 8 tool calls".
   Live, 1 of 5 did — the A2/B3 shape the red lines exist for.
4. **One ask 502'd mid-stream.** Q4: `error {"status":502,"error":"LLM request failed: OpenAI
   response incomplete: max_output_tokens"}` after 23.6 s. Contract behaviour is correct (error
   event after headers, as his design text promises), but the product failed. That overrun and the
   467k-token run point at one cause: fetched page bytes entering the model context unbounded.
5. **The P1 trajectories are one step each.** Successful = a single `search_documents`; failing =
   a single `web_search`. The rubric wants both "in full, every step". He shipped the two shortest
   runs in existence, and the failing one's id is **`req_deliberate_search_failure`** — a
   hand-written label, not a run-log id. Reads as staged rather than read.
6. **The quality gates ran over one run log.** `quality.runs: 1`; A1/A2/A3/B1/B2/B3 all say
   "1 run(s)" while the bench answered 79. R1 and R2 **skip** at error severity ("none declared") —
   `expectations.json` names no required or forbidden tools. P2 fails: 10 rules lack a precedent.
7. **The report is four days stale.** `deployedAt` and bench `ranAt` are 2026-09-11T20:47–48Z and
   the served JSON is **byte-identical** to Kurt's 9/11 capture (md5 `a9128076…`, 16,913 bytes,
   zero diff), while the web app's `index.html` carries `last-modified 2026-09-14T15:03:56Z`. He
   redeployed the UI and never re-ran the eval; deploy-docs wants the report "from this run".
8. **No `repo`, no `video`.** Optional in the contract, expected by a grader.
9. **A probe claim on the page is false live:** "GET /evals/report.json without X-User-Id: 404".
   It returns 200, as it must. Likely captured before `build-report.mjs` wrote the file.
10. **Rate limit not observed:** 60 concurrent `GET /memory` all 200. Not a fail, unverified.

## What we can learn for ours
- **A green report is not a green deployment.** His 85/85 was true on 9/11 and is false today, and
  nothing on the page says so. Ours is due 9/18 off a 9/15 run — **re-run `eval/eval.mjs
  --deploy-url` the morning of submission.** Most transferable finding here.
- **His verbatim repeat hits the cache.** Saurabh's did not. Worth one explicit check on ours
  rather than trusting the bench's hit rate.
- **His deep answer models thin-retrieval honesty** ("The supplied evidence supports only a
  high-level comparison… remains unknown for:"). That is what the manual answer-quality row
  rewards, and it costs nothing.
- **Cost poles:** his deep is $0.0015 in 18.6 s (nano planner, luna synthesis, 9 fetched pages);
  ours is $0.143. The write-up's model-split section can now cite both ends of the cohort.
- **Second sighting of the Atlas read-your-write probe** before a document is called `indexed`.
  Two classmates independently — check ours does not mark `indexed` before the index can serve.
- **`/stats` scoped per user** (my fresh id started at 0), which sidesteps the "answers reconcile
  within 1%" argument ours and Saurabh's both have.

## Peer feedback for Michal (if Kurt wants to pass it on)
1. Ask your deployment one question today. Quick returns zero sources; deep is fine. Source
   registration in the quick path broke after 9/11 and the page still claims retrievalRate 1.0.
2. Bound the bytes a `fetch_page` result contributes to context — one quick run sent 467,051 input
   tokens at $0.094, another overran `max_output_tokens` and 502'd.
3. Re-run the eval and republish: your report is 9/11, your UI is 9/14.
4. Replace both trajectories with real multi-step runs and real request ids;
   `req_deliberate_search_failure` costs you the 5 points the rest of the page earns.
5. Get more run logs into `runs/`, declare required/forbidden tools so R1/R2 stop skipping, and add
   `repo` and `video`. Your design section is the strongest in the cohort — don't let a stale
   report be what the grader remembers.

## Evidence
- `/health`: `{"status":"ok","model":"gpt-5.6-luna","searchProvider":"tavily","vectorStore":"atlas-vector-search","db":"ok"}`
- Report: `student "Michal Olczak"`, `deployedAt 2026-09-11T20:48:20.314Z`, bench `ranAt
  2026-09-11T20:47:26.754Z`, `runNotes "gpt-5.6-luna synthesis · gpt-5.4-nano planning · Tavily ·
  MongoDB Atlas M0 · Vercel arn1"`, no `repo`/`video`. Gates: 0 pass, 1 pass (exit 2), 2 pass
  (exit 0), 3 pass (exit 1), 4 pass, 5 manual — nonzero exits on 1/3 are normal, `eval.mjs` grades
  on the `C1 ✓` line and the run count. Bench: grounding 1, recall@5 1, retrievalRate 1, errorRate
  0, ttft p50/p95 227/2,441 ms, answer p50/p95 1,880/4,973 ms, 202 accept p95 249 ms, cache 95%,
  79 answers, quick $0.00063, deep $0.0017, deep plan p95 3,734 ms, deep answer p95 18.4 s.
  Quality: 1 run, 0 errors, 1 warn; R1/R2 skip; P2 fail.
- Staleness: served md5 `a9128076ed6c73315b5ccf6853443d43` = `docs/peer-review/lumina-web-sage_report_2026-09-11.json`.
- My asks (server's own `done` numbers), user `kurt-review-2026-09-15`:

| ask | depth | ttftMs | wall | sources | cites | costUsd | cached | terminated |
|---|---|---|---|---|---|---|---|---|
| Q1 `req_mu2rpf2xcrrzn5` | quick | 12,691 | 13,009 | 0 | – | 0.00050 | false | done |
| Q2 `req_mu2rpxxsnqmqy3` | quick | 15,051 | 15,346 | 0 | – | **0.09366** (in 467,051 tok) | false | done |
| Q3 repeat `req_mu2rqndytzpamx` | quick | 5,113 | 5,475 | 0 | – | 0.00051 | **true** | done |
| Q4 `req_mu2rqyoh1wks8b` | quick | – | 23,580 | 0 | – | – | – | **error 502** |
| D1 `req_mu2rrq1wuhve1b` | deep | 12,875 | 18,648 | 9 sq-tagged | [2–6][8][9] | 0.00153 | false | done |
| M1 save `req_mu2rsk3rcqi1ea` | quick | 3,457 | 3,746 | 0 | – | 0.00028 | false | done |
| M2 recall `req_mu2rssenli7ixo` | quick | 10,883 | 11,163 | 1 | [1] | 0.00395 | false | done |

- Memory: `mem_mu2rsli50nuswi`, `thr_mu2rsjwcn6vgxw` → `thr_mu2rss7h8fo6o0`, DELETE 204.
- `/stats` after the 7 asks: `{"requests":7,"answers":7,"searchCacheHitRatePct":16.7,"ttftP95Ms":23284.6,"costUsdToday":0.1292877,"deepToday":1,"deepDailyCap":5}` (`answers` counts the 502'd run).
- Raw SSE captures: session scratchpad `michal/` (not kept). Full-page screenshot:
  `Assignment_1_LUMINA/.playwright-mcp/michal-evals-full.png` (git-ignored).
