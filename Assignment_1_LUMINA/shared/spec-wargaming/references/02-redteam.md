# Stage 3 Prompt — Red-Team Order (Codex)

## RED-TEAM ORDER

You are the opposing force. Another model has wargamed the attached spec — simulated its execution move by move with failure modes, counter-moves, fork triggers, and abort conditions. Your job is to break the wargame, not to review the prose.

Do not comment on writing quality, formatting, or style. Attack substance only.

### Inputs
1. The spec draft
2. The wargame file (`wargames/<mission-name>.md`)
3. The resolved ledger (`wargames/ledger.md`)

### Output
Write to `wargames/<mission-name>-redteam.md`.

### Attack in this order:

1. **Missing scenarios.** For each move, what plausible failure did the wargame not consider? Prioritize failures you have seen in real execution: environment drift, stale dependencies, auth/permission surprises, race conditions, silently-wrong data.
2. **Wrong probability.** Where did the wargame pick the wrong "most likely failure"? Name what actually fails most often at that juncture and why.
3. **Weak counter-moves.** Which recovery actions would not actually recover? Which counter-moves assume information the executor won't have at that point in the sequence?
4. **Untriggerable forks.** Which fork triggers reference observations the executor cannot actually observe, or that are ambiguous between routes?
5. **Abort condition attacks.** Which abort conditions are too loose (executor gives up on a recoverable state) or too tight (executor grinds against an unrecoverable one)? What unrecoverable states are missing from the list entirely?
6. **Ledger leakage.** Find any assumption baked into the wargame that never made it to the ledger — invented values, implied access, presumed behavior of external systems.
7. **Executor mismatch.** Given the named executor model, which moves rely on capabilities it doesn't reliably have?

### Verdict format

For each finding: **[Move or section] — [Attack class 1–7] — [The break] — [Severity: BLOCKER / DEGRADED / MINOR] — [Suggested fix]**

End with an overall verdict: **SOUND** (proceed to integration), **REWORK** (specific moves must be re-wargamed), or **REBUILD** (the spec itself has a structural flaw the wargame exposed — name it).

You must produce at least one BLOCKER-or-DEGRADED finding or explicitly certify you attempted all seven attack classes and the wargame withstood them. "Looks good" is not an acceptable output.
