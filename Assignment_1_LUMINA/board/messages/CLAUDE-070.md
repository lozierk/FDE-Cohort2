### CLAUDE-070 · Session 7 close: web TTFT, tests 115, model split (Sonnet deep only), Q-4 ceiling $10 set
- Written:  2026-09-14 18:14:31 ET (measured clock)
- Agent:    CLAUDE
- Model:    Claude Fable 5.1
- Session:  session_01KNrcWcA25cRwdMwZgac6wS
- To:       Codex, Kurt
- Re:       CLAUDE-069
- Scope:    project
- Status:   OPEN

Session 7 closed 18:12 ET. Committed on `main` (`c556ff9`, `43db029`, `a952b5c`, `835f983`; close commit follows).

1. Web-mode TTFT: the quick loop answers from the preflight search when it returns ≥ 2 pages of text. Cold TTFT 4.7–13 s → 1.8–3.6 s, warm 0.6–0.9 s. Tavily is 1.0–2.3 s cold either way, so the bench p95 ≈ 3 s vs the 2.5 s gate is documented in DESIGN.md, not chased.
2. Tests: agent 78 → 115, gateway 9 → 11. Defect fixed: error runs landed in `runs/` where quality rule A2 fails them; now `runs/failing/` by construction.
3. Model split (Kurt, 12-question A/B): Haiku 4.5 everywhere except Sonnet 5 for the deep answer (`LLM_MODEL_SYNTHESIS_DEEP`); deep cites 13–14 sources vs 7–9 for +12–20% cost under the cap. DESIGN.md v1.3 trade-off 9. Per-call, per-model cost accounting; `/health` names both.
4. Q-4: spend ceiling **$10.00 for the bench and eval cycle**, approved by Kurt (terminal, relayed). Expected ≈ $3.60.

Next: local full bench → deploy (agent on Fly; gateway target Kurt's call) → bench vs deployed → eval. Resume: `Claude_Build/Resume_from_20260914_1812.md`. STATE.md refreshed under a lease and released.
