# STATE — LUMINA (Assignment 1), Claude and Codex builds

As of Codex close (CODEX-074). Editor: unclaimed after explicit release (CLAUDE-062, CODEX-074); claim before editing. Evidence IDs resolve in archive or messages.

Both sessions closed at Kurt's request. Latest Codex handoff: `Codex_Build/Resume_from_20260909_1333.md`; Claude: `Claude_Build/Resume_from_20260909_1331.md`. No active polling or automatic wake implied.

## Registry
- Program `fde-cohort2` · Project `lumina-a1` · Repo `lozierk/FDE-Cohort2` (private), path `Assignment_1_LUMINA/`; builds `Claude_Build/` (Claude) and `Codex_Build/` (Codex). Upstream starter pinned at `1442b05`, tree hash `c75bc544640cce93`.
- Participants (identity ≠ model ≠ session): `CLAUDE` agent, harness Claude Code, model label Claude Fable 5.1 · `CODEX` agent, harness Codex CLI, model label GPT-6-based (unverified snapshot, CODEX-031) · `KURT` human principal; verified channel = Telegram reply ingested by `shared/check_kurt_replies.sh`; terminal statements are relayed by the agent that heard them.

## Where we are
Setup complete: repo, tripwire gate, board migration (reviewed and cleared, CODEX-067), both starter copies verified. **Next:** both agents draft `DESIGN.md` for Kurt, then `/spec-wargaming` and reciprocal red-team, then Week 1 code. Deadline Fri 2026-09-18; Week 1 to ~Fri 2026-09-11.

## Gates and approvals (data, not prose)
- `trial_ceiling_usd: 10` · scope: LUMINA endpoint-validation trial only, all-in · approved_by KURT (relayed, CLAUDE-035; confirmed CODEX-041) · full bench/eval budget: NOT set (Q-4).
- `board_migration: approved` · KURT 2026-09-09 (relayed CLAUDE-054, CODEX-063) · `tool_pilot: not approved` · `database: not approved`.
- Accounts: none provisioned. Kurt is opening OpenRouter ($20, two keys) and Tavily (CLAUDE-056); Atlas, OpenAI, Vercel, Fly to follow per D-9. Keys only in each build's ignored `.env` (CLAUDE-034/035).
- Protected starter folders never edited (`web/ packages/contract/ benchmark/ eval/ quality/ scripts/`); `/health` must name model, search, vector backend.
- **Presence (CODEX-069, CLAUDE-060):** after a post expecting a reply, stay active and poll ≤ 60 s for ≤ 30 min; ingest Telegram while waiting; at timeout record pending IDs and end time. Claude's session watcher resumes it on new messages; nothing wakes an idle Codex turn. Kurt only via `ATTN: KURT` when both agree he is blocking.

## Decisions (scope: project unless marked; status current unless superseded)
- D-1/D-2 board protocol; single canonical board → amended by D-12 (M-001, M-003, M-004)
- D-3 one repo, two build folders → repo `FDE-Cohort2`, folder name kept (CLAUDE-035, CLAUDE-042/043)
- D-4 handshake done · D-5 presence: poll while active, announce session end, no wake-up implied (M-004, M-005)
- D-6 identical eval cases, differences documented; runtime-provider part superseded by D-10 (M-004, CODEX-035)
- D-7/D-8 alert channel: Telegram @Kurts_Alert_Bot + macOS, one alert per ID, one reminder after 15 min; rules `shared/KURT_NOTIFICATION_PROPOSAL.md` (CODEX-014, CLAUDE-018)
- D-9 services: Atlas two projects one free cluster each (`lumina_claude`/`lumina_codex`); OpenRouter two keys; OpenAI embeddings only `text-embedding-3-small`; Tavily; two Vercel; four Fly (public gateways, private agents); per-build credentials (CLAUDE-027/028, CODEX-031/035)
- D-10 runtime: OpenRouter, shared trial `z-ai/glm-4.6` @ `deepinfra/fp4`, fallback off, ZDR, `require_parameters`, reasoning disabled and verified; `gpt-4.1-mini` comparison. Joint recommendation pending validation (CLAUDE-032, CODEX-035)
- D-11 tripwire handling = rule 8; pre-flight compares protected files to baseline, flags known Cohort-1 markers, never auto-deletes; re-scan on upstream change (CLAUDE-038, CODEX-044)
- D-12 board migrated to `board/` per `PROPOSAL_FOR_KURT.md` + joint amendments (scope, identity, decision history); mailbox stays in this repo for now, redacted export only for graders (KURT approval, CLAUDE-054, CODEX-063)
- **program-scope candidates, not promoted:** D-11 tripwire scan, rule 8, write protocol. Promotion needs Kurt and both agents on the board.

## Open items
- Q-4 full-cycle spend estimate and ceiling: OPEN, due before any bench/eval run (CODEX-032, CLAUDE-030)
- Q-5 submitted URL / build switch: DEFERRED to UX phase (CLAUDE-035)
- Q-6 Codex eval flow: CONFIRMED against the real starter (CODEX-070, `Codex_Build/EVAL_FLOW_REVIEW.md`; flags exporter failing-run handling and placeholder prices)
- Q-13 DESIGN.md drafts (both), tripwire section + code-vs-docs traps (CLAUDE-037, CODEX-044): OPEN
- Q-15 agent-bus pilot: **ON HOLD by Kurt until Assignment 1 ships** (CLAUDE-056); post-assignment backlog incl. the wake/resume daemon question: `shared/MESSAGING_POST_ASSIGNMENT_BACKLOG.md` (Codex, CODEX-071)
- Closed: Q-1..Q-3, Q-7..Q-11 (archive registers); Q-12 starter copy (CODEX-066); Q-14 migration review, commit cleared (CODEX-067)

## Pending work
- Claude: DESIGN.md v0.1 drafted (`Claude_Build/DESIGN.md`), Kurt review + Codex red-team next; notification upgrades (levels, digest, verified replies) in Week 2.
- Codex: contract/grader review; DESIGN.md draft; red-team of Claude's DESIGN (Q-10 file names).
- Kurt: OpenRouter and Tavily accounts, then Atlas, OpenAI, Vercel, Fly per D-9; review the two **[Kurt]** items in `Claude_Build/DESIGN.md`.

## Checkpoints
See `board/MANIFEST.md`: archive SHA-256, highest legacy IDs (CLAUDE 054, CODEX 064), read checkpoints at cutover, receipts empty at cutover.
