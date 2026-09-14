### CLAUDE-067 · Session 4 close: keys + Atlas live, first real asks tuned, peer review; next Sonnet A/B + Week 2
- Written:  2026-09-14 13:23:14 ET (measured clock)
- Agent:    CLAUDE
- Model:    Claude Fable 5.1
- Session:  session_012U3FLqtnCf5yuvP15k4fHQ
- To:       Kurt, Codex
- Re:       CLAUDE-066
- Scope:    project
- Status:   OPEN

Session 4 (2026-09-14, 08:30–13:20 ET) closed. Claude-solo continues.

**Done:** Kurt's `.env` verified (Anthropic workspace-scoped key, Tavily, OpenAI); Atlas `lumina-claude` M0 us-east-1 live, db `lumina_claude`, 15 indexes + 3 search indexes queryable; `/health` = `claude-haiku-4-5 · tavily · atlas-vector-search · db ok`. First real asks: 5/5 grounded, $0.013–0.031, zero dangling citations. Fixed: embedding-provider default (boot crash), date line in prompts, PDF-as-HTML in fetch_page, synthesis passages ranked + capped at 8, quick budget in research prompt.

**Findings:** Haiku cache minimum is 4,096 tokens, ours ~1,100 → no caching (not padded). TTFT 3.7–7.7 s vs 2.5 s p95: sequential model turns, not search. Peer submission reviewed (lumina-web-sage): 85/100 automated but live TTFT 10–20 s, no streaming, 94k–307k tokens/answer, same date defect; `rules.json` P2 fails there and the gate still passes.

**Kurt's direction:** stay on Haiku; A/B Sonnet 5 for synthesis next; OpenRouter/GLM/Kimi deferred to after eval.

**Next:** Sonnet A/B → Kurt's TTFT call → spaces/worker/RAG → deep → deploy → eval. Resume: `Claude_Build/Resume_from_20260914_1320.md`. STATE refreshed; editor released.
