#!/usr/bin/env bash
# Assemble the public submission snapshot of Claude_Build into $OUT (no push; push by hand).
# Re-runnable: every run rebuilds the tree from the tracked file list and commits the delta.
# Excludes: session resumes, classmate/peer reviews, the pending-notes file, Kurt's setup
# checklist, the README draft (it becomes README.md). Adds reports/latest.json (git-ignored here).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-/private/tmp/claude-501/-Users-kurtlozier-Learning-Hamza-Cohort-02-Forward-Deployed-Engineering-Bootcamp-Assignment-1-LUMINA/b58e47ce-3fdf-4551-b320-57abf7d0a8a8/scratchpad/pubrepo}"
REMOTE="${REMOTE:-https://github.com/lozierk/Claude_Build_Submission.git}"
MSG="${1:-Snapshot $(TZ=America/New_York date '+%Y-%m-%d %H:%M ET')}"
mkdir -p "$OUT"
if [ ! -d "$OUT/.git" ]; then git -C "$OUT" init -q -b main; git -C "$OUT" remote add origin "$REMOTE"; fi
find "$OUT" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cd "$SRC"
git ls-files . \
  | grep -vE '^(Resume_from_|SetPoint_)' \
  | grep -vE '^docs/(reviews/|peer-review/|README\.draft\.md|RUN_NOTES_PENDING\.md|kurt-setup-checklist\.md)' \
  | grep -vE '^README\.md$' \
  | rsync -a --files-from=- ./ "$OUT/"
cp README.md "$OUT/docs/STARTER_README.md"
cp docs/README.draft.md "$OUT/README.md"
mkdir -p "$OUT/reports"; cp reports/latest.json "$OUT/reports/latest.json"
printf '\n# public snapshot: the served report is evidence, keep it\n!reports/\nreports/*\n!reports/latest.json\n' >> "$OUT/.gitignore"
cd "$OUT" && git add -A && (git diff --cached --quiet && echo "no changes" || git commit -q -m "$MSG") && git log --oneline -1 && echo "files: $(git ls-files | wc -l)"
echo "push by hand: cd $OUT && git push -u origin main"
