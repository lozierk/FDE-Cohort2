"""Parse a Telegram getUpdates response from stdin. Accept only messages whose chat id and
sender id match the configured values; log everything else by id only. Write accepted replies
durably, then advance the offset. Deduplicate by update_id."""
import sys, json, os, datetime

here = os.environ["TG_HERE"]
want_chat = os.environ["TG_CHAT"].strip()
want_uid = os.environ["TG_UID"].strip()
accepted_path = os.path.join(here, "kurt_replies.log")
rejected_path = os.path.join(here, "rejected_replies.log")
seen_path = os.path.join(here, ".tg_seen")
offset_path = os.path.join(here, ".tg_offset")

try:
    data = json.load(sys.stdin)
except Exception as e:
    print("bad response from telegram:", e); sys.exit(1)
if not data.get("ok"):
    print("telegram error:", data.get("description", "unknown")); sys.exit(1)

seen = set()
if os.path.exists(seen_path):
    seen = set(l.strip() for l in open(seen_path) if l.strip())

last = None; n_ok = 0; n_rej = 0
for u in data.get("result", []):
    uid = u.get("update_id")
    last = uid if last is None else max(last, uid)
    if str(uid) in seen:
        continue
    m = u.get("message") or {}
    chat_id = str((m.get("chat") or {}).get("id", ""))
    from_id = str((m.get("from") or {}).get("id", ""))
    text = m.get("text")
    ts = datetime.datetime.fromtimestamp(m.get("date", 0)).strftime("%Y-%m-%d %H:%M:%S")
    if text is not None and chat_id == want_chat and from_id == want_uid:
        line = f"{ts} local | update {uid} | KURT: {text}"
        with open(accepted_path, "a") as f:
            f.write(line + "\n"); f.flush(); os.fsync(f.fileno())
        print("NEW REPLY:", line); n_ok += 1
    else:
        with open(rejected_path, "a") as f:
            f.write(f"{ts} local | update {uid} | rejected chat={chat_id} from={from_id}\n")
        n_rej += 1
    with open(seen_path, "a") as f:
        f.write(f"{uid}\n"); f.flush(); os.fsync(f.fileno())

if last is not None:
    tmp = offset_path + ".tmp"
    with open(tmp, "w") as f:
        f.write(str(last + 1)); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, offset_path)
print(f"{n_ok} accepted, {n_rej} rejected")
