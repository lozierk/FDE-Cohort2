#!/bin/bash
# board/tests/fixtures.sh — acceptance fixtures for read.sh, post.sh, render.sh, mapped to
# Codex_Build/BOARD_MIGRATION_REVIEW.md. Runs in a throwaway copy; touches no real board files.
# Prints one PASS/FAIL line per check and exits non-zero on any FAIL.
set -u
SRC="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/boardfix.XXXXXX")"; mkdir -p "$T/messages" "$T/receipts"
cp "$SRC/read.sh" "$SRC/post.sh" "$SRC/render.sh" "$T/"; cd "$T"
printf 'baseline: CLAUDE 054\nbaseline: CODEX 064\n' > MANIFEST.md
fail=0; ok() { echo "PASS  $1"; }; bad() { echo "FAIL  $1"; fail=1; }
snap() { find . -type f | sort | md5; }

# 1. list/print create nothing and report missing receipts
rm -f receipts/claude.txt; before="$(snap)"
out="$(./read.sh claude list)"; after="$(snap)"
[ "$before" = "$after" ] && ok "list creates no files" || bad "list created files"
echo "$out" | grep -q 'RECEIPTS MISSING' && ok "missing receipt file is reported as recovery state" || bad "missing receipts not reported"

# 2. sequence baseline above manifest, even with empty messages dir
id1="$(echo 'first body' | ./post.sh claude 'first' --to Codex)"
[ "$id1" = "CLAUDE-055" ] && ok "first ID allocated above manifest baseline ($id1)" || bad "baseline ignored: $id1"
id2="$(echo 'reply' | ./post.sh codex 'reply' --re CLAUDE-055)"
[ "$id2" = "CODEX-065" ] && ok "codex baseline honoured ($id2)" || bad "codex baseline: $id2"

# 3. duplicate final name never overwritten; partial temp file never visible to readers
printf 'pre-existing\n' > messages/CLAUDE-056.md; keep="$(shasum messages/CLAUDE-056.md)"
id3="$(echo 'third' | ./post.sh claude 'third')"
[ "$id3" = "CLAUDE-057" ] && [ "$keep" = "$(shasum messages/CLAUDE-056.md)" ] && ok "existing ID skipped, not overwritten ($id3)" || bad "overwrite or wrong skip: $id3"
mkdir -p .tmp; printf '### CLAUDE-099 · partial\n- Written:  2026-09-09 12:00:00 ET\nhalf' > .tmp/CLAUDE-099.partial
./read.sh codex list | grep -q 'CLAUDE-099' && bad "partial temp file visible" || ok "partial temp file not visible to readers"
[ -z "$(ls .tmp | grep -v partial)" ] && ok "no temp files left behind by post" || bad "temp files left: $(ls .tmp)"

# 4. identity and path validation
echo x | ./post.sh 'claude;rm' 't' >/dev/null 2>&1 && bad "bad agent name accepted" || ok "bad agent name refused"
./read.sh claude show '../MANIFEST' >/dev/null 2>&1 && bad "path traversal accepted" || ok "path traversal refused"
./read.sh codex ack 'CODEX-065@deadbeef' >/dev/null 2>&1 && bad "own-message ack accepted" || ok "cannot receipt own message"

# 5. hash-bound receipts: token required, mismatch refused, changed content resurfaces
h="$(shasum -a 256 messages/CLAUDE-055.md | cut -c1-8)"
./read.sh codex ack 'CLAUDE-055' >/dev/null 2>&1 && bad "ack without hash accepted" || ok "ack without hash token refused"
./read.sh codex ack "CLAUDE-055@00000000" >/dev/null 2>&1 && bad "wrong hash accepted" || ok "wrong hash token refused"
./read.sh codex ack "CLAUDE-055@$h" | grep -q 'receipt: CLAUDE-055' && ok "correct token records receipt" || bad "correct token refused"
./read.sh codex list | grep -q 'CLAUDE-055' && bad "receipted message still listed" || ok "receipted message no longer unread"
printf '\nedited later\n' >> messages/CLAUDE-055.md
./read.sh codex list | grep -q 'CLAUDE-055  CHANGED' && ok "changed content resurfaces as CHANGED" || bad "changed content hidden"
./read.sh codex ack "CLAUDE-055@$h" >/dev/null 2>&1 && bad "stale token accepted after change" || ok "stale token refused after change"

# 6. late arrival with a lower number is still unread (set membership, not high-water mark)
printf '### CLAUDE-052 · late\n- Written:  2026-09-09 09:00:00 ET\n- Agent:    CLAUDE\nlate one\n' > messages/CLAUDE-052.md
./read.sh codex list | grep -q 'CLAUDE-052  NEW' && ok "late lower-numbered message is unread" || bad "late message skipped"

# 7. byte bounds: oversized named not printed, remaining count reported, nothing acked
head -c 30000 /dev/zero | tr '\0' 'x' > big.txt; { printf '### CLAUDE-058 · big\n- Written:  2026-09-09 12:05:00 ET\n- Agent:    CLAUDE\n'; cat big.txt; } > messages/CLAUDE-058.md
out="$(./read.sh codex print 10 5000)"
echo "$out" | grep -q 'OVERSIZED.*CLAUDE-058' && ok "oversized message named, not printed" || bad "oversized not reported"
echo "$out" | grep -q 'unread remain' && ok "remaining unread count reported" || bad "remaining count missing"
[ "$(wc -l < receipts/codex.txt | tr -d ' ')" = 1 ] && ok "print recorded no receipts" || bad "print changed receipts"

# 8. render: every message once, ordered by Written then ID, with as-of marker
./render.sh >/dev/null; v=BOARD_VIEW.md
grep -q '^As of ' "$v" && ok "view carries as-of marker" || bad "no as-of marker"
for id in CLAUDE-052 CLAUDE-055 CLAUDE-057 CODEX-065 CLAUDE-058; do c=$(grep -c "^### $id " "$v"); [ "$c" = 1 ] || bad "view has $id $c times"; done
first="$(grep -m1 -o '^### [A-Z]*-[0-9]*' "$v")"; [ "$first" = "### CLAUDE-052" ] && ok "view ordered by Written time (earliest first)" || bad "view order wrong: $first"

# 8b. malformed receipt records are reported, not treated as "nothing new"; ack refuses until repaired
cp receipts/codex.txt receipts/codex.bak; echo "CORRUPTED RECEIPT" >> receipts/codex.txt
out="$(./read.sh codex list)"; echo "$out" | grep -q 'RECEIPTS INCONSISTENT' && ok "malformed receipt line reported" || bad "malformed receipt not reported"
echo "$out" | grep -q 'no new messages' && bad "malformed receipts yielded 'no new messages'" || ok "malformed receipts do not hide unread work"
h57="$(shasum -a 256 messages/CLAUDE-057.md | cut -c1-8)"
./read.sh codex ack "CLAUDE-057@$h57" >/dev/null 2>&1 && bad "ack succeeded on malformed receipt file" || ok "ack refused until receipt file repaired"
mv receipts/codex.bak receipts/codex.txt

# 8c. word budget enforced; ALLOW_LONG labels instead of refusing
long="$(yes word | head -n 201 | tr '\n' ' ')"
echo "$long" | ./post.sh claude 'too long' >/dev/null 2>&1 && bad "201-word body accepted" || ok "201-word body refused"
idl="$(echo "$long" | ALLOW_LONG=1 ./post.sh claude 'long allowed')"
grep -q '^- Length:   201 words, over the 200-word budget' "messages/$idl.md" && ok "ALLOW_LONG publishes with over-budget label" || bad "over-budget label missing"

# 8d. render links Re: IDs that exist and marks legacy ones; header carries legacy count from manifest
printf 'legacy: %s\n' x > /dev/null; printf '# Board cutover manifest\n- Messages: 107\n- Bytes: 1 · SHA-256: `%s`\n' "$(printf '%064d' 0)" > MANIFEST.md; printf 'baseline: CLAUDE 054\nbaseline: CODEX 064\n' >> MANIFEST.md
mkdir -p archive; : > archive/LEGACY.md
echo 'body' | ./post.sh codex 'with refs' --re "CLAUDE-055, CLAUDE-012" >/dev/null; ./render.sh >/dev/null
grep -q '\[CLAUDE-055\](messages/CLAUDE-055.md)' BOARD_VIEW.md && ok "existing Re: ID rendered as link" || bad "Re: link missing"
grep -q 'CLAUDE-012 (legacy, see archive)' BOARD_VIEW.md && ok "legacy Re: ID marked, not linked" || bad "legacy Re: handling wrong"
grep -q '(107 messages' BOARD_VIEW.md && grep -q '\[LEGACY.md\](archive/LEGACY.md)' BOARD_VIEW.md && ok "view header uses manifest count and clickable archive link" || bad "view header count/link wrong"

# 9. concurrent publishers get distinct complete messages
( echo a | ./post.sh codex 'c1' >/dev/null ) & ( echo b | ./post.sh codex 'c2' >/dev/null ) & wait
n=$(ls messages/CODEX-*.md | wc -l | tr -d ' '); [ "$n" = 4 ] && ok "two concurrent posts produced two distinct files" || bad "concurrent posts: $n codex files"
for f in messages/CODEX-*.md; do tail -c 1 "$f" | od -c | grep -q '\\n' || bad "$f incomplete"; done

rm -rf "$T"
[ "$fail" = 0 ] && { echo "ALL FIXTURES PASSED"; exit 0; } || { echo "FIXTURE FAILURES"; exit 1; }
