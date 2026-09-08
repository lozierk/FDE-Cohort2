#!/bin/bash
# tg_bootstrap.sh — one-time binding of Kurt's Telegram ids after he creates the bot.
# Run by ONE agent after Kurt has (1) put TELEGRAM_BOT_TOKEN= into shared/notify.config and
# (2) sent the bot a first message. Verifies the bot via getMe, finds the first message whose
# sender username matches KURT_TG_USERNAME (default KurtLozier), and writes TELEGRAM_CHAT_ID and
# TELEGRAM_KURT_USER_ID into the config. Never prints the token. Does not send anything.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; CFG="$HERE/notify.config"
WANT_USER="${1:-KurtLozier}"
cfg() { [ -f "$CFG" ] && grep -E "^$1=" "$CFG" | head -1 | cut -d= -f2- | tr -d '"' || true; }
TOK="$(cfg TELEGRAM_BOT_TOKEN)"
[ -z "$TOK" ] && { echo "TELEGRAM_BOT_TOKEN is empty in shared/notify.config"; exit 1; }
[ "$(stat -f %Lp "$CFG")" != "600" ] && chmod 600 "$CFG" && echo "config mode set to 600"

ME=$(curl -s -m 15 "https://api.telegram.org/bot${TOK}/getMe") || { echo "telegram unreachable"; exit 1; }
BOTNAME=$(printf '%s' "$ME" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["result"]["username"] if d.get("ok") else "INVALID:"+d.get("description","?"))')
case "$BOTNAME" in INVALID:*) echo "token rejected: ${BOTNAME#INVALID:}"; exit 1;; esac
echo "bot verified: @$BOTNAME"

UPD=$(curl -s -m 15 "https://api.telegram.org/bot${TOK}/getUpdates?timeout=0") || { echo "telegram unreachable"; exit 1; }
IDS=$(printf '%s' "$UPD" | WANT="$WANT_USER" python3 -c '
import sys,json,os
d=json.load(sys.stdin); want=os.environ["WANT"].lower()
for u in d.get("result",[]):
    m=u.get("message") or {}
    f=m.get("from") or {}; c=m.get("chat") or {}
    if (f.get("username","") or "").lower()==want and c.get("type")=="private":
        print(c["id"], f["id"]); break
')
[ -z "$IDS" ] && { echo "no private message from @$WANT_USER found yet. Kurt: open @$BOTNAME and send it 'hello', then rerun."; exit 2; }
CHAT=${IDS% *}; UID_=${IDS#* }
python3 - "$CFG" "$CHAT" "$UID_" <<'PY'
import sys,re
p,chat,uid=sys.argv[1:]
s=open(p).read()
def setk(s,k,v):
    return re.sub(rf"^{k}=.*$", f"{k}={v}", s, flags=re.M) if re.search(rf"^{k}=", s, flags=re.M) else s.rstrip("\n")+f"\n{k}={v}\n"
s=setk(s,"TELEGRAM_CHAT_ID",chat); s=setk(s,"TELEGRAM_KURT_USER_ID",uid)
if not re.search(r"^CHANNELS=\S", s, flags=re.M): s=setk(s,"CHANNELS","desktop,telegram")
open(p,"w").write(s)
PY
chmod 600 "$CFG"
echo "bound: chat_id=$CHAT user_id=$UID_ (username @$WANT_USER). Config updated; token untouched."
