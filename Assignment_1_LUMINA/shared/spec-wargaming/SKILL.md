---
name: spec-wargaming
description: Wargame a product spec or PRD before execution — simulate the build move-by-move with failure modes, counter-moves, fork triggers, an assumptions ledger, and abort conditions, then integrate a red-teamed battle plan into the final PRD. Use whenever the user wants to wargame a spec or plan, stress-test or red-team a PRD, run a premortem, simulate what could go wrong during a build, prepare a battle plan for an executor model, harden a spec before handing it to an AI agent, or declares a spec "done" and wants a final gate before execution. Also use for the standalone final-gate red-team of any spec that was not wargamed.
---

# Spec Wargaming

Harden a spec by fighting the build on paper before anything is built. A peer-reviewed spec can still be a blue-sky scenario: the plan reads as logical and linear, but it never demonstrates what happens when things don't go as planned. Wargaming fixes this by simulating execution move-by-move — action, reaction, counteraction — so the executor model inherits simulated experience instead of a linear plan.

## Pipeline overview

| Stage | Actor | Reference | Output |
|-------|-------|-----------|--------|
| 1. Draft | Claude (normal spec process) | — | spec draft |
| 1.5 Brief extraction | Claude + user | `references/mission-brief.md` | `Mission_Brief_<mission>.md` |
| 2. Wargame | Claude, fresh context | `references/01-wargame.md` | `wargames/<mission>.md` + `wargames/ledger.md` |
| 3. Red-team | **Codex (external)** — prepare handoff | `references/02-redteam.md` | `wargames/<mission>-redteam.md` |
| 4. Integrate | Claude | `references/03-integrate.md` | Final PRD with battle-plan appendix |

All outputs go in a `wargames/` folder at the project root — create it if absent. Determine which stage the user is at and jump in there; don't restart the pipeline if they arrive with a wargame already red-teamed.

## Stage 1.5 — Brief extraction

If a spec draft exists, extract the mission brief from it rather than asking the user to fill it in by hand. Read `references/mission-brief.md` and fill every field you can ground in the spec. For anything the spec doesn't answer, do not guess — mark it `(NEEDS INPUT: ...)`. A wrong guess in the brief propagates through every later stage.

Two fields must always come from the user, regardless of what the spec says: the **executor model** (you can't know their deployment intent) and **known risks going in** (their tacit knowledge is exactly what the wargame can't generate). Ask for both explicitly.

## Stage 2 — Wargame

Read `references/01-wargame.md` and execute it exactly against the spec and completed mission brief. Key disciplines, and why they matter:

- **You are not executing and not planning — you are simulating.** Every move gets an expected observation, a failure signal, its most likely failure with counter-move, and explicit fork triggers ("if you observe X, take route A").
- **Ledger, never guess.** Unresolvable variables go to `wargames/ledger.md` as `(NEEDS INPUT: ...)`. This is where the user's unknown unknowns surface — it is the highest-value output of the whole pipeline. After writing the wargame, tell the user to resolve every ledger item before Stage 3.
- **Bound the depth.** Max 3 scenarios per fork, third-order consequences at most. Deeper simulation buries signal.
- **No blue-sky path.** A wargame where every move succeeds is a failed wargame.
- **Fresh context matters.** If you drafted the spec in this same conversation, warn the user that wargaming works best in a session that never saw the drafting context (anchoring is a bigger contaminant than model identity), and recommend they start one. Proceed if they prefer.

## Stage 3 — Red-team handoff (Codex)

Red-teaming is pure evaluation, so cross-vendor diversity is non-negotiable — a model reviewing its own family's work shares its blind spots. Do not red-team the wargame yourself. Instead, prepare a handoff package for the user to give to Codex (or another non-Claude model): the spec, the wargame file, the resolved ledger, and the full text of `references/02-redteam.md`. Tell the user to save Codex's output as `wargames/<mission>-redteam.md`.

## Stage 4 — Integrate

Once the red-team report exists, read `references/03-integrate.md` and follow it: dispose of every finding (amend or rebut — never silently drop), fold resolved ledger values into the spec body, and produce the final PRD with battle-plan, abort-conditions, and red-team-disposition appendices. Verify against `references/success-criteria.md` and report pass/fail per criterion honestly.

## Standalone mode — spec-only red-team (final gate)

For specs that don't warrant the full pipeline: collaborative peer review while the draft is forming, one adversarial pass when the user would otherwise call it done. When the user asks for a final gate, red-team, or premortem on a non-wargamed spec, prepare a Codex handoff using `references/02-redteam-spec-only.md` instead. If the user explicitly wants you (Claude) to run it, you may — but state the self-review caveat and recommend the cross-vendor pass.

## Model allocation (advise the user)

Draft with their usual Claude → wargame with the strongest available model in a fresh session → red-team with Codex → integrate with Claude. Stage 2 needs strength more than difference; Stage 3 needs difference above all.
