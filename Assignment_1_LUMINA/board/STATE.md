# STATE — LUMINA (Assignment 1), Claude and Codex builds

As of Claude close (CLAUDE-068, 2026-09-14 15:27 ET). Editor: unclaimed after explicit release (CLAUDE-068; Claude held the lease 15:27–15:30 ET for this refresh); claim before editing. Evidence IDs resolve in archive or messages.

Both sessions closed. Latest Codex handoff: `Codex_Build/Resume_from_20260909_1333.md`; Claude: `Claude_Build/Resume_from_20260914_1527.md`. No active polling or automatic wake implied.

## Registry
- Program `fde-cohort2` · Project `lumina-a1` · Repo `lozierk/FDE-Cohort2` (private), path `Assignment_1_LUMINA/`; builds `Claude_Build/` (Claude) and `Codex_Build/` (Codex). Upstream starter pinned at `1442b05`, tree hash `c75bc544640cce93`.
- Participants (identity ≠ model ≠ session): `CLAUDE` agent, harness Claude Code, model label Claude Fable 5.1 · `CODEX` agent, harness Codex CLI, model label GPT-6-based (unverified snapshot, CODEX-031) · `KURT` human principal; verified channel = Telegram reply ingested by `shared/check_kurt_replies.sh`; terminal statements are relayed by the agent that heard them.

## Where we are
**Kurt's direction 2026-09-11 (CLAUDE-063):** Claude proceeds solo in `Claude_Build/`; Codex catches up later, scope Kurt's call; no wargame for now. `Claude_Build/DESIGN.md` v1.0 final (CLAUDE-064). Week 1 code landed (`28c2b00`, CLAUDE-065). **2026-09-14 (CLAUDE-067):** all keys verified; Atlas `lumina-claude` (M0, us-east-1, db `lumina_claude`) live with all indexes queryable; first real Haiku asks done and tuned (5/5 grounded, $0.013–0.031, TTFT 3.7–7.7 s vs 2.5 s p95); four defects fixed. Kurt: stay on Haiku, A/B Sonnet 5 for synthesis next, OpenRouter/GLM/Kimi deferred to after eval. Peer submission reviewed (lessons in the resume). **2026-09-14 15:27 (CLAUDE-068):** Week 2 part A built, reviewed, measured, committed (`b941f39`, `3d82e0a`): spaces, child-process worker, hybrid RAG, doc citations with locators; recall@5 39/39, 202 accept ≤ 212 ms, docs TTFT p95 1.62 s (Kurt approved answer-from-preflight), $0.002/answer; 64 tests. Part B deep-search spec written (`Claude_Build/docs/week2-deep-build-spec.md`). Rate limit 300/min for the bench (Kurt). Agent must deploy on Fly (child-process worker). **Next:** part B deep → Sonnet A/B → Kurt's web-TTFT call → runs/failing → bench → deploy → eval. Deadline Fri 2026-09-18.

## Gates and approvals (data, not prose)
- `trial_ceiling_usd: 10` · scope: LUMINA endpoint-validation trial only, all-in · approved_by KURT (relayed, CLAUDE-035; confirmed CODEX-041) · full bench/eval budget: NOT set (Q-4).
- `board_migration: approved` · KURT 2026-09-09 (relayed CLAUDE-054, CODEX-063) · `tool_pilot: not approved` · `database: not approved`.
- Accounts (Claude_Build): Anthropic, Tavily, OpenAI keys and Atlas `lumina-claude` M0 provisioned 2026-09-14 (CLAUDE-067); OpenRouter deferred to post-eval; Vercel/Fly to follow (peer evidence: both services on Vercel is rubric-allowed). Keys only in each build's ignored `.env` (CLAUDE-034/035).
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
- Q-4 full-cycle spend estimate and ceiling: OPEN, due before any bench/eval run (CODEX-032, CLAUDE-030)
- Q-5 submitted URL / build switch: DEFERRED to UX phase (CLAUDE-035)
- Q-6 Codex eval flow: CONFIRMED against the real starter (CODEX-070, `Codex_Build/EVAL_FLOW_REVIEW.md`; flags exporter failing-run handling and placeholder prices)
- Q-13 DESIGN.md drafts: Claude CLOSED (v1.0, CLAUDE-064); Codex draft still open (CLAUDE-037, CODEX-044)
- Q-15 agent-bus pilot: **ON HOLD by Kurt until Assignment 1 ships** (CLAUDE-056); post-assignment backlog incl. the wake/resume daemon question: `shared/MESSAGING_POST_ASSIGNMENT_BACKLOG.md` (Codex, CODEX-071)
- Closed: Q-1..Q-3, Q-7..Q-11 (archive registers); Q-12 starter copy (CODEX-066); Q-14 migration review, commit cleared (CODEX-067)

## Pending work
- Claude: Week 2 part A done. Next: part B deep search (spec ready), Sonnet-synthesis A/B, web-TTFT decision (Kurt), runs/failing, bench, deploy, eval. Resume: `Claude_Build/Resume_from_20260914_1527.md`.
- Codex: contract/grader review; DESIGN.md draft; red-team of Claude's DESIGN (Q-10 file names).
- Kurt: delete the two leftover Atlas test Spaces (`spc_mu1l7uvtwd49s4`, `spc_mu1l9wqh2k5tda`) or approve the cleanup; web-mode TTFT loop change; Sonnet stays or not after the A/B; Q-4 spend ceiling before the bench; gateway deploy target (Fly vs Vercel); Codex's scope.

## Checkpoints
See `board/MANIFEST.md`: archive SHA-256, highest legacy IDs (CLAUDE 054, CODEX 064), read checkpoints at cutover, receipts empty at cutover.
