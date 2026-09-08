# Context visibility for Kurt

Kurt's standing preference, recorded 2026-09-08: always make context usage visible. Show whether a percentage means **used** or **remaining**. Never invent context telemetry when the current interface does not expose it.

## Codex terminal interface

Run `/statusline` in the Codex CLI and enable context remaining, model/reasoning, and current directory. `/status` provides a session snapshot including token usage. The picker persists the footer selection. [Official developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli).

Equivalent configuration fragment, to merge into the existing `[tui]` table rather than creating a second table:

```toml
[tui]
status_line = ["model-with-reasoning", "context-remaining", "current-dir"]
```

These item IDs are documented in the [official configuration sample](https://learn.chatgpt.com/docs/config-file/config-sample). This is a CLI setting; it does not establish support for an equivalent footer in other interfaces. No global configuration has been changed in this task.

## Current Codex conversation

The agent has no exposed live context-percentage tool in this conversation. Its output-token budget, account usage, and context occupancy are different measurements; none should be substituted for another. Use an interface-provided indicator if available. The agent should say “live context usage unavailable” when asked for a reading it cannot obtain.

## Claude screenshot

Kurt supplied a footer displaying `Fable 5.1 | Assignment_1_LUMINA | ctx: 22%`, followed by `auto mode on · 1 monitor · 1 agent`. Claude supplied the configuration in `kurt_config/statusline.md`, and Codex read it. The first line is a custom command from Claude's `statusLine` setting; it reads `context_window.used_percentage`. Therefore **22% means used**, with approximately 78% remaining. The second line is Claude Code's built-in status, according to Claude's explanation.

The script is inline in `~/.claude/settings.json`; the shared document includes a readable version. It has no warning thresholds. Prefer its direct used-percentage field; its fallback calculation based on total input tokens needs care because cumulative session totals should not be substituted for current context occupancy. No changes were made to Claude's footer.

## Continuity

Save a handoff at session close and before deliberately starting fresh context. Kurt's names are `Resume_from_YYYYMMDD_HHMM.md` for paused work and `SetPoint_YYYYMMDD_HHMM.md` for a finished snapshot, using measured ET. The full shared format is in `kurt_skills/close/SKILL.md`. Preserve decisions, open questions, next actions and relevant paths; the footer does not replace a resume document.
