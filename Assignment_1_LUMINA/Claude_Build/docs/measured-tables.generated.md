**Deployed bench, the grader's path.** `eval/eval.mjs --deploy-url https://lumina-claude-gateway.fly.dev`, 79 answers, finished 2026-09-15 09:55 ET. 16 of 16 pass.

| Gate | Target | Measured | Result |
|---|---|---|---|
| ttft p95 | <= 2,500 ms | 1,185 ms | Pass |
| answer p95 | <= 12,000 ms | 4,927 ms | Pass |
| 202 accept p95 | <= 300 ms | 92 ms | Pass |
| search p95 during ingest / idle | <= 1.30× | 0.76× | Pass |
| recall@5 | >= 0.7 | 1 | Pass |
| search cache hit rate | >= 50 % | 100 % | Pass |
| deep plan p95 | <= 4,000 ms | 3,619 ms | Pass |
| deep answer p95 | <= 90.0 s | 73.3 s | Pass |
| deep sub-questions (min) | >= 3 | 4 | Pass |
| deep/quick source ratio (min) | >= 2.00× | 4.00× | Pass |
| cost per deep answer | <= $0.350 | $0.131 | Pass |
| citation grounding | >= 0.95 | 0.985 | Pass |
| error rate | <= 0.01 | 0 | Pass |
| cost per answer (quick) | <= $0.050 | $0.0033 | Pass |
| sources before the first token | >= 1 | 1 | Pass |
| citations with no matching source | <= 0 | 0 | Pass |

### Behavioral gates

**Rubric evidence, same run.** 26 of 26 pass; automated 85/85.

| Check | Result |
|---|---|
| contract probes (401/404/400): GET /memory without X-User-Id: 401 · GET /threads/thr_nope (unknown id): 404 · POST /threads/thr_x/ask with an empty body: 400 · GET /evals/report.json without X-User-Id: 200 | Pass |
| sources before the first token: every answer sent its sources event before its first token | Pass |
| /health names model, provider, store: /health names claude-haiku-4-5; deep synthesis: claude-sonnet-5 · tavily · atlas-vector-search · db ok | Pass |
| citation grounding >= 0.95: citation grounding 0.985 over 201 verifiable citations, 0 dangling | Pass |
| retrieval rate = 1.0: retrieval rate 1 — the share of answers whose run actually searched | Pass |
| search cache hits on repeats: search cache hit rate 100% on a workload that is 50% repeats | Pass |
| save_memory lands in GET /memory: GET /memory lists 1 new row after the save and the trace shows save_memory | Pass |
| recall crosses into a new thread: a new thread's trace carries 1 recall_memory step(s) | Pass |
| DELETE removes it: DELETE /memory/mem_mu2qhvv9yka7jx removed the row | Pass |
| 202 accept p95 < 300ms: 202 accept p95 75ms | Pass |
| reaches indexed via the worker: 4/4 corpus file(s) reached indexed after a 202 | Pass |
| citation carries a page locator: 77 document citation(s) carry a page locator, e.g. p. 1 | Pass |
| mode=auto picks documents: mode=auto retrieved from the Space — "mode=auto: a Space is attached, search it first" | Pass |
| recall@5 >= 0.7: recall@5 1 over 30 gold questions | Pass |
| plan streamed before any retrieval: 4/4 deep runs planned >= 3 sub-questions, 4/4 streamed the plan before retrieving anything | Pass |
| every step and source tagged with its sub-question: all 4 deep runs tag every retrieval step and every source with its subQuestion | Pass |
| deep reads more than quick: worst deep/quick distinct-source ratio 4.00x (need 2x) | Pass |
| deep stays inside its budget: 0 deep run(s) over $0.35, 0 over 24 tool calls | Pass |
| quick never escalates to plan_research (R2): 75 quick run(s), none called plan_research | Pass |
| deep cap+1 returns 429 with resetsAt: request 6 of a 5/day deep cap returned 429 with resetsAt 2026-09-16T00:00:00.000Z | Pass |
| bench.mjs exits 0: 0 SLA target(s) missed | Pass |
| the quick gear stayed in its own envelope: 0/75 quick run(s) exceeded $0.05 or 8 tool calls | Pass |
| no error-severity quality failure: quality: 0 error(s), 2 warning(s) over 307 run log(s) | Pass |
| one X-Request-Id correlates both logs: 71/71 answers returned an X-Request-Id to correlate the two logs | Pass |
| /stats reconciles with the run: /stats.answers=561 against 71 answers this run | Pass |
| every failed tool call carries an error (A1): A1: 307 run(s) | Pass |

**Quality check** (`node quality/check.mjs .`): 0 errors, 2 warnings over 307 runs (A3, P2).
