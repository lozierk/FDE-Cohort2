#!/usr/bin/env bash
# After `eval/eval.mjs --deploy-url …` has finished: pull the deployed runs, sort failures,
# run the quality check, build the report with Kurt's P1 words and run notes, and stage it as
# the served report. Then Kurt deploys the gateway by hand (fly deploy -c fly.gateway.toml).
set -euo pipefail
cd "$(dirname "$0")/.."
SINCE="${SINCE:-2026-09-15T11:00:00Z}"          # first deploy of the day; keeps req_b4cbfc27-3e1 in runs/
node scripts-local/export-since.mjs --since "$SINCE"
node scripts-local/sort-failing.mjs
# session 6's real error run, kept for P1 (outside the A2 scan)
[ -f runs/failing/req_793296f3-0fe.json ] || cp runs.local-deployed-1-report/failing/req_793296f3-0fe.json runs/failing/
node quality/check.mjs . || true   # exits 1 on warnings (A3, P2); build-report reads quality.json
node eval/build-report.mjs --student "Kurt Lozier" --design DESIGN.md \
  --successful req_b4cbfc27-3e1 --failing req_793296f3-0fe \
  --successful-notes "$(cat docs/p1-successful.txt)" \
  --failing-notes "$(cat docs/p1-failing.txt)" \
  --notes "$(cat docs/run-notes.txt)" \
  --repo https://github.com/lozierk/Claude_Build_Submission \
  ${VIDEO:+--video "$VIDEO"} \
  --out reports/report.json
cp reports/report.json reports/latest.json
python3 scripts-local/writeup-tables.py reports/latest.json > docs/measured-tables.generated.md
echo "staged: reports/latest.json · now: fly deploy -c fly.gateway.toml --remote-only"
