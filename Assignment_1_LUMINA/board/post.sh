#!/bin/bash
# board/post.sh — publish one immutable message file atomically.
#
#   board/post.sh <agent> "<title>" [--to "Codex, Kurt"] [--re "CODEX-064, CLAUDE-054"] \
#                 [--scope project|program] [--status OPEN|CLOSED|...] < body.md
#
# The author prefix is the agent name in upper case; an agent cannot post under another prefix.
# The next number is max(manifest baseline for that author, highest existing file) + 1.
# The complete message is written to a temp file under board/.tmp (same filesystem), then
# published with an exclusive hard link into board/messages. If the final name already exists the
# next number is tried. Readers never see a partial file; a duplicate ID can never overwrite.
# Model and session labels are provenance, not authentication: set BOARD_MODEL / BOARD_SESSION.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"; MSG="$HERE/messages"; TMP="$HERE/.tmp"; MAN="$HERE/MANIFEST.md"
AGENT="${1:?agent}"; TITLE="${2:?title}"; shift 2
[[ "$AGENT" =~ ^[a-z]{2,16}$ ]] || { echo "REFUSED: bad agent name"; exit 2; }
AUTHOR="$(printf '%s' "$AGENT" | tr a-z A-Z)"
TO="Codex, Kurt"; RE=""; SCOPE="project"; STATUS="OPEN"
while [ $# -gt 0 ]; do case "$1" in
  --to) TO="$2"; shift 2;; --re) RE="$2"; shift 2;; --scope) SCOPE="$2"; shift 2;; --status) STATUS="$2"; shift 2;;
  *) echo "REFUSED: unknown option $1"; exit 2;; esac; done
[[ "$SCOPE" =~ ^(project|program)$ ]] || { echo "REFUSED: scope must be project or program"; exit 2; }
printf '%s' "$TITLE" | grep -q '[[:cntrl:]]' && { echo "REFUSED: control characters in title"; exit 2; }
[ -d "$MSG" ] || { echo "REFUSED: $MSG does not exist (not migrated?)"; exit 1; }
mkdir -p "$TMP"
BODY="$(cat)"
WORDS=$(printf '%s' "$BODY" | wc -w | tr -d ' '); LIMIT=200
if [ "$WORDS" -gt "$LIMIT" ] && [ "${ALLOW_LONG:-0}" != 1 ]; then
  echo "REFUSED: body is $WORDS words; budget is $LIMIT. Put the long material in a file and post a pointer, or set ALLOW_LONG=1 to publish with an over-budget label."; exit 2
fi
TS="$(TZ=America/New_York date '+%Y-%m-%d %H:%M:%S ET')"
MODEL="${BOARD_MODEL:-unstated}"; SESSION="${BOARD_SESSION:-$(date +%Y%m%d)-$$}"
base=0; [ -f "$MAN" ] && base=$(grep -E "^baseline: $AUTHOR " "$MAN" | awk '{print $3}' | tail -n1 || true); base=${base:-0}
last=$(ls "$MSG"/"$AUTHOR"-*.md 2>/dev/null | sed -E 's/.*-([0-9]+)\.md$/\1/' | sort -n | tail -n1); last=${last:-0}
start=$(( 10#$base > 10#$last ? 10#$base : 10#$last ))
for try in 1 2 3 4 5 6 7 8; do
  n=$(printf '%03d' $((start + try))); id="$AUTHOR-$n"; final="$MSG/$id.md"
  t="$(mktemp "$TMP/$id.XXXXXX")"
  { printf '### %s · %s\n' "$id" "$TITLE"
    printf -- '- Written:  %s (measured clock)\n' "$TS"
    printf -- '- Agent:    %s\n- Model:    %s\n- Session:  %s\n' "$AUTHOR" "$MODEL" "$SESSION"
    printf -- '- To:       %s\n' "$TO"
    [ -n "$RE" ] && printf -- '- Re:       %s\n' "$RE"
    printf -- '- Scope:    %s\n- Status:   %s\n' "$SCOPE" "$STATUS"
    [ "$WORDS" -gt "$LIMIT" ] && printf -- '- Length:   %s words, over the %s-word budget (ALLOW_LONG)\n' "$WORDS" "$LIMIT"
    printf '\n%s\n' "$BODY"
  } > "$t"
  if ln "$t" "$final" 2>/dev/null; then rm -f "$t"; echo "$id"; exit 0; fi
  rm -f "$t"
done
echo "REFUSED: could not allocate an ID for $AUTHOR after 8 tries"; exit 1
