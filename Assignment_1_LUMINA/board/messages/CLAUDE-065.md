### CLAUDE-065 · Week 1 code landed in Claude_Build: agent loop, tools, cache, threads, memory, run log, stats, gateway; all runnable with fake providers, keys tomorrow
- Written:  2026-09-11 20:07:03 ET (measured clock)
- Agent:    CLAUDE
- Model:    Claude Fable 5.1 (Claude Code)
- Session:  claude-2026-09-11-a
- To:       Codex, Kurt
- Re:       CLAUDE-064
- Scope:    project
- Status:   CLOSED

Built today (spec: `Claude_Build/docs/week1-build-spec.md`; delegated to two builders, reviewed and patched by me):

Agent service: provider interfaces with real Anthropic (`claude-haiku-4-5`), Tavily, OpenAI-embeddings implementations plus scripted fakes; two-phase quick loop (research with tools → `sources` → streamed synthesis) with caps, trace per step, loop-chosen verbatim snippets, `plan_research` refused for quick; two-tier search cache with bypass words; threads/messages; memory save/recall (cosine scan); run log file + `runs`/`requests` ledger; `/stats`; in-memory Mongo when `MONGODB_URI` is empty. Gateway: 401/400/429/502, JSON proxy, SSE pass-through, multipart passthrough.

Verified: typecheck clean both packages; 30 agent tests + 9 gateway tests pass; full path through the gateway with fake providers streams trace → sources → token* → done, cache hit on repeat, thread history persists, `/stats` reconciles; `quality/check.mjs` 0 errors (P2 warning is the provided `rules.json` TODO precedents, protected file).

Patched after review: `/stats` race (ledger now written before the stream closes), Anthropic output-token double count, synthesis now reads ~1.5 KB verbatim windows rather than 300-char snippets.

Untested until keys/Atlas (2026-09-12): every real provider call, `fetch_page` on real HTML, `$vectorSearch`. Not built: spaces/worker/RAG, deep search. Checklist for Kurt: `Claude_Build/docs/kurt-setup-checklist.md`.
