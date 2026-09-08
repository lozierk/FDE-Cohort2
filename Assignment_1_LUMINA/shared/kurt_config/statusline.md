# Claude Code terminal footer — how Kurt's context indicator works

Written 2026-09-08 by Claude for CODEX-026. Source: the `statusLine` key in
`~/.claude/settings.json` on this Mac. No other file is involved; there is no separate script.

## What the two footer lines are

| Line | Example | Who renders it |
|---|---|---|
| 1 | `Fable 5.1 \| Assignment_1_LUMINA \| ctx: 22%` | Kurt's custom `statusLine` command (below) |
| 2 | `auto mode on · 1 monitor · 1 agent` | Claude Code built-in status: permission mode, running background monitors, running subagents. Not configurable by the script. |

## What `ctx` means

**Percentage of the context window USED**, not remaining. `ctx: 22%` means 22% of the model's
context window is occupied by the conversation so far; 78% is free. When Claude Code's
built-in auto-compaction runs, the number drops.

## How it is measured and refreshed

Claude Code re-runs the `statusLine` command every time it redraws the footer, which is after
each model turn and tool result. It passes a JSON object on stdin. The script uses these fields:

- `model.display_name` → the model label
- `workspace.current_dir` (fallback `cwd`) → basename shown as the project
- `context_window.used_percentage` → used directly when present
- fallback: `context_window.total_input_tokens / context_window.context_window_size × 100`
- if neither is available it prints `ctx: n/a` rather than inventing a number

The numbers come from Claude Code's own token accounting for the session; the script does not
call any API. It is a measured value, refreshed on every redraw.

## Warnings and thresholds

None in the script. It prints the number only. Claude Code auto-compacts the conversation on
its own when the window fills; the script has no checkpoint logic and shows no colour change.
If Kurt wants a threshold warning (for example a `!` past 70%), that is a two-line change to
the awk `printf`.

## The setting, sanitized and reformatted for reading

The real value is a single-line shell string inside JSON. Equivalent readable form:

```json
{
  "statusLine": {
    "type": "command",
    "command": "<the shell below, on one line>"
  }
}
```

```bash
input=$(cat)
model=$(echo "$input" | jq -r '.model.display_name // "Claude"')
dir=$(echo "$input"   | jq -r '.workspace.current_dir // .cwd // empty')
base=$(basename "$dir" 2>/dev/null)
used=$(echo "$input"  | jq -r '.context_window.used_percentage // empty')
if [ -z "$used" ]; then
  total=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
  size=$(echo "$input"  | jq -r '.context_window.context_window_size // 0')
  if [ "$size" -gt 0 ] 2>/dev/null; then
    used=$(awk -v t="$total" -v w="$size" 'BEGIN{printf "%.0f", (t/w)*100}')
  fi
fi
if [ -n "$used" ]; then
  ctx=$(awk -v p="$used" 'BEGIN{printf "ctx: %.0f%%", p}')
else
  ctx="ctx: n/a"
fi
printf "%s | %s | %s" "$model" "$base" "$ctx"
```

Requires `jq` on PATH. Nothing sensitive is in the setting; this is the complete value.

## Kurt's preference, stated for any agent

Kurt wants to ALWAYS see measured context usage. For a tool without a status-line hook: expose
whatever measured figure the tool provides, say plainly when live telemetry is unavailable, and
never invent a percentage.
