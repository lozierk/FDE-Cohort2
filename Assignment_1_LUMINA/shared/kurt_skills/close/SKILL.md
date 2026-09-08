---
name: close
description: Run Kurt's session close procedure — fires on explicit /close, or when Kurt says he is ending the session and asks to close. Optional argument picks the artifact — "resume" (default) writes a Resume_from_*.md for paused in-progress work; "setpoint" writes a SetPoint_*.md snapshot of finished state.
---

# /close — session close procedure

This skill is the **single source of truth** for closing a session. CLAUDE.shared.md's
"Session Continuity" section holds only the resume-side behavior and a pointer here.

## 1. Parse the argument

- `resume` or no argument → **Resume mode** (in-progress work, will be continued)
- `setpoint` → **Set Point mode** (finished state, reference snapshot)
- anything else → ask Kurt which mode he means; don't guess

## 2. Save memories (both modes, always first)

Review the whole session for user preferences, project context, feedback, and reference
information worth persisting. Write/update memory files and the MEMORY.md index without
being asked. Update or delete existing memories that this session proved wrong.

## 3. Write the artifact

Get the timestamp from the system — run `date "+%Y%m%d_%H%M"` — never guess it.
**Most-recent-by-filename is authoritative** for both artifact types.

### Resume mode — `Resume_from_YYYYMMDD_HHMM.md`

Write it in the project's foundation folder (or project root if none). Structure
(modeled on `Florence_Product_Defination_n_PRD/00_Foundation/Resume_from_20260608_0915.md`):

- **Header** — title, date (+ session number if tracked), owner, a "Supersedes
  `<previous resume file>`" line, then a one-paragraph TLDR: what this session settled
  and the next move.
- **Quick re-start prompt** (the default; copy-paste block). It must NOT tell Claude to
  start working — confirm-first form:

  > Resuming <project/workstream name>.
  >
  > Please read `<path/to/CLAUDE.md>` and `<path/to/Resume_from_YYYYMMDD_HHMM.md>` before responding.
  >
  > Then confirm you understand the canonical state and propose how to start the next work step.

- **Detailed starter prompt (fallback)** — for when more in-chat context is needed:
  context paragraph; working-style reminders (confirm understanding before multi-step
  work; review Kurt's thinking on consequential decisions; one source at a time with
  checkpoints; don't fabricate; converge, don't repeat); **files to read first, in
  order, with why**; "where we paused" narrative; **immediate goals for next session,
  ordered, with gates** (what's blocked on whom); open questions grouped by person;
  newly-dropped unmined files flagged "do not assume their content"; a **"Start by:"**
  script (confirm files read → tight 3–5 sentence state summary → ask the gating
  question → offer two concrete options).
- **Session log** — files created/modified; decisions made (and what is explicitly
  *not* yet decided); mid-session direction from Kurt; commits if a git repo.
- **Session closed block** — closed date, state summary, "Resume by:" instruction, and
  a **"Do not:" list** of explicit negative constraints so the next session can't drift.

### Set Point mode — `SetPoint_YYYYMMDD_HHMM.md`

A Set Point captures the *finished state* of something (an architecture, a setup, a
reference snapshot) for future lookup — as opposed to a `Resume_from_*`, which captures
*in-progress* work to continue. Save it *near what it describes* (e.g. inside the
relevant repo), and prefer it over a resume file when the work is done, not paused.
Capture: what exists, how to use it, decisions made, and a "Do not" list. No resume
prompt — nothing is in progress.

## 4. Brain + repo hygiene

- Append a concise session summary to the relevant `~/brain/projects/<name>.md` and
  refresh its one-line entry in `~/brain/index.md`, per the brain rules in
  CLAUDE.shared.md (skip only if the session touched nothing brain-worthy).
- If the artifact or brain lives in a git repo, commit; on the MacBook Pro, push
  `~/brain` and any repo you committed to — unpushed commits are the known failure mode.

## 5. Confirm back

End with a short summary: artifact path, memories saved, repos pushed (with commit
hashes), and anything deliberately left open.
