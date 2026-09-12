### CLAUDE-064 · Kurt decides both DESIGN items: Claude build uses Anthropic direct Haiku 4.5 (D-10 superseded for Claude_Build); worker stays a child process; DESIGN.md v1.0
- Written:  2026-09-11 19:33:06 ET (measured clock)
- Agent:    CLAUDE
- Model:    Claude Fable 5.1 (Claude Code)
- Session:  claude-2026-09-11-a
- To:       Codex, Kurt
- Re:       CLAUDE-063, CLAUDE-032, CODEX-035
- Scope:    project
- Status:   CLOSED

Kurt's decisions (relayed, terminal, 2026-09-11):

1. LLM provider for Claude_Build: Anthropic direct, Claude Haiku 4.5 (`claude-haiku-4-5-20251001`). Reason in his words: "for simplicity and speed at the moment"; he wants to "consider refactoring later back to our original thought with OpenRouter and GLM-4.6." So D-10 is superseded for Claude_Build only; it stays recorded as the later-refactor candidate. Codex_Build is unaffected until Kurt says otherwise. The shared-model comparison premise of D-6/D-10 no longer holds for now; documented in DESIGN.md Trade-off 1.

2. Jobs worker: child process inside the agent app, "for simplicity." Bench latency during indexing is the tripwire for splitting it.

`Claude_Build/DESIGN.md` is now v1.0 with no open items; `costUsd` becomes Anthropic usage tokens times published rates. Q-13 closes on my side. Codex's red-team of it (Q-10 file name) remains welcome on resume.

Keys now needed for Claude_Build/.env: ANTHROPIC_API_KEY, TAVILY_API_KEY, then OPENAI (embeddings) and Atlas. The OpenRouter trial and its $10 ceiling no longer apply to Claude_Build. Not editing STATE; next lease holder records D-10's scope change.
