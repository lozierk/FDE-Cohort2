#!/usr/bin/env python3
"""Ask the gold questions in docs mode and score recall@5 exactly the way bench.mjs does.

Usage, from Claude_Build/:
    python3 backend/agent/bin/recall.py spc_xxxx            # all 39
    python3 backend/agent/bin/recall.py spc_xxxx 30         # the bench's first 30
    python3 backend/agent/bin/recall.py spc_xxxx --id g07   # one question, verbosely

The scoring is a deliberate port of `benchmark/bench.mjs` runRag() and
`benchmark/lib.mjs` snippetIsGrounded(), so a number here means the same thing the graded
number means. It is a port and not an import because the bench is read-only and its phase 2
uploads its own corpus into its own Space; this asks an existing Space so chunking can be
tuned without re-ingesting four documents each time.

A hit is: among the FIRST FIVE `kind: "doc"` entries of the `sources` event, one whose title
stem matches the gold `doc` filename AND (for a PDF item) `locator.page == item.page`, or
(for a Markdown item) the gold `anchor` found as a run of >= 6 normalized tokens inside
`source.snippet`.

Misses print their top-5 locators, because "recall is 0.72" is a score and
"g11 missed, we retrieved p.2 and p.4 of the right document" is a thing you can fix.
"""
import json
import os
import re
import subprocess
import sys
import time

GATEWAY = os.environ.get("LUMINA_GATEWAY", "http://localhost:8787")
USER = os.environ.get("LUMINA_USER", "kurt-test")
GOLD = os.path.join(os.path.dirname(__file__), "..", "..", "..", "eval", "gold", "rag_gold.jsonl")


# ---------------------------------------------------------------- the bench's own comparisons


def normalize(s):
    """benchmark/lib.mjs normalize(): lowercase, smart quotes folded, non-alphanumerics to spaces."""
    s = str(s or "").lower()
    for ch in "‘’“”":
        s = s.replace(ch, "'")
    return re.sub(r"[^a-z0-9']+", " ", s).strip()


def snippet_is_grounded(snippet, haystack, min_tokens=12):
    """benchmark/lib.mjs snippetIsGrounded(): a run of min_tokens consecutive tokens must match."""
    need = [t for t in normalize(snippet).split(" ") if t]
    hay = normalize(haystack)
    if not need or not hay:
        return False
    if len(need) <= min_tokens:
        return " ".join(need) in hay
    for i in range(0, len(need) - min_tokens + 1):
        if " ".join(need[i:i + min_tokens]) in hay:
            return True
    return False


def stem(v):
    """bench.mjs's loose title comparison: strip the extension and every non-alphanumeric."""
    s = re.sub(r"\.(pdf|md|txt)$", "", str(v or "").lower())
    return re.sub(r"[^a-z0-9]", "", s)


# ---------------------------------------------------------------- http


def post_json(path, body):
    """POST and parse JSON. On the gateway's per-user 429 (30/min by default), wait for the
    window to reset and retry once, so a long gold run is slowed rather than aborted."""
    for attempt in range(2):
        out = subprocess.run(
            ["curl", "-s", "-X", "POST", f"{GATEWAY}{path}",
             "-H", "content-type: application/json", "-H", f"X-User-Id: {USER}",
             "-d", json.dumps(body)],
            capture_output=True, text=True, check=True,
        )
        data = json.loads(out.stdout)
        if data.get("status") == 429 and attempt == 0:
            wait = 61.0
            if data.get("resetsAt"):
                from datetime import datetime, timezone
                reset = datetime.fromisoformat(data["resetsAt"].replace("Z", "+00:00"))
                wait = max(1.0, (reset - datetime.now(timezone.utc)).total_seconds() + 0.5)
            print(f"  (rate limited on {path}; waiting {wait:.0f}s)", file=sys.stderr)
            time.sleep(wait)
            continue
        return data
    return data


def get_json(path):
    out = subprocess.run(
        ["curl", "-s", f"{GATEWAY}{path}", "-H", f"X-User-Id: {USER}"],
        capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def ask(question, space_id):
    """One ask, read as SSE, returning what the bench reads: trace, sources, text, done."""
    thread = post_json("/threads", {"title": question[:40]})["threadId"]
    started = time.time()
    proc = subprocess.Popen(
        ["curl", "-sN", "-X", "POST", f"{GATEWAY}/threads/{thread}/ask",
         "-H", "content-type: application/json", "-H", f"X-User-Id: {USER}",
         "-d", json.dumps({"query": question, "mode": "docs", "depth": "quick", "spaceId": space_id})],
        stdout=subprocess.PIPE, text=True,
    )
    out = {"trace": [], "sources": [], "text": "", "done": None, "error": None, "ttft": None}
    event = None
    for line in proc.stdout:
        line = line.rstrip("\n")
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            try:
                data = json.loads(line[5:].strip())
            except Exception:
                continue
            if event == "trace":
                out["trace"].append(data)
            elif event == "sources":
                out["sources"] = data
            elif event == "token":
                if out["ttft"] is None:
                    out["ttft"] = time.time() - started
                out["text"] += data.get("text", "")
            elif event == "done":
                out["done"] = data
            elif event == "error":
                out["error"] = data
    proc.wait()
    out["latency"] = time.time() - started
    return out


# ---------------------------------------------------------------- scoring


def locator_str(source):
    loc = source.get("locator") or {}
    if loc.get("page") is not None:
        return f"p.{loc['page']}"
    if loc.get("heading") is not None:
        return f"§{loc['heading'][:28]}"
    if loc.get("line") is not None:
        return f"l.{loc['line']}"
    return "no-locator"


def main(argv):
    if not argv:
        print(__doc__)
        return 2

    space_id = argv[0]
    limit = None
    only = None
    rest = argv[1:]
    i = 0
    while i < len(rest):
        if rest[i] == "--id":
            only = rest[i + 1]
            i += 2
            continue
        limit = int(rest[i])
        i += 1

    with open(os.path.normpath(GOLD)) as fh:
        gold = [json.loads(line) for line in fh if line.strip()]
    if only:
        gold = [g for g in gold if g["id"] == only]
    elif limit:
        gold = gold[:limit]

    titles = {d["docId"]: d["title"] for d in get_json(f"/spaces/{space_id}/documents")["documents"]}
    print(f"space {space_id}: {len(titles)} document(s), {len(gold)} gold question(s), mode=docs\n")

    hits = 0
    misses = []
    ttfts = []
    costs = []
    dangling_total = 0

    for item in gold:
        a = ask(item["question"], space_id)
        if a["error"]:
            print(f"  ! {item['id']} error: {a['error']}")
            misses.append((item, a))
            continue

        top5 = [s for s in a["sources"] if s.get("kind") == "doc"][:5]
        want = stem(item["doc"])

        def is_hit(s):
            candidates = [c for c in (stem(s.get("title")), stem(titles.get(s.get("docId")))) if c]
            if want and not any(want in c or c in want for c in candidates):
                return False
            if item.get("page"):
                return (s.get("locator") or {}).get("page") == item["page"]
            if item.get("anchor"):
                return snippet_is_grounded(item["anchor"], s.get("snippet"), 6)
            return True

        hit = any(is_hit(s) for s in top5)
        hits += 1 if hit else 0
        if a["ttft"]:
            ttfts.append(a["ttft"])
        if a["done"]:
            costs.append(a["done"].get("costUsd") or 0)

        # Every [n] in the text must resolve to a source in this answer. A dangling citation is
        # an automatic fail in the graded run, so it is counted here too.
        cited = {int(x) for x in re.findall(r"\[(\d+)\]", a["text"])}
        have = {s["n"] for s in a["sources"]}
        dangling = sorted(cited - have)
        dangling_total += len(dangling)

        mark = "ok  " if hit else "MISS"
        where = " ".join(f"{titles.get(s.get('docId'), '?')[:16]}:{locator_str(s)}" for s in top5)
        print(f"  {mark} {item['id']}  want {item['doc']}"
              + (f" p.{item['page']}" if item.get("page") else f" anchor {item['anchor'][:30]!r}")
              + f"\n         got {where or '(no doc sources)'}"
              + (f"   DANGLING {dangling}" if dangling else ""))
        if not hit:
            misses.append((item, a))

    asked = len(gold)
    recall = hits / asked if asked else 0
    print(f"\nrecall@5 {hits}/{asked} = {recall:.3f}  (SLA min 0.70, local target 0.80)")
    if ttfts:
        ttfts.sort()
        p95 = ttfts[min(len(ttfts) - 1, max(0, -(-95 * len(ttfts) // 100) - 1))]
        print(f"ttft p95 {p95:.2f}s (SLA 2.5s) · mean cost ${sum(costs)/max(1,len(costs)):.5f} (SLA 0.05)")
    if dangling_total:
        print(f"!! {dangling_total} dangling citation(s) — every [n] must resolve to a source")

    if misses:
        print(f"\n{len(misses)} miss(es) in detail, so chunking can be tuned against them:")
        for item, a in misses:
            print(f"\n  {item['id']}: {item['question']}")
            print(f"    want: {item['doc']}"
                  + (f" page {item['page']}" if item.get("page") else "")
                  + (f" anchor {item['anchor']!r}" if item.get("anchor") else ""))
            for s in [s for s in a["sources"] if s.get("kind") == "doc"][:5]:
                print(f"    [{s['n']}] {titles.get(s.get('docId'), '?')} {locator_str(s)}"
                      f"  {normalize(s.get('snippet'))[:110]}…")

    return 0 if recall >= 0.70 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
