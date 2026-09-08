# Stage 2 Prompt — Wargame Order (Claude)

## WARGAME ORDER

You are NOT executing this mission and NOT writing a plan. You are wargaming it: fighting the build on paper, move by move, before anything is built.

A separate executor model — named in the mission brief — will run the final PRD. Tailor every move to how that specific model behaves: its strengths, its known failure patterns, its context limits. If you are unsure how it behaves, state your assumption in the ledger.

### Inputs
1. The spec draft (path provided by the operator)
2. The completed mission brief (`templates/mission-brief.md`)

### Output
Write to `wargames/<mission-name>.md` (create the folder if absent). Write unresolved items to `wargames/ledger.md`.

### For every move in the build sequence, document:

1. **The move** — one concrete action the executor takes.
2. **Expected observation** — exactly what the executor should see if the move worked. Must be verifiable, not "it works."
3. **Failure signal** — what the executor sees if it didn't work.
4. **Most likely failure** — the single most probable way this move fails, its root cause, and its signals.
5. **Counter-move** — the specific recovery action. If recovery itself can fail, give its counter-move (second-order). Stop at third-order.
6. **Fork triggers** — where the path branches: "If you observe X, take route A; if Y, take route B." Every fork gets an explicit trigger. Max 3 scenarios per fork.

### Ledger discipline

Any variable, decision, or fact your reconnaissance cannot resolve from the spec or mission brief: do NOT invent a value. Write it to `wargames/ledger.md` as:

```
(NEEDS INPUT: <what> — <why it matters> — <what happens if guessed wrong>)
```

The operator resolves the ledger before red-teaming begins.

### Abort conditions

End the wargame file with **ABORT CONDITIONS** — the specific observations that mean the executor must stop entirely rather than counter-move (e.g., missing system access, a dependency that doesn't exist, a spec contradiction that can't be resolved locally). For each: the observation, why it is unrecoverable, and what to report back.

### Constraints

- Simulate second- and third-order consequences only. Do not go deeper.
- Pessimistic by default: assume reality humbles every move at least once.
- No blue-sky paths: a wargame where every move succeeds is a failed wargame.
- If the spec contains multiple independent workstreams, produce one wargame file per workstream.

---

**MISSION BRIEF FOLLOWS** (operator: paste or reference the completed mission-brief.md and spec path below)
