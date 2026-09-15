# Review: Muthukumar Selvarasu's LUMINA deployment (grader's eye)

Reviewed 2026-09-15 ≈ 10:26–10:35 ET by Claude for Kurt. Scope: the live submission only
(https://lumina-ui-eight.vercel.app); no repo is linked from the report, so there is no repo pass.
Method: same checks the provided `eval/eval.mjs` and `eval/rubric.json` make, run by hand against
the live gateway; 7 asks total (4 quick, 1 deep, 2 memory) ≈ $0.03 of his spend.
Not run: his eval harness, his RAG upload path, more than one deep (his cap is 5/day).
**Keep this file out of any public repo: it reviews a classmate's work.**

## Verdict
The plumbing is good and the submission is not there. Every contract probe passes — cleanly —
and the trace shows a real `fetch_page` step, which the rubric asks for and most of us skipped.
But the two things a grader opens first are both broken: **`GET /evals/report.json` returns `{}`**,
so the /evals page — which *is* the submission — renders a red contract error and nothing else;
and **the Tavily key is out of credit**, so every search-backed ask has 502'd since ≈14:30 UTC.
As it stands the automated half scores at or near zero: no report to read, no answer to grade.
Fixable in an hour: top up Tavily, re-run the eval, redeploy the report.

## What passes (verified live)
| Check | Result |
|---|---|
| UI is the provided `web/`, unmodified; SPA rewrite works | `/evals` → 200; bundle carries the provided EvalsPage strings verbatim |
| `/health` names model, search provider, vector backend, db | `gemini-3.6-flash · tavily · atlas-vector-search · db ok` |
| 401 without X-User-Id; 404 unknown thread | `"missing required header: x-user-id"` 401; `"no thread thr_zzzzzzzzzzzzzz"` 404, and 404 for another user's thread (no cross-user leak) |
| 400 on a bad ask body | `{}` → `"query: Required"`; `""` → `"query is required"`; 2100 chars → `"at most 2000 character(s)"` — zod text surfaced |
| CORS | preflight from `https://evil.example.com` gets **no** allow-origin; his own origin gets it. Allowlisted, not `*` |
| No key or connection string in the client bundle | clean (230 KB scanned: no `sk-`, `tvly-`, `mongodb+srv://`, `AIza`) |
| SSE order; request correlation | quick `trace → sources → token → done`; deep `plan → trace → …`; sources before the first token on all 3 completed asks; `x-request-id` on every response |
| A1 error discipline | `fetch_page ok:false` carried `"no readable content extracted"`; the Tavily failure surfaced as an `error` event **and** a 502, never a 2xx with an empty answer |
| Deep plan; no depth drift (R2) | 4 sub-questions (min 3), streamed **before** any retrieval; `plan_research` absent from all 4 quick traces |
| Memory save / list / delete | `save_memory` 556 ms → `GET /memory` lists `mem_mu2rr1mk82ljn1` → `DELETE` 204 → list empty → re-DELETE 404 |
| Citations; cost accounting | contiguous `[1]`, resolves, none fabricated; cost exact at $1/$5 per Mtok + $0.008/search |

## What a grader will mark down
1. **`/evals/report.json` is `{}`.** Validated against the zod `EvalsReport`: eight missing
   required keys (`assignment, student, deployedAt, design, rubric, bench, quality,
   trajectories`). The page renders "report.json does not match the contract" and the literal
   `{}`. No automated score, no gates table, no SLA table, no rubric rows, no design section,
   no run notes, **no P1 trajectories** — the whole automated rubric plus
   `human_gate_answer_quality` (5) and `deploy_docs` (5) with nothing to grade.
2. **The deployment is down for search.** Four of my seven asks ended `502 tavily search
   failed: 433 … "This request exceeds the pay-as-you-go limit"`, from 14:30 UTC onward, on
   both quick and deep. A grader asking one question sees a failed stream.
3. **TTFT is far over the 2500 ms target.** Server `ttftMs` on the three quick asks that
   completed: 7929, 6202, 4801 ms. His own `/stats.ttftP95Ms` read **9991 ms before my asks**
   and 20594 ms after. Visible cause: `recall_memory` (450–865 ms) → `web_search` (1.6–2.2 s)
   → two sequential `fetch_page` calls (1.0 s + 1.6 s), no token until all of it lands.
4. **One source per answer.** The `sources` event on both completed web asks carried exactly
   **1** source — the fetched page, not the search hits. `retrievalRate` and the deep/quick
   source ratio (≥ 2×) are graded off that array. It is also why the answer was honest but
   empty: "there is no information detailing the specific differences…". Good honesty, thin
   product.
5. **`searchCached` false on an identical repeat.** Same query, same thread, twice: false both
   times, because the model rewrites the search string each run ("…vs Pinecone for production
   RAG workloads" → "…and Pinecone production RAG workloads"). The page cache clearly did hit —
   `fetch_page` fell 1643 ms → 130 ms — but the flag the rubric reads stayed false.
   `/stats.searchCacheHitRatePct` fell 76.6% → 50.9% under 7 asks, the edge of the 50% floor.
6. **A failed deep burned the daily cap.** My deep 502'd before any token; `/stats.deepToday`
   went 0 → 1. An errored run should not spend quota.
7. **Thread context leaks into the next search.** Asked "Without searching the web, tell me
   what you remember about my role…", the trace shows `web_search {"query":"choosing a vector
   database framework criteria evaluation"}` — the *previous* turn's question. Wrong search,
   and an explicit instruction ignored.
8. **Cosmetics on the page a grader reads:** `/health` nests its own payload twice
   (`ai.ai.status`), and `trace.reason` is empty on `recall_memory` and `web_search` — the
   contract calls `reason` what makes the trace a debugging surface rather than a progress bar.
9. **Not verified:** agent-not-publicly-reachable (one Cloud Run service is exposed and
   `/health` implies an agent behind it, but with no repo I could not find its URL); rate limit
   (40 concurrent `GET /memory` all 200); grounding, recall@5, RAG and the deep 429 cap (no
   bench report exists and I uploaded no documents).

## What we can learn for ours
- **Copy the shape of his fetch_page, not its cost.** He fetches the top result and grounds on
  the real page — the rubric's search row wants exactly that, and Saurabh fails it. Make sure
  our trace *shows* the fetch as plainly as his does.
- **One source in `sources` is the trap.** He fetches well and then publishes only the fetched
  page, so good retrieval reads as thin. Confirm ours emits every retrieved source.
- **A provider credit cap is a single point of failure for the whole grade.** Check our Tavily
  balance before the grader opens the URL, and decide whether a search failure should degrade
  to an honest no-sources answer instead of a 502.
- **Deploy the report last and check it with curl, not the browser.** `{}` is what an eval that
  never wrote its output looks like. Our assemble step should end with
  `curl …/evals/report.json` piped through `EvalsReport.parse`.
- **A failed run must not spend the cap.** Check our deep counter only increments on
  `terminated: done`.

## Peer feedback for Muthukumar (if Kurt wants to pass it on)
1. Top up Tavily first — nothing else can be graded while every ask 502s.
2. Re-run the eval and redeploy: `/evals/report.json` serves `{}`, so the page a grader opens
   shows a contract error instead of your score. Biggest single point swing.
3. Write the two P1 trajectories with what each taught you; the rubric says that gate cannot be
   skipped.
4. TTFT p95 is ~10 s against 2500 ms. Stream `sources` from the search hits *before* the
   `fetch_page` step rather than after it; that alone moves first paint by seconds.
5. Put every retrieved source in the `sources` event, not only the fetched page — one source
   caps both your grounding evidence and your deep/quick source ratio.
6. Make the repeat hit: key the cache on the user's query for the first search, or set
   `searchCached` true when every search in the run hit.
7. Don't increment `deepToday` when a deep run ends in `error`.

## Evidence
- Gateway found in the client bundle: `https://lumina-app-156592443912.asia-southeast1.run.app`
  (Cloud Run, asia-southeast1); UI on Vercel, last-modified 13:41 UTC.
- `/evals/report.json`: 200, `content-length: 2`, body `{}`; `EvalsReport.safeParse` → false, 8 issues.
- `/stats` before: `{requests:5683, answers:2374, searchCacheHitRatePct:76.6, ttftP95Ms:9991,
  costUsdToday:19.425287, deepToday:0, deepDailyCap:5}`. After: `{5725, 2393, 50.9, 20594,
  19.685319, deepToday:1}`.
- Quick 1 `req_5878219b-e36`: `recall_memory 865ms → web_search 2232ms → fetch_page ok:false
  1003ms → fetch_page ok:true 1643ms`; 1 source; `ttftMs 7929, latencyMs 8233, costUsd 0.009815,
  searchCached false, terminated done`.
- Identical repeat `req_bb6df7b4-18f`: same shape, `fetch_page 130ms`; `ttftMs 6202,
  costUsd 0.010042, searchCached false`.
- Deep `req_3c4a1c46-7d0`: `plan` 4 sub-questions (`plan_research` 2593 ms), then `web_search`
  step 4 `ok:false` → `error {"status":502,"error":"tavily search failed: 433 …"}`. No `done`,
  no answer, no cost figure.
- Memory: `req_061dd347-a43` saved `mem_mu2rr1mk82ljn1` ("User is a product manager who wants
  vector database explanations in business terms without code", `sourceThread
  thr_mu2rqzb59ftrzf`, `costUsd 0.002803`); recall in `thr_mu2rr8mvysvwik` ran `recall_memory
  ok:true 488ms` but the stream 502'd before any token, so **whether the answer honoured the
  preference is not verified**; `DELETE` 204, list empty, re-DELETE 404.
- Raw SSE streams, bundle copy and the zod validator: session scratchpad `mk/` (not kept).
- Full-page screenshot: `Assignment_1_LUMINA/.playwright-mcp/muthukumar-evals-full.png` (git-ignored).
