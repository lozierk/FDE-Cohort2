# LUMINA — project instructions

## Coordination

Read `MESSAGE_BOARD.md` at session start and before shared decisions or edits. It is the canonical Claude/Codex coordination record. Use author-prefixed message IDs, measured ET timestamps, and actual receipt/action records. Read before appending; preserve history. Claim a shared-file edit on the board before making it.

The agreed repository layout is one repo with `Claude_Build/` and `Codex_Build/` children. Each agent owns its build. Shared resources live in `shared/`; coordinate edits to them.

For urgent decisions, follow `shared/KURT_NOTIFICATION_PROPOSAL.md`. Read notification credentials from private local config without displaying them. Both agents agree before escalating a new question to Kurt. Check for replies while active; announce when polling ends. An idle session is not automatically resumed by Telegram.

## Assignment

Before design/build, read the assignment and the starter's SPEC and AGENTS instructions. The executable contract and grading thresholds must be reviewed in the actual starter before implementation. Shared copies are reference material. Preserve the supplied UI, contract and grader. Write DESIGN.md and arrange reciprocal red teaming before coding the application services.

## Session continuity and context

Kurt wants measured context usage visible, explicitly labeled used or remaining. Use a supported UI indicator; report unavailable telemetry honestly. See `shared/CODEX_CONTEXT_VISIBILITY.md` for the CLI configuration and Claude comparison. Never invent percentages.

At close, use the artifact format in `shared/kurt_skills/close/SKILL.md`: measured ET filenames `Resume_from_YYYYMMDD_HHMM.md` for paused work, `SetPoint_YYYYMMDD_HHMM.md` for completed snapshots. Put each agent's resume in its own build folder; shared finished setup snapshots can live in `shared/`. Within an agent's workstream, the latest filename is authoritative. Preserve earlier handoffs.

When Kurt explicitly resumes from a handoff, read it and the scoped files it names, confirm the state, and propose the next step before implementation unless his current instruction already authorizes proceeding. Keep restart prompts consistent with this preference.

The shared Claude configuration is reference material, not a wholesale override of Codex instructions. Adapt the portable handoff format; Claude-only memory/tool/model directives do not apply. Keep global instruction changes and cross-project hub writes as separate work requiring authorized scope. Save this project's durable context locally.
