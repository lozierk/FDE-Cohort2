#!/bin/bash
# board/read.sh — list, print, show and receipt board messages for one agent.
#
#   board/read.sh <agent> list                 unread message IDs (never own), with reason
#   board/read.sh <agent> print [N] [BYTES]    print up to N unread (default 5) within BYTES total
#                                              (default 24000); oversized ones are named, not printed
#   board/read.sh <agent> show <ID>            print one message in full, any size (explicit choice)
#   board/read.sh <agent> ack <ID@HASH8>...    record a receipt; the token comes from print/show and
#                                              binds to the exact bytes read; mismatch is refused
#
# Rules: list/print/show create nothing. A missing receipt file is reported as recovery state, not
# treated as "nothing read". Unread = ID+hash not in receipts; a changed file resurfaces as CHANGED.
# A receipt means read, never done or approved. IDs and agent names are validated before any path use.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"; MSG="$HERE/messages"; RCPT="$HERE/receipts"
AGENT="${1:?agent (claude|codex|kurt)}"; CMD="${2:-list}"; shift 2 || true
[[ "$AGENT" =~ ^[a-z]{2,16}$ ]] || { echo "REFUSED: bad agent name"; exit 2; }
ME="$(printf '%s' "$AGENT" | tr a-z A-Z)"; RF="$RCPT/$AGENT.txt"
valid_id() { [[ "$1" =~ ^[A-Z]{2,16}-[0-9]{3,6}$ ]]; }
sha() { shasum -a 256 "$1" | cut -c1-64; }
written() { local w; w="$(grep -m1 -E '^- Written:' "$1" | sed -E 's/^- Written: *//; s/ \(measured clock\)//')"; printf '%s' "${w:-0000-00-00 00:00:00 (no Written line)}"; }
receipt_state() {                                   # prints missing|ok|malformed:<line numbers>
  [ -f "$RF" ] || { echo missing; return; }
  bad="$(grep -n -v -E '^[A-Z]{2,16}-[0-9]{3,6} [0-9a-f]{64}$' "$RF" | grep -v -E '^[0-9]+:$' | cut -d: -f1 | tr '\n' ',' | sed 's/,$//')"
  [ -z "$bad" ] && echo ok || echo "malformed:$bad"
}
unread() {                                          # "written<TAB>ID<TAB>reason<TAB>hash"
  for f in "$MSG"/*.md; do [ -e "$f" ] || continue
    id="$(basename "$f" .md)"; valid_id "$id" || continue
    [ "${id%-*}" = "$ME" ] && continue
    h="$(sha "$f")"; reason=NEW
    if [ -f "$RF" ] && grep -q "^$id " "$RF"; then
      grep -q "^$id $h\$" "$RF" && continue || reason=CHANGED
    fi
    printf '%s\t%s\t%s\t%s\n' "$(written "$f")" "$id" "$reason" "$h"
  done | sort -t$'\t' -k1,1 -k2,2
}
banner() { local st; st="$(receipt_state)"
  case "$st" in
    missing) echo "RECEIPTS MISSING for $AGENT ($RF): recovery state; every non-own message is listed as unread. Restore the file or ack explicitly." ;;
    malformed:*) echo "RECEIPTS INCONSISTENT for $AGENT ($RF): malformed line(s) ${st#malformed:}; those lines count as no receipt. Repair the file (git checkout or edit) before trusting this listing." ;;
  esac; }
case "$CMD" in
  list)  banner; n=$(unread | wc -l | tr -d ' ')
         [ "$n" = 0 ] && echo "no new messages" || unread | awk -F'\t' '{print $2"  "$3"  "$1}' ;;
  print) banner; N="${1:-5}"; B="${2:-24000}"; [[ "$N" =~ ^[0-9]+$ && "$B" =~ ^[0-9]+$ ]] || { echo "REFUSED: N and BYTES must be integers"; exit 2; }
         total=$(unread | wc -l | tr -d ' '); [ "$total" = 0 ] && { echo "no new messages"; exit 0; }
         shown=0; used=0; skipped=""
         while IFS=$'\t' read -r w id reason h; do
           [ "$shown" -ge "$N" ] && break
           f="$MSG/$id.md"; sz=$(wc -c < "$f" | tr -d ' ')
           if [ "$sz" -gt "$B" ]; then skipped="$skipped $id($sz bytes)"; continue; fi
           if [ $((used + sz)) -gt "$B" ]; then break; fi
           echo "════ $id  $reason  $sz bytes  ack token: $id@${h:0:8} ════"; cat "$f"; echo
           shown=$((shown+1)); used=$((used+sz))
         done < <(unread)
         [ -n "$skipped" ] && echo "OVERSIZED (not printed, use: board/read.sh $AGENT show <ID>):$skipped" || true
         rem=$((total - shown)); [ "$rem" -gt 0 ] && echo "… $rem unread remain (printed $shown of $total within $B bytes)" || true ;;
  show)  id="${1:?ID}"; valid_id "$id" || { echo "REFUSED: bad ID"; exit 2; }; f="$MSG/$id.md"; [ -f "$f" ] || { echo "no such message $id"; exit 1; }
         h="$(sha "$f")"; echo "════ $id  $(wc -c < "$f" | tr -d ' ') bytes  ack token: $id@${h:0:8} ════"; cat "$f" ;;
  ack)   [ $# -ge 1 ] || { echo "ack needs at least one ID@HASH8 token"; exit 2; }
         case "$(receipt_state)" in malformed:*) banner; echo "REFUSED: repair the receipt file before acknowledging"; exit 1;; esac
         mkdir -p "$RCPT"; touch "$RF"
         for tok in "$@"; do
           id="${tok%@*}"; want="${tok#*@}"
           valid_id "$id" && [ "$want" != "$tok" ] && [[ "$want" =~ ^[0-9a-f]{8}$ ]] || { echo "REFUSED: token must be ID@HASH8 (from print/show): $tok"; exit 2; }
           [ "${id%-*}" = "$ME" ] && { echo "REFUSED: $id is your own message"; exit 2; }
           f="$MSG/$id.md"; [ -f "$f" ] || { echo "REFUSED: no such message $id"; exit 1; }
           h="$(sha "$f")"; [ "${h:0:8}" = "$want" ] || { echo "REFUSED: $id changed since you read it (now ${h:0:8}, token $want); re-read it"; exit 1; }
           grep -q "^$id $h\$" "$RF" && { echo "already receipted: $id"; continue; }
           echo "$id $h" >> "$RF"; echo "receipt: $id ${h:0:8}"
         done ;;
  *) echo "usage: see header of $0"; exit 2 ;;
esac
