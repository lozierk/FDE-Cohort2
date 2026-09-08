#!/bin/bash
# notify_kurt.sh — shared alert channel for Claude and Codex (v3, after Codex review in M-010).
#
# Usage:  shared/notify_kurt.sh <AGENT> <BOARD-ID> "<one-line summary>" [channels] [--reminder]
#   channels: comma list of desktop,telegram,imessage. Default: CHANNELS= in config, else "desktop".
#   --reminder: allowed once per BOARD-ID, and only 15+ minutes after the first send.
# Example: shared/notify_kurt.sh Codex CODEX-014 "Atlas URI needed; indexing blocked" desktop,imessage
#
# Rules encoded here: one alert per board ID (dedup marker in shared/.sent/), at most one
# reminder, per-channel outcome logged AFTER the attempt in shared/alerts.log, config read as
# data (never sourced), destination never printed, text passed to AppleScript via argv (never
# interpolated into script source). Exit 0 if at least one channel delivered, else 1.

set -u
AGENT="${1:?agent name}"; MID="${2:?board id}"; MSG="${3:?one-line summary}"
CH="${4:-}"; FLAG="${5:-}"
[ "$CH" = "--reminder" ] && { FLAG="--reminder"; CH=""; }
HERE="$(cd "$(dirname "$0")" && pwd)"
CFG="$HERE/notify.config"; LOG="$HERE/alerts.log"; SENT="$HERE/.sent"; mkdir -p "$SENT"
cfg() { [ -f "$CFG" ] && grep -E "^$1=" "$CFG" | head -1 | cut -d= -f2- | tr -d '"' || true; }
now() { TZ=America/New_York date '+%Y-%m-%d %H:%M:%S ET'; }
log() { echo "$(now) | $AGENT | $MID | $1" >> "$LOG"; echo "$1"; }

[ -z "$CH" ] && CH="$(cfg CHANNELS)"; [ -z "$CH" ] && CH="desktop"

# Dedup / reminder guard
MARK="$SENT/$MID"          # directories, created atomically with mkdir: two concurrent senders cannot both win
if [ "$FLAG" = "--reminder" ]; then
  [ -d "$MARK" ] || { log "REFUSED: no prior alert for $MID; send the alert first"; exit 1; }
  AGE=$(( $(date +%s) - $(stat -f %m "$MARK") ))
  if [ "$AGE" -lt 900 ]; then log "REFUSED: reminder too early for $MID (${AGE}s < 900s)"; exit 1; fi
  mkdir "$MARK.reminder" 2>/dev/null || { log "REFUSED: reminder already sent for $MID"; exit 1; }
  KIND="REMINDER"
else
  mkdir "$MARK" 2>/dev/null || { log "REFUSED: already alerted for $MID (use --reminder once, after 15 min)"; exit 1; }
  KIND="ALERT"
fi

TITLE="ATTN: KURT [$KIND] $AGENT $MID"
log "$KIND: $MSG (channels: $CH)"
BODY="$MSG — details on MESSAGE_BOARD.md at $MID"
OK=0

for c in $(echo "$CH" | tr ',' ' '); do
  case "$c" in
    desktop)
      if osascript -e 'on run argv' -e 'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"' -e 'end run' "$TITLE" "$BODY" >/dev/null 2>&1
      then log "desktop:sent"; OK=1; else log "desktop:FAILED (osascript unavailable or not permitted)"; fi ;;
    telegram)
      TOK="$(cfg TELEGRAM_BOT_TOKEN)"; CHAT="$(cfg TELEGRAM_CHAT_ID)"
      if [ -z "$TOK" ] || [ -z "$CHAT" ]; then log "telegram:skipped (not configured)"; continue; fi
      R=$(curl -s -m 15 -X POST "https://api.telegram.org/bot${TOK}/sendMessage" \
          --data-urlencode "chat_id=${CHAT}" --data-urlencode "text=${TITLE}
${BODY}
Reply here or on the board.")
      if echo "$R" | grep -q '"ok":true'; then log "telegram:sent"; OK=1
      else log "telegram:FAILED ($(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("description","no response"))' 2>/dev/null || echo "no response"))"; fi ;;
    imessage)
      DEST="$(cfg KURT_IMESSAGE)"
      if [ -z "$DEST" ]; then log "imessage:skipped (not configured)"; continue; fi
      if osascript -e 'on run argv' -e 'tell application "Messages"' \
           -e 'set s to 1st account whose service type = iMessage' \
           -e 'send (item 2 of argv) to participant (item 1 of argv) of s' \
           -e 'end tell' -e 'end run' "$DEST" "$TITLE: $BODY" >/dev/null 2>&1
      then log "imessage:sent"; OK=1; else log "imessage:FAILED (Messages sign-in or Automation permission)"; fi ;;
    *) log "unknown channel '$c' ignored" ;;
  esac
done
[ "$OK" = 1 ] && exit 0 || { log "NO CHANNEL DELIVERED"; exit 1; }
