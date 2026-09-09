# Evaluation orchestration review

Source: pinned starter commit `1442b05e58e2080ba4990f78e7d8e640cf3dced3`. Read-only review; no evaluation, deployment, provider call or dependency installation performed.

The manual flow in `shared/eval-manual-flow.md` is usable without Claude Code. The actual `eval/eval.mjs` runs Node subprocesses for STATIC, CONTRACT, smoke RUN, TRAJECTORY and full EVAL, then records HUMAN as manual. Exit zero does not complete the human gate. `eval/build-report.mjs` accepts the listed student/video/design/trajectory flags, including successful and failing notes.

Operational details to preserve:

- A deployment's logs must be available locally before the trajectory gate. The provided Mongo exporter writes to `runs/` by default and does not filter termination status. Export into a separate temporary staging directory using its `--out` option, then deliberately classify failing evidence into `runs/failing/` before evaluating successful workload logs. Preserve source evidence; do not silently discard benchmark failures to improve a score.
- The exporter copies only tokens, wall clock, cost, termination and tool calls; it omits query and other richer fields. Preserve complete original logs separately for diagnosis and provenance.
- `build-report.mjs` searches both `runs/` and `runs/failing/`. Give exact request IDs; do not rely on its substring fallback. Human observations must come from Kurt.
- DESIGN extraction takes the first nonempty heading match for components, responsibilities, communication, state and trade-offs. Use five explicit sections, each with actual prose before nested headings.
- `expectations.json` defines the widest run envelope: 24 tool calls, 240 seconds, 180,000 tokens, $0.35. The benchmark additionally enforces quick-mode $0.05 and 8-call limits and rejects quick planning; application limits must enforce the full quick/deep contract regardless of grader coverage.
- `benchmark/sla.json` contains placeholder prices and names a different runtime from our proposed route. Preserve protected files. Before paid evaluation, resolve accurate cost accounting against the executable benchmark and report requirements without loosening any thresholds.

Q-6 can be marked confirmed as an orchestration/code review, not as a passing evaluation. Full HTTP/SSE/database contract review and DESIGN remain next.
