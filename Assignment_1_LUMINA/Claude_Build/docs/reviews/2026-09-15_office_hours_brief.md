# LUMINA office-hours brief for Hamza

**Kurt Lozier · Assignment 1 · 2026-09-15, noon ET office hours.** Submission is complete and live. Five minutes of links, one table, four questions.

## Where to look

| What | Link |
|---|---|
| Live app, `/evals` page with the served report | https://lumina-claude.vercel.app/evals |
| Gateway health, names both models, search and vector store | https://lumina-claude-gateway.fly.dev/health |
| Public repo, README first, then `docs/WRITEUP.md` | https://github.com/lozierk/Claude_Build_Submission |
| Successful trajectory on `/evals` | `req_b4cbfc27-3e1`, deep, 19 steps |
| Failing trajectory on `/evals` | `req_793296f3-0fe`, quick, provider error, kept in `runs/failing/` |

## Measured on the deployed app, grader's path

Second eval run of 2026-09-15, `eval/eval.mjs --deploy-url`, 79 answers. All six gates pass, 16 of 16 SLA targets, automated 85 of 85, 15 manual points pending.

| Target | Gate | Measured |
|---|---|---|
| TTFT p95 | ≤ 2,500 ms | 1,185 ms |
| Deep plan p95 | ≤ 4,000 ms | 3,619 ms |
| Deep answer p95 | ≤ 90 s | 73.3 s |
| Citation grounding | ≥ 0.95 | 0.985 |
| Recall@5 | ≥ 0.70 | 30/30 |
| Cost, quick / deep | ≤ $0.05 / $0.35 | $0.0033 / $0.131 |
| Errors | ≤ 1 % | 0 of 307 runs |

The first run that morning missed deep plan p95 by 45 ms on one planner call of four. I published it rather than re-roll. The second run came after three code changes, not as a re-roll; both reports are in the repo.

## What I built that is not in the starter

- **Two models, split by measurement.** Haiku 4.5 plans, researches and writes quick answers. Sonnet 5 writes only the deep answer. A twelve-question-per-arm A/B showed Sonnet cited 13 to 14 sources against Haiku's 7 to 9 on deep, and nothing worth its cost on quick or docs.
- **Web mode preflights the search on the user's own words.** No model turn is spent deciding to search when the mode already said so. Cache hit rate went from 10 % to 100 %.
- **Termination is explicit.** Every run ends `done`, `cap` or `error`. Error runs land in `runs/failing/` at write time, so a failure cannot score as a success.
- **Nothing waits forever, and retries are ours.** 20 s tool deadline, SDK retries off, an explicit two-retry policy capped at 2 s per wait, and retrieved page text wrapped as untrusted content. All three came from reviewing a classmate's build this morning.

## Four questions for you

1. **Provided files.** `benchmark/sla.json` and `quality/rules.json` invite edits in their own comments. I left both untouched and took the P2 warning, on the reading that "do not edit provided folders" is the stricter rule. Right call?
2. **Two eval reports.** Is keeping the 45 ms miss beside the passing run the right move for a grader, or noise?
3. **Snapshot repo.** The public repo is a snapshot of the build folder only. The full working repo stays private because it holds agent coordination and peer reviews. Is a snapshot acceptable for grading?
4. **Peer review as a tool.** A classmate's code exposed three gaps in mine that no gate could see. Worth making a cohort practice before the next assignment?

## Honest status

- No video recorded. I may add one later.
- Quality check: 0 errors, 2 warnings. A3 is deep mode fetching in a row by design. P2 is the untouched provided file above.
- Known limit: auto mode with an answering Space returns documents, not the web. The UI toggle is the remedy.
- Retry policy is unit-tested against the extracted policy, not against a live 529 from the provider.
- Spend: about $11.30 of a $15 ceiling for the whole bench and eval cycle.
