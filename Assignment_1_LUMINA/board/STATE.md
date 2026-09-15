# STATE — LUMINA (Assignment 1), Claude and Codex builds

As of Claude close (CLAUDE-072, 2026-09-15 08:15 ET). Editor: unclaimed after explicit release (CLAUDE-072; Claude held the lease 08:12–08:14 ET for this refresh); claim before editing. Evidence IDs resolve in archive or messages.

Both sessions closed. Latest Codex handoff: `Codex_Build/Resume_from_20260909_1333.md`; Claude: `Claude_Build/Resume_from_20260915_0807.md`. No active polling or automatic wake implied.

## Registry
- Program `fde-cohort2` · Project `lumina-a1` · Repo `lozierk/FDE-Cohort2` (private), path `Assignment_1_LUMINA/`; builds `Claude_Build/` (Claude) and `Codex_Build/` (Codex). Upstream starter pinned at `1442b05`, tree hash `c75bc544640cce93`.
- Participants (identity ≠ model ≠ session): `CLAUDE` agent, harness Claude Code, model label Claude Fable 5.1 · `CODEX` agent, harness Codex CLI, model label GPT-6-based (unverified snapshot, CODEX-031) · `KURT` human principal; verified channel = Telegram reply ingested by `shared/check_kurt_replies.sh`; terminal statements are relayed by the agent that heard them.

## Where we are
**Kurt's direction 2026-09-11 (CLAUDE-063):** Claude proceeds solo in `Claude_Build/`; Codex catches up later, scope Kurt's call; no wargame for now. `Claude_Build/DESIGN.md` v1.0 final (CLAUDE-064). Week 1 code landed (`28c2b00`, CLAUDE-065). **2026-09-14 (CLAUDE-067–070):** keys verified, Atlas `lumina-claude` live; Week 2 parts A and B built and measured (recall@5 39/39, docs TTFT p95 1.62 s, deep plan 2.4–3.5 s, 429+`resetsAt` on the 6th ask); web mode answers from the preflight search; error runs to `runs/failing/`; rate limit 300/min for the bench; **model split (Kurt): Haiku 4.5 everywhere except Sonnet 5 for the deep answer** (DESIGN v1.3 trade-off 9); OpenRouter/GLM/Kimi deferred to after eval. **≈ 21:25 (CLAUDE-071):** four local benches found four defects, all fixed (`e8e0ed2`): one-thread workload vs fresh-thread fast path, memory instruction searched not saved, Tavily markdown snippets vs the grader's HTML, gateway 204→502 on DELETE /memory. Bench 4: 22/22 gates, 15/16 SLA (TTFT p95 4.1 s the miss). Tests 125/12. Deploy decided (`DEPLOY.md`, `7beeafb`). Write-up drafted. **2026-09-15 (CLAUDE-072): DEPLOYED and live** — https://lumina-claude.vercel.app (`/evals` renders the report), gateway https://lumina-claude-gateway.fly.dev, agent private on Fly. `eval.mjs --deploy-url` first stopped at gate 2 (five-query smoke) on the mode=auto probe's research turn; fix: auto mode with a Space that answered takes the docs fast path (DESIGN v1.5, trade-off 10). Second run: gates 0–3 pass, TTFT p95 1.1/1.2 s, grounding 0.966, 0 errors; **gate 4 one miss, deep plan p95 4045 vs 4000 ms** — Kurt: stand on it. Automated 82/85. `b947f90`. **Next:** repo visibility (Q-16), write-up final, classmate review, P1, video. Deadline Fri 2026-09-18.

## Gates and approvals (data, not prose)
- `trial_ceiling_usd: 10` · scope: LUMINA endpoint-validation trial only, all-in · approved_by KURT (relayed, CLAUDE-035; confirmed CODEX-041).
- `bench_eval_ceiling_usd: 15` · scope: Claude_Build bench + eval cycle, all providers in · approved_by KURT 2026-09-14 21:05 ET (terminal, relayed, CLAUDE-071; raised from 10, CLAUDE-070) · spent ≈ $4.60 on four local runs + ≈ $4.10 on 2026-09-15 (deployed bench, failed smoke, full eval); one full `eval.mjs` ≈ $1.30.
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
- **Q-16 repo visibility/contents: OPEN** — Kurt said "public" 2026-09-15; held on D-12 (board in-repo, redacted export only); Kurt decides next session (CLAUDE-072)
- Q-6 Codex eval flow: CONFIRMED against the real starter (CODEX-070, `Codex_Build/EVAL_FLOW_REVIEW.md`; flags exporter failing-run handling and placeholder prices)
- Q-13 DESIGN.md drafts: Claude CLOSED (v1.0, CLAUDE-064); Codex draft still open (CLAUDE-037, CODEX-044)
- Q-15 agent-bus pilot: **ON HOLD by Kurt until Assignment 1 ships** (CLAUDE-056); post-assignment backlog incl. the wake/resume daemon question: `shared/MESSAGING_POST_ASSIGNMENT_BACKLOG.md` (Codex, CODEX-071)
- Closed: Q-1..Q-3, Q-7..Q-11 (archive registers); Q-12 starter copy (CODEX-066); Q-14 migration review, commit cleared (CODEX-067)

## Pending work
- Claude: deployed and live, eval 82/85 with one 45 ms deep-plan miss stood on. Next: with Kurt — repo decision (Q-16), write-up walkthrough + nine placeholders + Notion, classmate submission review; then `build-report --video --repo` → `latest.json` → gateway redeploy. Resume: `Claude_Build/Resume_from_20260915_0807.md`.
- Codex: contract/grader review; DESIGN.md draft; red-team of Claude's DESIGN (Q-10 file names).
- Kurt: repo contents/visibility (Q-16); the write-up walkthrough; point Claude at the classmate's submission and say what kind of review; read the two P1 trajectories on `/evals`; the video; Codex's scope (Claude recommends: paused through Friday). Done 2026-09-15: logins, secrets import, favicon kit.

## Checkpoints
See `board/MANIFEST.md`: archive SHA-256, highest legacy IDs (CLAUDE 054, CODEX 064), read checkpoints at cutover, receipts empty at cutover.
