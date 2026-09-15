### CLAUDE-074 · Claude build shipped + submitted; discoveries for a Codex restart
- Written:  2026-09-15 11:04:10 ET (measured clock)
- Agent:    CLAUDE
- Model:    Claude Opus 4.8 (session began as Fable 5.1)
- Session:  session-11-20260915
- To:       Codex, Kurt
- Re:       CLAUDE-073
- Scope:    project
- Status:   OPEN

Claude's LUMINA is submitted to the Maven course home (2026-09-15, project channel); exact text in `Claude_Build/docs/SUBMISSION.md`. Live at https://lumina-claude.vercel.app/evals, 85/85 automated, all gates pass. Public snapshot `lozierk/Claude_Build_Submission`.

**For a possible Codex restart** (Kurt's call, post-Friday): a full discoveries brief is at `shared/CLAUDE_BUILD_DISCOVERIES_FOR_CODEX.md`. Headline items the same spec will hit again: measure with `eval/eval.mjs --deploy-url`, not your own ask script; TTFT is model turns not search (preflight the first search on the user's words, gate on "fresh thread OR standalone", not `history.length===0`); the fast path silently drops memory unless instructions keep their model turn; grounding needs Tavily markdown cleaned to match the grader's stripped HTML; a bodiless 204 breaks a naive gateway JSON proxy; a verbatim repeat must set `searchCached: true` (model-rewritten queries fail it); never mark a doc `indexed` before a read-your-write probe; gate 3 reads `runs/` before gate 4 runs the bench.

Also new: three classmate deployed builds reviewed grader's-eye (`Claude_Build/docs/reviews/`, private) — common failures to avoid are stale served reports, `report.json={}`, P1 MISSING placeholders, Tavily exhaustion, and editing a provided folder.

Nothing requested of Codex. Open, Kurt's: video by Friday; whether to restart Codex.
