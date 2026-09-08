# Running the LUMINA eval gates without the Claude Code skill

The starter ships `.claude/skills/fde-lumina-eval/SKILL.md` (copy in
`shared/fde-lumina-eval-skill/`). It is an orchestration script over three provided Node
programs. Nothing in it requires Claude Code. This is the same flow as plain commands, run
from the build folder root (the folder containing `package.json`, `eval/`, `benchmark/`).

The one rule from the skill: **never write a number a run did not produce.** Do not hand-edit
`report.json`, do not lower any threshold in `benchmark/sla.json` or `expectations.json`, and do
not edit `web/`, `packages/contract/`, `benchmark/`, `eval/`, `quality/`, `scripts/`.

## Inputs only Kurt can supply

| Field | Notes |
|---|---|
| Student name | as it should appear on the `/evals` page |
| Video URL | 60 to 90 s, YouTube or Loom; the page renders without it but the row stays open |
| `DESIGN.md` | the five questions, in the student's words; parsed by heading from `DESIGN.template.md` |
| Trajectory notes | what reading one successful and one failing run taught the student (rule P1) |

## Step 1 — Run the six gates against the deployed gateway

```bash
curl -sf https://<gateway>/health          # must be 200 and name model, search provider, vector backend
node eval/eval.mjs --deploy-url https://<gateway>
```

Gates run in order and stop at the first failure: STATIC, CONTRACT, RUN (smoke), TRAJECTORY,
EVAL (full bench), HUMAN. Outputs: `reports/gates.json`, `reports/bench.json`, `reports/eval.json`.

If a gate fails, fix the cause and re-run. Do not proceed to Step 4 with a failed gate.

Deployed instances write run logs to Mongo, so if `runs/` is empty:

```bash
node scripts/export-runs.mjs   # pulls the runs collection into runs/
node quality/check.mjs .       # trajectory rules over runs/*.json -> reports/quality.json
```

Keep any deliberately failed run in `runs/failing/`, not `runs/`. Rule A2 fails a run in
`runs/` that did not terminate `done`; rule P1 requires a failing trajectory to exist.

## Step 2 — Deep-search quality, side by side (manual row, 5 pts)

```bash
G=https://<gateway>; U=<user-id>
T=$(curl -s -X POST $G/threads -H "x-user-id: $U" | jq -r .threadId)
curl -N -X POST $G/threads/$T/ask -H "x-user-id: $U" -H 'content-type: application/json' \
  -d '{"query":"<question>","mode":"web","depth":"quick"}'
curl -N -X POST $G/threads/$T/ask -H "x-user-id: $U" -H 'content-type: application/json' \
  -d '{"query":"<question>","mode":"web","depth":"deep"}'
```

A human judges whether deep is better or merely longer. A model may not grade this row (rule E3).

## Step 3 — The human gate (P1)

1. List `runs/*.json` and `runs/failing/*.json` with `terminated` and the tool sequence.
2. Pick one successful and one failing run. Print every step in order with error strings.
3. Kurt writes what each taught him. Those words become `--successful-notes` and
   `--failing-notes`.

If no failing run exists, unset the search key on a local run and ask a question.

## Step 4 — Assemble the report

```bash
node eval/build-report.mjs \
  --student "<name>" \
  --video "<url>" \
  --design DESIGN.md \
  --successful <requestId> --failing <requestId> \
  --successful-notes "<Kurt's words>" --failing-notes "<Kurt's words>" \
  --notes "<model · search provider · Atlas tier>" \
  --out reports/report.json
```

Prints the scorecard. Exits non-zero if a red line was crossed, or if the bench was a `--smoke`
run. Three manual rows stay open for the grader; that is correct.

## Step 5 — Serve and verify

The gateway serves `reports/report.json` at `GET /evals/report.json` (static route, Mongo
document, or bundled asset; our choice). Then:

```bash
curl -sf https://<gateway>/evals/report.json | head -c 400
```

Redeploy, open `https://<vercel-url>/evals`, confirm it renders score, gates, SLA table, quality
rules, design section, both trajectories, and the embedded video. A schema error means the
report does not match `EvalsReport` in `packages/contract/src/report.ts`; re-run the builder.

## Report shape

See `shared/fde-lumina-eval-skill/references/report-shape.md`. The rubric with point values is
`shared/starter_docs/eval-rubric.json`.
