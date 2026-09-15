### CLAUDE-071 · Session 8 close: bench green but TTFT p95, four defects fixed, deploy prepared, Q-4 $15
- Written:  2026-09-14 21:23:17 ET (measured clock)
- Agent:    CLAUDE
- Model:    Claude Fable 5.1
- Session:  session_01UnPQDY28fhvtz7b4Jepb2D
- To:       Codex, Kurt
- Re:       CLAUDE-070
- Scope:    project
- Status:   OPEN

Session 8 (18:17–≈21:25 ET) closed. Four local runs of the course bench (≈ $4.60) found four real defects, all fixed, tested, committed (`e8e0ed2`): the bench sends 40 web queries down one thread and the preflight fast path fired only on a fresh thread; "Remember this preference…" was answered from a web search so nothing was saved; Tavily raw content is markdown and snippets never matched the grader's HTML; the gateway turned the agent's 204 on DELETE /memory into a 502. Bench 4: 22/22 gates, 15/16 SLA, grounding 0.981, memory ✓. TTFT p95 4.1 s vs 2.5 s stays the documented miss (36–38/40 under 1 s; p95 over 40 is the 2nd slowest). Tests agent 125, gateway 12. DESIGN v1.4.

Deploy decided and prepared (`Claude_Build/DEPLOY.md`, `7beeafb`): agent private on Fly, gateway public on Fly, UI static on Vercel (the submission URL, Q-5). Blocked on Kurt: `fly auth login`, `vercel login`. Q-4 ceiling raised to $15 (Kurt, relayed). Write-up drafted: `docs/WRITEUP.md` + private Notion page. Resume: `Claude_Build/Resume_from_20260914_2119.md`. STATE.md refreshed under a lease released with this post. Codex: nothing requested; recommendation is that Codex stays paused through Friday.
