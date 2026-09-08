---
description: Scaffold a new project with git, the SessionEnd auto-commit hook, .gitignore, and a starter CLAUDE.md
argument-hint: [optional one-line project description]
---

Bootstrap a new project in the **current working directory**, which becomes the project root the user will launch Claude Code from. Optional project description from the user: $ARGUMENTS

Work concisely. Confirm before anything destructive. Mirror the setup tuned in the Florence Product Definition project.

## Step 0 — Orient and safety-check (do this first)

- Run `pwd`. State the folder and confirm with the user that this is the intended **project root** (the folder they will `cd` into and launch `claude` from going forward). If it looks like the home directory, a parent of many projects, or an unrelated existing repo, **STOP and ask** before doing anything.
- Check current state: `git rev-parse --show-toplevel 2>/dev/null` (already a repo?) and whether `.claude/settings.json` already defines a `SessionEnd` hook. **Do not duplicate or clobber** — merge or skip what already exists.
- Ask ONE question and wait for the answer:
  > **Lightweight** (git + auto-commit hook + a simple root CLAUDE.md) or **Full** (also adds an ADR decision log, a resume-note protocol, and numbered folders, like the Florence project)?

  Default to **Lightweight** if the user has no preference.

## Step 1 — git

If not already a repo: `git init -b main`.

## Step 2 — .gitignore

Create it if absent; if present, ensure these lines exist (don't remove the user's existing entries):

```
# macOS
.DS_Store
.AppleDouble
.LSOverride
Icon?

# Windows
Thumbs.db
ehthumbs.db
Desktop.ini

# Editor / temp files
*~
*.swp
*.tmp
.vscode/
.idea/

# Logs
*.log

# Claude Code: keep shared settings + hooks, ignore personal local overrides
.claude/settings.local.json
```

## Step 3 — .claude/hooks/commit-on-session-end.sh

Write this exact script, then `chmod +x` it:

```bash
#!/usr/bin/env bash
#
# commit-on-session-end.sh
# Backstop: auto-commit any uncommitted changes when a Claude Code session ends.
# In-session, Claude makes deliberate, labeled commits as work firms up; this is
# the safety net so nothing is lost if a commit was missed.

set -uo pipefail

# Resolve repo root from this script's own location (.claude/hooks/ -> root),
# so it works no matter which subfolder the session was launched from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO" || exit 0

# No-op if not a git repo, or if there is nothing to commit.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
if [ -z "$(git status --porcelain)" ]; then exit 0; fi

git add -A
git commit -q -m "Auto-commit on session end ($(date '+%Y-%m-%d %H:%M'))

Backstop commit from the SessionEnd hook — captures work not committed
during the session.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" >/dev/null 2>&1

echo '{"systemMessage": "Session-end hook: committed uncommitted changes to git."}'
exit 0
```

## Step 4 — .claude/settings.json

If the file doesn't exist, create it with exactly this. If it exists, **merge** the `SessionEnd` hook into the existing JSON (preserve everything else):

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR/.claude/hooks/commit-on-session-end.sh\"",
            "timeout": 30,
            "statusMessage": "Committing session changes to git…"
          }
        ]
      }
    ]
  }
}
```

After writing, validate: `jq -e '.hooks.SessionEnd' .claude/settings.json` should succeed.

## Step 5 — root CLAUDE.md

Create it if absent (don't overwrite an existing one — offer to amend instead). Keep it short and in Kurt's Hemingway style. Do **not** re-import the global `~/.claude/CLAUDE.md` — Claude Code loads that automatically; this file is for *project-specific* context only. Use the user's $ARGUMENTS for the purpose line, or ask. Template:

```markdown
# CLAUDE.md — <Project Name>

**Goal:** <one line from the user / $ARGUMENTS>
**Owner:** Kurt Lozier, Head of Product, NightingaleMD (kurt.lozier@gmail.com)
**Status:** Scaffolded <today's date>.

## Working style
Hemingway — short, declarative, active. Confirm before multi-step work. Don't fabricate. (Global preferences load automatically from ~/.claude.)

## Conventions
- This repo is git-versioned. Claude commits deliberately as work firms up; a SessionEnd hook backstops anything uncommitted. Launch Claude from this folder (the project root).

## Do-not
- <project-specific guardrails, added as they emerge>
```

### If the user chose "Full", also add:
- `00_Foundation/`, `01_Inputs_and_Research/`, `02_Working/`, `04_Decisions/`, `90_Archive/` (adjust to the project).
- `04_Decisions/ADR_TEMPLATE.md` and `04_Decisions/README.md` (an ADR index table). Use ADRs for meaningful decisions.
- `00_Foundation/Resume_TEMPLATE.md` plus a session open/close protocol section in CLAUDE.md (write a `Resume_from_YYYYMMDD_HHMM.md` at session close; most-recent-by-filename is authoritative). Mirror the Florence conventions, trimmed to this project.

## Step 6 — Baseline commit

`git add -A`, then commit:

```
Baseline: <project> scaffold (git + SessionEnd hook + CLAUDE.md)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## Step 7 — Handoff

Tell the user, briefly:
- Launch Claude from **this folder** (the project root) going forward — not a subfolder — or the hook and project settings won't be read.
- Open `/hooks` once (or restart Claude Code) so the SessionEnd hook arms this session.
- The hook is the backstop; Claude commits as you go, so nothing is at risk meanwhile.
- For offsite backup later, push to a private GitHub remote (not iCloud — iCloud corrupts git repos).
