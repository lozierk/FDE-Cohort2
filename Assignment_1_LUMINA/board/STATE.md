# STATE — LUMINA (Assignment 1), Claude and Codex builds

As of Claude close (CLAUDE-073, 2026-09-15 10:15 ET). Editor: unclaimed after explicit release (CLAUDE-073; Claude held the lease 10:12–10:15 ET for this refresh); claim before editing. Evidence IDs resolve in archive or messages.

Both sessions closed. Latest Codex handoff: `Codex_Build/Resume_from_20260909_1333.md`; Claude: `Claude_Build/Resume_from_20260915_1009.md`. No active polling or automatic wake implied.

## Registry
- Program `fde-cohort2` · Project `lumina-a1` · Repo `lozierk/FDE-Cohort2` (private), path `Assignment_1_LUMINA/`; public snapshot `lozierk/Claude_Build_Submission` (Claude_Build only, built by `scripts-local/assemble-public.sh`, CLAUDE-073); builds `Claude_Build/` (Claude) and `Codex_Build/` (Codex). Upstream starter pinned at `1442b05`, tree hash `c75bc544640cce93`.
- Participants (identity ≠ model ≠ session): `CLAUDE` agent, harness Claude Code, model label Claude Fable 5.1 · `CODEX` agent, harness Codex CLI, model label GPT-6-based (unverified snapshot, CODEX-031) · `KURT` human principal; verified channel = Telegram reply ingested by `shared/check_kurt_replies.sh`; terminal statements are relayed by the agent that heard them.

## Where we are
**History (CLAUDE-063–072):** Claude solo in `Claude_Build/`, Codex paused (Kurt, 2026-09-11). DESIGN v1.0→v1.5 (Anthropic direct; **Haiku 4.5 everywhere, Sonnet 5 for the deep answer**, trade-off 9; auto mode with an answering Space takes the docs fast path, trade-off 10). Week 1+2 built and measured 2026-09-14; four local benches found four defects, fixed (`e8e0ed2`). **Deployed 2026-09-15 AM (CLAUDE-072):** UI https://lumina-claude.vercel.app, gateway https://lumina-claude-gateway.fly.dev, agent private on Fly; eval run 1: gates 0–3 pass, one 45 ms deep-plan miss at gate 4, stood on, automated 82/85 (`b947f90`). **2026-09-15 10:15 (CLAUDE-073): SUBMISSION COMPLETE.** Classmate (Saurabh) review exposed three gaps → 20 s tool deadline, explicit LLM retry (boundary = first stream event), untrusted-source boundary (tests 132/12); agent redeployed; **eval run 2: all gates pass, 16/16 SLA, automated 85/85**, P1 words in, repo link in; run 1 kept beside it. Public snapshot repo `lozierk/Claude_Build_Submission` (Q-16 settled, D-12 intact). Kurt: `sla.json`/`rules.json` untouched, run notes explain P2. **Open:** video, Notion, tell Saurabh. Deadline Fri 2026-09-18.

## Gates and approvals (data, not prose)
- `trial_ceiling_usd: 10` · scope: LUMINA endpoint-validation trial only, all-in · approved_by KURT (relayed, CLAUDE-035; confirmed CODEX-041).
- `bench_eval_ceiling_usd: 15` · scope: Claude_Build bench + eval cycle, all providers in · approved_by KURT 2026-09-14 21:05 ET (terminal, relayed, CLAUDE-071; raised from 10, CLAUDE-070) · spent ≈ $4.60 on four local runs + ≈ $4.10 (2026-09-15 AM) + ≈ $2.60 (session 10: two smokes, one full eval, review asks) ≈ $11.30; one full `eval.mjs` ≈ $1.30.
- `board_migration: approved` · KURT 2026-09-09 (relayed CLAUDE-054, CODEX-063) · `tool_pilot: not approved` · `database: not approved`.
- Accounts (Claude_Build): Anthropic, Tavily, OpenAI keys and Atlas `lumina-claude` M0 provisioned 2026-09-14 (CLAUDE-067); OpenRouter deferred to post-eval; **Fly apps `lumina-claude-agent` (private) + `lumina-claude-gateway` and Vercel project `lozierk/lumina-claude` live 2026-09-15 (CLAUDE-072)**; agent secrets = the whole `.env`, imported by Kurt. Keys only in each build's ignored `.env` (CLAUDE-034/035).
- Protected starter folders never edited (`web/ packages/contract/ benchmark/ eval/ quality/ scripts/`); `/health` must name model, search, vector backend.
- **Presence (CODEX-069, CLAUDE-060):** after a post expecting a reply, stay active and poll ≤ 60 s for ≤ 30 min; ingest Telegram while waiting; at timeout record pending IDs and end time. Claude's session watcher resumes it on new messages; nothing wakes an idle Codex turn. Kurt only via `ATTN: KURT` when both agree he is blocking.

## Decisions (scope: project unless marked; status current unless superseded)
- D-1/D-2 board protocol; single canonical board → amended by D-12 (M-001, M-003, M-004)
- D-3 one repo, two build folders → repo `FDE-Cohort2`, folder name kept (CLAUDE-035, CLAUDE-042/043)
- D-4 handshake done · D-5 presence: poll while active, announce session end, no wake-up implied (M-004, M-005)
- D-6 identical eval cases, differences documented; runtime-provider part superseded by D-10 (M-004, CODEX-035)
- D-7/D-8 alert channel: Telegram @Kurts_Alert_Bot + macOS, one alert per ID, one reminder after 15 min; rules `shared/KURT_NOTIFICATION_PROPOSAL.md` (CODEX-014, CLAUDE-018)
- D-9 services: Atlas two projects one free cluster each (`lumina_claude`/`lumina_codex`); OpenRouter two keys; OpenAI embeddings only `text-embedding-3-small`; Tavily; two Vercel; four Fly (public gateways, private agents); per-build credentials (CLAUDE-027/028, CODEX-031/035)
- D-10 runtime: OpenRouter, shared trial `z-ai/glm-4.6` @ `deepinfra/fp4` (CLAUDE-032, CODEX-035) → **superseded for Claude_Build** by Kurt 2026-09-11: Anthropic direct `claude-haiku-4-5`, OpenRouter/GLM kept as later-refactor candidate (CLAUDE-064). Codex_Build unaffected until Kurt says otherwise.
- D-11 tripwire handling = rule 8; pre-flight compares protected files to baseline, flags known Cohort-1 markers, never auto-deletes; re-scan on upstream change (CLAUDE-038, CODEX-044)
- D-12 board migrated to `board/` per `PROPOSAL_FOR_KURT.md` + joint amendments (scope, identity, decision history); mailbox stays in this repo for now, redacted export only for graders (KURT approval, CLAUDE-054, CODEX-063)
- **program-scope candidates, not promoted:** D-11 tripwire scan, rule 8, write protocol. Promotion needs Kurt and both agents on the board.

## Open items
- Q-4 full-cycle spend ceiling: SET at $15 for Claude_Build (raised from $10, CLAUDE-071); Codex_Build unbudgeted until Kurt says otherwise
- Q-5 submitted URL: SETTLED — https://lumina-claude.vercel.app (CLAUDE-071/072)
- Q-16 repo visibility/contents: SETTLED 2026-09-15 — separate public snapshot repo `lozierk/Claude_Build_Submission`, board/resumes/reviews excluded; `FDE-Cohort2` stays private, D-12 intact (KURT, terminal, relayed CLAUDE-073)
- Q-6 Codex eval flow: CONFIRMED against the real starter (CODEX-070, `Codex_Build/EVAL_FLOW_REVIEW.md`; flags exporter failing-run handling and placeholder prices)
- Q-13 DESIGN.md drafts: Claude CLOSED (v1.0, CLAUDE-064); Codex draft still open (CLAUDE-037, CODEX-044)
- Q-15 agent-bus pilot: **ON HOLD by Kurt until Assignment 1 ships** (CLAUDE-056); post-assignment backlog incl. the wake/resume daemon question: `shared/MESSAGING_POST_ASSIGNMENT_BACKLOG.md` (Codex, CODEX-071)
- Closed: Q-1..Q-3, Q-7..Q-11 (archive registers); Q-12 starter copy (CODEX-066); Q-14 migration review, commit cleared (CODEX-067)

## Pending work
- Claude: submission complete, 85/85 automated, all gates pass, public snapshot up. Nothing blocked. If Kurt adds a video or edits: `scripts-local/finish-report.sh` → Kurt deploys the gateway → `assemble-public.sh` → push. Resume: `Claude_Build/Resume_from_20260915_1009.md`.
- Codex: contract/grader review; DESIGN.md draft; red-team of Claude's DESIGN (Q-10 file names).
- Kurt: video (optional); Notion refresh (optional); whether to pass feedback to Saurabh; Codex's scope after Friday (Claude recommends: paused). Done 2026-09-15: logins, secrets import, favicon kit, two agent deploys, gateway deploy, repo flip to public, P1 words approved.

## Checkpoints
See `board/MANIFEST.md`: archive SHA-256, highest legacy IDs (CLAUDE 054, CODEX 064), read checkpoints at cutover, receipts empty at cutover.
