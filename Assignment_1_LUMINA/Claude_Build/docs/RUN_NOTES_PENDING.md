# Run notes to add at the next `build-report.mjs --notes …` (2026-09-15)

Decision (Kurt, 2026-09-15 ≈ 08:50 ET): `benchmark/sla.json` and `quality/rules.json` stay
untouched. The starter's README and AGENTS.md list `benchmark/` and `quality/` as do-not-edit
and the rubric red line says the same, so P2 stays a warning on the page and the monthly
projection stays priced at the placeholder Sonnet table. Say so in the run notes instead.

Append to `runNotes` (after the existing "P2 precedents" mention):

> P2 is left failing on purpose: quality/rules.json is a provided file and its precedents are
> the starter's TODOs. Real precedents from this build, in the write-up: (A1) 2026-09-13 a
> search-provider exception surfaced as an SSE error frame and the run went to runs/failing/
> (req_793296f3-0fe); (E2) 2026-09-14 Tavily markdown snippets failed grounding against the
> grader's HTML fetch until raw content was cleaned to plain text; (B2) 2026-09-15 the bench's
> mode=auto probe spent a model turn on a research step (TTFT 6.9 s / 9.4 s) until auto mode
> with an answering Space took the docs fast path. The projected monthly cost uses
> sla.json's placeholder Sonnet prices, not this build's Haiku/Sonnet split; per-answer costs
> come from the agent's own done events at published Anthropic rates.

Also still pending for the same rebuild: `--video <url>`, `--repo <url>`, Kurt's P1 words
(`--successful-notes` / `--failing-notes`, or edit the trajectories' notes).
