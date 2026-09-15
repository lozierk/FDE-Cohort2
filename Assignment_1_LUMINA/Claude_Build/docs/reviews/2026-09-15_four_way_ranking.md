# LUMINA submissions ranked — four builds, grader's eye

Compiled 2026-09-15 10:40 ET by Claude for Kurt. Sources: the three deployed reviews in this
folder (Michal, Saurabh, Muthukumar) plus our own served run 2. All live numbers are from ≤ 7
hand asks per build against each live gateway on 2026-09-15 AM. **Private file — reviews a
classmate's work; excluded from the public snapshot.**

Builds: **K** = ours (lozierk, lumina-claude.vercel.app) · **MO** = Michal Olzak
(lumina-web-sage) · **SB** = Saurabh Bhardwaj (lumina-theta-woad) · **MS** = Muthukumar
Selvarasu (lumina-ui-eight).

## The metrics, and why these

A grade here is the automated rubric a grader re-runs plus manual points a human awards. So the
score turns on two things a static page can hide: **what the page shows now**, and **whether the
live app still earns it when the grader re-runs `eval.mjs` against the URL**. Four dimensions,
weighted for that:

| Dimension | Weight | What it measures |
|---|---|---|
| Grader-facing outcome | 35 % | Automated rubric on the page, all six gates, P1 trajectories present and real |
| Live performance | 30 % | Measured TTFT / answer / deep latency, live retrieval and grounding, cost within the caps, cache hit on a true repeat — the numbers a re-run reproduces |
| Engineering depth | 20 % | Stack realism, streaming, retrieval quality, memory correctness, security posture |
| Submission hygiene | 15 % | Report complete and fresh, run notes, repo, video, honest status |

Scored 0–10 per dimension. The weighted total is the rank.

## Ranking

| Rank | Build | Grader-facing (35) | Live perf (30) | Engineering (20) | Hygiene (15) | **Weighted** |
|---|---|---|---|---|---|---|
| 1 | **K (ours)** | 9.5 | 9.5 | 9.5 | 8.5 | **9.35** |
| 2 | **MO (Michal)** | 7.0 | 3.0 | 8.0 | 5.0 | **5.70** |
| 3 | **SB (Saurabh)** | 5.0 | 5.5 | 8.0 | 3.5 | **5.53** |
| 4 | **MS (Muthukumar)** | 1.0 | 1.5 | 6.0 | 2.0 | **2.30** |

## Head-to-head on the numbers that decide it

| | K (ours) | MO (Michal) | SB (Saurabh) | MS (Muthukumar) |
|---|---|---|---|---|
| Automated on page | 85/85 | 85/85 | 82/85 | **0 — report is `{}`** |
| Gates | all 6 pass | all 6 pass (page) | gate 2 RUN fails on page | none render |
| Page vs live | match (we own it) | **stale: page 9/11, app degraded since** | live worse than report | app can't search now |
| TTFT p95, published / live | 1,185 ms / 1,185 | 2,441 / **23,285 live** | 4,666 / 6,236–9,365 | none / 7,929–9,991 |
| Live quick retrieval | 1.0 | **≈ 0.17 (4/6 empty sources)** | 1.0 (snippet-only) | 1 source/answer, then 502 |
| Grounding | 0.985 | 1.0 page, unverifiable live | 0.97 (legit, fetches) | not verifiable |
| Cache hit on verbatim repeat | 100 % (bench) | **yes — searchCached true** | **no** | no |
| Cost quick / deep | $0.0033 / $0.131 | $0.0006 / $0.0017 page; **one live quick $0.094** | $0.004–0.007 / $0.0096 | $0.003–0.010 / 502 |
| P1 trajectories | both real run-log ids | present but one-step, id hand-written | **both "MISSING" placeholders** | none |
| Repo / video | public snapshot / none | none / none | none / none | none / none |
| Model | Haiku 4.5 + Sonnet 5 | gpt-5.6-luna + gpt-5.4-nano | gpt-5.4-mini | Gemini 3.6 Flash |
| Fatal / near-fatal | video (manual pts only) | live quick path broken | failing gate + P1 missing | **empty report + Tavily out** |

## The ranking between 2 and 3 depends on how the grader grades

MO and SB are within 0.17 of each other, and the order flips on one question: **does the grader
trust the page, or re-run `eval.mjs` against the URL?**

- **If the grader trusts the page:** MO's 85/85 clean page beats SB's visibly-failing gate 2 and
  MISSING P1s. MO is a clear #2.
- **If the grader re-runs the bench** (the RUN and EVAL gates are designed to): MO's live quick
  path now returns empty sources at 23 s TTFT, so the retrieval, grounding and TTFT gates that
  read 85/85 on 9/11 would fail today — his page is a promise the app no longer keeps. SB's app
  is slow but actually answers with citations when used. Under a re-run, **SB likely overtakes
  MO**. I ranked MO #2 on the weighted total but the live-perf gap is why the margin is razor
  thin, and a re-running grader inverts it.

MS is last under any reading: an empty `report.json` is zero automated points before latency or
Tavily even matter.

## What each needs before Friday (if Kurt passes any of it on)

- **MO:** re-run `eval/eval.mjs --deploy-url` against the current deployment and republish — the
  85/85 is three days stale and the app degraded under it. Fix the quick path returning empty
  sources.
- **SB:** fill both P1 trajectories (5 manual pts, "cannot be skipped"), and get gate 2 green by
  addressing the TTFT miss or re-running; add a preflight so cache hits on a repeat.
- **MS:** top up Tavily so the app can search at all, then publish a real `report.json` — right
  now the page serves `{}`. This is the most urgent and the most recoverable.

## Carry-backs for our own submission

Three things two classmates independently exposed, worth a check before we trust run 2 on
Friday:

1. **Re-run `eval.mjs` the morning of 2026-09-18.** MO's story is the whole lesson: an 85/85 can
   go false while the page keeps claiming it. Our run 2 is from 9/15; the deadline is 9/18. Re-run
   against the live URL rather than trusting the stored report. (Noted for Friday.)
2. **Prove our verbatim repeat sets `searchCached: true`. VERIFIED 2026-09-15 10:45 ET, live.**
   One thread, one novel query asked twice against `lumina-claude-gateway.fly.dev`: ask 1 cold →
   `done.searchCached: false`, `web_search` 1,100 ms, $0.0116, ttft 1,733 ms; ask 2 verbatim →
   `done.searchCached: true`, `web_search` **5 ms** (cache hit), $0.0037, ttft 486 ms. This is
   the rubric's "second identical query reports searchCached=true". It works because our preflight
   keys the cache on the user's own words; MO's passes too, SB's fails because his query is
   model-rewritten each run. (`req_84a49150-3c8`, `req_bca41c06-b0b`.)
3. **Confirm ingest does not mark a document `indexed` before Atlas can serve the chunk.
   VERIFIED 2026-09-15, code + tests.** `index-document.ts` sets `status: 'indexed'` only after
   `probe()` returns; the probe runs the same `$vectorSearch` on `chunks_vector` the retrieval
   tool uses, with the chunk's own embedding, filtered by `spaceId`, retrying across
   `PROBE_BACKOFF_SEC = [1,2,4,8,16,32]` (63 s total). If the chunk never becomes visible the
   probe throws `read-your-write probe failed` and status stays `embedding` — the document fails
   loudly, never silently `indexed`. Tests cover both the pass (`ingest.test.ts:191`) and the
   loud failure (`ingest.test.ts:298`, asserts the throw). This class of bug cannot land in ours.
