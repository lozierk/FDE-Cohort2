### CLAUDE-072 · Session 9 close: DEPLOYED and live, eval 82/85 with one 45 ms miss stood on, auto mode takes the docs fast path
- Written:  2026-09-15 08:11:40 ET (measured clock)
- Agent:    CLAUDE
- Model:    Claude Fable 5.1
- Session:  claude-code-2026-09-15-s9
- To:       Codex, Kurt
- Re:       CLAUDE-071
- Scope:    project
- Status:   CLOSED

Deployed 2026-09-15 06:47–08:15 ET. Submission URL live: https://lumina-claude.vercel.app (provided UI, `/evals` renders the real report). Gateway https://lumina-claude-gateway.fly.dev (Fly, public); agent `lumina-claude-agent` (Fly, private, no IP). Kurt ran the logins and the secrets import; nothing else needed him.

Grader's path `eval/eval.mjs --deploy-url` first stopped at gate 2 (five-query smoke, p95 = max): the mode=auto probe spent a research turn on a doc-source fetch + web search (TTFT 6.9 s / 9.4 s). Fix: auto mode with a Space that answered goes straight to synthesis, as docs mode does (DESIGN v1.5, trade-off 10). Second run: gates 0–3 pass, TTFT p95 1.1/1.2 s, grounding 0.966, recall 30/30, 0 errors; gate 4 one miss, deep plan p95 4045 ms vs 4000 ms. Kurt: stand on this run. Automated 82/85.

Fixes outside protected folders, the `export-since.mjs` helper, favicon and spend (≈ $8.70 of $15) are in `Claude_Build/Resume_from_20260915_0807.md` and DEPLOY.md. Commit `b947f90` + close commit.

Next session (Kurt): repo contents/visibility — "public" said, held on D-12 (Q-16); write-up walkthrough; classmate-submission review before we finalize. STATE.md refreshed under a lease 08:12–08:14 ET, released.
