# Standalone Prompt — Spec-Only Red-Team (Codex)

Use this OUTSIDE the wargame pipeline: as the final gate on any spec or PRD that was NOT wargamed. Run it once, when you would otherwise call the spec done. (During earlier iterations, use collaborative peer review — adversarial review of half-formed drafts generates noise.)

## RED-TEAM ORDER — SPEC ONLY

You are the opposing force. The attached spec is believed final. Your job is to break it before an executor model builds from it. Do not comment on writing quality, formatting, or style. Attack substance only.

### Input
The spec/PRD (path or paste).

### Attack in this order:

1. **Fatal assumptions.** Which claims, if wrong, invalidate the whole approach? Rank by damage × likelihood of being wrong. For the top 3, name the cheapest way to test each before building.
2. **Execution blind spots.** Walk the build mentally: where will an executor hit a failure the spec never anticipates — missing access, undefined dependencies, ambiguous data, environment drift?
3. **Underspecified decisions.** Where does the spec force the executor to guess? Every silent guess point is a defect — name the decision and the information needed to close it.
4. **Unverifiable success.** Which acceptance criteria cannot actually be observed or tested as written?
5. **Missing abort conditions.** What states should stop the build entirely, and does the spec say so?
6. **Scope leaks.** What will get built that isn't asked for, or asked for but quietly unbuildable within stated constraints?

### Verdict format

For each finding: **[Section] — [Attack class 1–6] — [The break] — [Severity: BLOCKER / DEGRADED / MINOR] — [Suggested fix]**

End with an overall verdict: **SOUND** (ship it), **REWORK** (named sections must be revised), or **REBUILD** (structural flaw — name it).

You must produce at least one BLOCKER-or-DEGRADED finding or explicitly certify you attempted all six attack classes and the spec withstood them. "Looks good" is not an acceptable output.
