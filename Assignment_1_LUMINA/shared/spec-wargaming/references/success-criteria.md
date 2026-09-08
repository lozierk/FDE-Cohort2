# Success Criteria

A wargame cycle is complete only when all of the following hold. Used by the operator after Stage 4, and by Claude's final check in `prompts/03-integrate.md`.

1. **Every move is verifiable.** Each move has an expected observation a machine could check — no "it should work."
2. **No blue-sky path.** Every move carries at least one failure mode with a concrete counter-move.
3. **Bounded depth.** No fork exceeds 3 scenarios; no consequence chain exceeds third-order.
4. **Ledger is empty.** Zero `(NEEDS INPUT: ...)` markers remain anywhere in the final PRD.
5. **Every fork has a trigger.** No branch point relies on executor judgment without an explicit "if you observe X" condition.
6. **Abort conditions exist and are tested.** At least one abort condition, each attacked by the red-team (attack class 5).
7. **Red-team fully disposed.** Every finding is amended or rebutted in Appendix C; no BLOCKER rebutted without operator sign-off.
8. **Executor-tailored.** The battle plan names the executor model and contains no moves the red-team flagged as beyond its capabilities (attack class 7).
9. **Self-contained.** A fresh instance of the executor model, given only the final PRD, could begin the build without asking a single clarifying question.
