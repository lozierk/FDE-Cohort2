#!/usr/bin/env python3
"""Create a Space, upload files, wait for `indexed`, print the two graded timings.

Usage, from Claude_Build/:
    python3 backend/agent/bin/upload.py eval/gold/corpus/*.pdf eval/gold/corpus/*.md
    python3 backend/agent/bin/upload.py --space spc_existing file.pdf

Prints, per file, the `202` accept latency and the time from the 202 to `status: indexed`,
which are exactly the two numbers benchmark/bench.mjs measures in phase 2 (accept_202_p95_ms
≤ 300, indexedViaWorker within 240 s). Everything goes through the gateway on :8787, because
the browser never reaches the agent directly and neither should a check of it.
"""
import json
import mimetypes
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

GATEWAY = os.environ.get("LUMINA_GATEWAY", "http://localhost:8787")
USER = os.environ.get("LUMINA_USER", "kurt-test")
MIME = {".pdf": "application/pdf", ".md": "text/markdown", ".txt": "text/plain"}
POLL_SEC = 1.2          # the bench's own poll interval
TIMEOUT_SEC = 240       # the bench's own ceiling


def call(method, path, body=None, headers=None):
    data = None
    hdrs = {"X-User-Id": USER}
    if body is not None:
        data = json.dumps(body).encode()
        hdrs["content-type"] = "application/json"
    hdrs.update(headers or {})
    req = urllib.request.Request(f"{GATEWAY}{path}", data=data, headers=hdrs, method=method)
    with urllib.request.urlopen(req) as res:
        raw = res.read()
        return res.status, (json.loads(raw) if raw else None)


def multipart(path):
    """One file part named `file` — the field name the bench sends."""
    name = os.path.basename(path)
    ext = os.path.splitext(name)[1].lower()
    ctype = MIME.get(ext) or mimetypes.guess_type(name)[0] or "application/octet-stream"
    boundary = f"----lumina{uuid.uuid4().hex}"
    with open(path, "rb") as fh:
        payload = fh.read()
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n'.encode(),
        f"Content-Type: {ctype}\r\n\r\n".encode(),
        payload,
        f"\r\n--{boundary}--\r\n".encode(),
    ])
    return body, f"multipart/form-data; boundary={boundary}", len(payload)


def main(argv):
    space_id = None
    files = []
    i = 0
    while i < len(argv):
        if argv[i] == "--space":
            space_id = argv[i + 1]
            i += 2
            continue
        files.append(argv[i])
        i += 1

    if not files:
        print(__doc__)
        return 2

    if space_id is None:
        status, body = call("POST", "/spaces", {"name": f"local-{int(time.time())}"})
        space_id = body["spaceId"]
        print(f"space {space_id} (POST /spaces -> {status})")
    else:
        print(f"space {space_id} (reused)")

    uploads = []
    for path in files:
        body, ctype, size = multipart(path)
        req = urllib.request.Request(
            f"{GATEWAY}/spaces/{space_id}/documents",
            data=body,
            headers={"X-User-Id": USER, "content-type": ctype},
            method="POST",
        )
        t0 = time.time()
        try:
            with urllib.request.urlopen(req) as res:
                status = res.status
                accepted = json.loads(res.read())
        except urllib.error.HTTPError as err:
            print(f"  x {os.path.basename(path)} -> {err.code} {err.read()[:200]!r}")
            continue
        accept_ms = (time.time() - t0) * 1000
        # The 202 is the whole point: it says the bytes are safe, not that they are searchable.
        print(
            f"  + {os.path.basename(path):<34} {status} in {accept_ms:6.1f} ms  "
            f"({size/1024:.1f} KB) -> {accepted['docId']} {accepted['status']}"
        )
        uploads.append({"file": os.path.basename(path), "docId": accepted["docId"],
                        "accept_ms": accept_ms, "t0": t0})

    if not uploads:
        return 1

    print(f"\nwaiting for the worker (poll {POLL_SEC}s, ceiling {TIMEOUT_SEC}s)")
    pending = {u["docId"]: u for u in uploads}
    deadline = time.time() + TIMEOUT_SEC
    while pending and time.time() < deadline:
        _, body = call("GET", f"/spaces/{space_id}/documents")
        for row in body["documents"]:
            u = pending.get(row["docId"])
            if u is None:
                continue
            if row["status"] == "indexed":
                u["indexed_sec"] = time.time() - u["t0"]
                u["chunks"] = row.get("chunks")
                u["pages"] = row.get("pages")
                print(
                    f"  = {u['file']:<34} indexed in {u['indexed_sec']:6.1f} s  "
                    f"chunks {row.get('chunks')}" + (f"  pages {row['pages']}" if row.get("pages") else "")
                )
                del pending[u["docId"]]
            elif row["status"] == "failed":
                # Fail loud, with the reason the worker recorded. This is the line that would
                # be missing if the worker swallowed its exceptions.
                print(f"  ! {u['file']:<34} FAILED: {row.get('error')}")
                del pending[u["docId"]]
        if pending:
            time.sleep(POLL_SEC)

    for u in pending.values():
        print(f"  ! {u['file']:<34} still not indexed after {TIMEOUT_SEC}s")

    done = [u for u in uploads if "indexed_sec" in u]
    if done:
        accepts = sorted(u["accept_ms"] for u in uploads)
        print(
            f"\n{len(done)}/{len(uploads)} indexed · "
            f"202 max {accepts[-1]:.1f} ms (SLA p95 300) · "
            f"slowest to indexed {max(u['indexed_sec'] for u in done):.1f} s"
        )
    print(f"\nspaceId: {space_id}")
    return 0 if len(done) == len(uploads) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
