# Transferable skills and workflows from Kurt's Claude setup — for Codex

Copied 2026-09-08 by Claude (CODEX-024). `spec-wargaming` is already in `shared/spec-wargaming/`
and is not duplicated here. Everything is verbatim from Kurt's skill workshop
(`~/.claude/plugins/marketplaces/lozierk/`, canonical source github.com/lozierk/claude-skills,
private) or `~/.claude/commands/`.

## The one Codex asked about first: session close

`close/SKILL.md` is the single source of truth for closing a session. Naming and content
requirements, in brief; the file has the full spec:

- **`Resume_from_YYYYMMDD_HHMM.md`** — for paused, in-progress work. Timestamp from the
  system clock, never guessed. Most-recent-by-filename is authoritative. Lives in the
  project's foundation folder or root. Sections: header with TLDR and a "Supersedes" line;
  a **quick re-start prompt** in confirm-first form (read these files, confirm state, propose
  the next step; never "start working"); a detailed fallback prompt with files-to-read-in-order,
  where-we-paused, ordered next goals with gates, open questions by person, a "Start by:"
  script; a session log; and a closing block with a **"Do not:" list**.
- **`SetPoint_YYYYMMDD_HHMM.md`** — for finished state, a reference snapshot. Saved near what it
  describes. Captures what exists, how to use it, decisions made, explicitly-not-decided, and a
  "Do not" list. No re-start prompt.
- Two real examples from another project are in `examples/` so the structure is concrete.

Claude-only parts of the close procedure: step 2 (write to Claude Code's per-project memory
directory) and the `/close` invocation itself. Tool-agnostic parts: the artifact formats
above, the brain-hub append (`~/brain/projects/<name>.md` + `~/brain/index.md`), and the
commit-and-push hygiene. Codex's existing default of `RESUME_FROM_YYYYMMDD.md` differs only in
name; Kurt's convention is `Resume_from_YYYYMMDD_HHMM.md`, and the content spec above is richer.

## Recommended transfer set, in priority order

| Item | Path here | Purpose | Preference or Claude-specific? |
|---|---|---|---|
| close | `close/SKILL.md` | Session handoff artifacts (above) | Format is preference; memory step is Claude-only |
| write | `commands/write.md` | Hemingway prose with an audience-specific style table; asks who the audience is if unstated | Pure preference; `$ARGUMENTS` is Claude's slash-command placeholder |
| writing-for-agents | `writing-for-agents/SKILL.md` + `SKILL-MECHANICS.md` | How to write skills, AGENTS.md, CLAUDE.md so an agent follows them. Directly useful for improving Codex's AGENTS.md | Principles transfer; examples reference Claude Code skill frontmatter |
| rigor-mode | `rigor-mode/SKILL.md` | Four-gate discipline (scope, evidence, adversarial reasoning, verification) for builds and debugging where the first answer may be wrong | Tool-agnostic |
| grilling | `grilling/SKILL.md` | Relentless interview to stress-test a plan or decision before committing | Tool-agnostic |
| to-questionnaire | `to-questionnaire/SKILL.md` | Turn an unanswerable decision into a questionnaire for the right person | Tool-agnostic |
| prototype | `commands/prototype.md` | Kurt's prototype rules: visual confirmation, state assumptions, 2–3 look/layout variants in one file | Pure preference |
| new-project | `commands/new-project.md` | Project scaffold: git, auto-commit hook, .gitignore, starter CLAUDE.md | Mostly Claude Code specific (hooks, CLAUDE.md); the git/gitignore habits transfer |
| explain | `commands/explain.md` | Small explanation template | Preference |

Not included on purpose: the Orchestration rule (Claude model ladder), the `google-agents-cli-*`
skills (unrelated to this assignment), and `ideas/` (Kurt's private backlog).
