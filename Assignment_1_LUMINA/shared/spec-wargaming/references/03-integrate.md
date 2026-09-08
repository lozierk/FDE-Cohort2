# Stage 4 Prompt — Integration Order (Claude)

## INTEGRATION ORDER

The wargame has been red-teamed. Produce the final, execution-ready PRD.

### Inputs
1. The spec draft
2. The wargame file (`wargames/<mission-name>.md`)
3. The red-team report (`wargames/<mission-name>-redteam.md`)
4. The resolved ledger (`wargames/ledger.md`)

### Rules

1. **Address every red-team finding.** For each: either amend the wargame/spec, or rebut it with a specific reason in a "Red-Team Disposition" table (finding → action taken or rebuttal). No finding may be silently dropped.
2. **BLOCKER findings cannot be rebutted** without operator sign-off — flag any you believe are wrong and stop for input.
3. If the red-team verdict was **REWORK**, re-wargame only the named moves (per `prompts/01-wargame.md` rules), then integrate. If **REBUILD**, stop and report the structural flaw to the operator — do not integrate.
4. Fold resolved ledger values into the spec body. The final PRD must contain zero `(NEEDS INPUT: ...)` markers.

### Output structure — the final PRD:

1. **Spec body** — the revised spec, incorporating everything the wargame and red-team changed. Written for the named executor model.
2. **Appendix A: Battle Plan** — the final wargame (moves, observations, failure modes, counter-moves, fork triggers), amended per red-team findings. This is what the executor consumes during the build.
3. **Appendix B: Abort Conditions** — final list.
4. **Appendix C: Red-Team Disposition** — the finding-by-finding table.

### Final check

Verify the result against `success-criteria.md` and state pass/fail per criterion at the end of your response. If any criterion fails, say which and why rather than papering over it.
