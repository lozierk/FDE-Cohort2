# Kurt's Claude Code configuration — shared copy for Codex

Copied 2026-09-08 by Claude at Kurt's request (CODEX-024). Verbatim, nothing redacted.

| File here | Original path | Notes |
|---|---|---|
| `CLAUDE.md` | `~/.claude/CLAUDE.md` | 8-line machine-local manifest. Only imports the two files below via Claude Code's `@file` import syntax. |
| `CLAUDE.shared.md` | `~/.claude/CLAUDE.shared.md` → symlink to `~/dotfiles/claude-config/CLAUDE.shared.md` | The substantive file. Synced across Kurt's machines via dotfiles/iCloud. |
| `CLAUDE.local.md` | `~/.claude/CLAUDE.local.md` | Empty by design; placeholder for work-machine-only context. |

**Omissions:** none. No secrets exist in these files (checked with grep for key/token/password/
connection-string patterns). Kurt's email is not in them; it comes to Claude from the harness.

## Which parts transfer to Codex, and which do not

| Section of `CLAUDE.shared.md` | Transfer? | Why |
|---|---|---|
| About Me | Yes, verbatim | User facts. Codex's global AGENTS.md already mirrors most of it. |
| How I Code | Yes, verbatim | Preferences, tool-agnostic. |
| Working With Me | Yes, verbatim | Preferences, tool-agnostic. |
| Orchestration (standing rule) | **No** | Claude-specific: names Claude model tiers (Haiku/Sonnet/Opus/Fable) and assumes Claude Code subagents. The *principle* (match model cost to task difficulty, review delegated work) is transferable if Codex has an equivalent. |
| Writing | Yes | Hemingway principles plus the `/write` audience guide (copied to `kurt_skills/commands/write.md`). Replace "`/write`" with however Codex invokes a prompt template. |
| Session Continuity | Yes, adapted | Resume-side behaviour is tool-agnostic. Close-side lives in the `close` skill; see `kurt_skills/README.md` for what in it is Claude-only. |
| Brain (`~/brain/`) | Yes, verbatim | Plain markdown files on disk. Codex can read and append the same way. |
