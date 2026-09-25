"""Moment detection + labelling + indexing. See DESIGN.md "Moment RAG".

Stage 1  embedding-drift candidate boundaries (no LLM)     -> data/drift.json
Stage 2  one Haiku pass: move boundaries <=3 sentences, split, merge sparingly,
         title + summarise                             -> data/moments.json
Stage 3  index into Chroma `moment_summaries` + `moment_text`

CLI:
    python moments.py candidates   # Stage 1 only, offline
    python moments.py build        # all stages (needs ANTHROPIC_API_KEY)
"""
import json
import re
import sys
from pathlib import Path

import numpy as np

import common

HERE = Path(__file__).parent
DRIFT_PATH = HERE / "data" / "drift.json"
MOMENTS_PATH = HERE / "data" / "moments.json"
LESSONS_PATH = HERE / "data" / "lessons.json"

WINDOW = 3            # sentences per window, stride 1
MIN_SEG = 6           # minimum sentences per segment
DEPTH_STD_K = 0.5     # threshold = mean + K * std of depth scores
TARGET = (8, 16)      # target candidate count (reported, not forced)
SUBWIN_WORDS = 120    # sub-window size for long-moment text embeddings
LONG_WORDS = 256

SUMMARY_COLL = "moment_summaries"
TEXT_COLL = "moment_text"


# ---------------------------------------------------------------- Stage 1
def _depth_scores(sims: np.ndarray) -> np.ndarray:
    """TextTiling depth: from each gap climb left and right while similarity
    rises; depth = (left_peak - s) + (right_peak - s)."""
    n = len(sims)
    depth = np.zeros(n)
    for g in range(n):
        lp = sims[g]
        i = g
        while i - 1 >= 0 and sims[i - 1] >= lp:
            i -= 1
            lp = sims[i]
        rp = sims[g]
        j = g
        while j + 1 < n and sims[j + 1] >= rp:
            j += 1
            rp = sims[j]
        depth[g] = (lp - sims[g]) + (rp - sims[g])
    return depth


def detect_candidates(sents: list[dict]) -> tuple[list[dict], dict]:
    """Return candidate segments [{"c","s0","s1","start","end","text"}] and the
    drift record saved to data/drift.json.

    Gap g compares window g (sentences g..g+2) with window g+1 (g+1..g+3). A
    boundary at gap g starts the new segment at sentence g+2, the midpoint of
    the four sentences the two windows span."""
    windows = [" ".join(s["text"] for s in sents[i:i + WINDOW])
               for i in range(len(sents) - WINDOW + 1)]
    vecs = common.embed(windows)
    sims = np.sum(vecs[:-1] * vecs[1:], axis=1)  # normalized -> cosine
    depth = _depth_scores(sims)
    threshold = float(depth.mean() + DEPTH_STD_K * depth.std())

    # keep gaps above threshold that are also local similarity minima
    raw = []
    for g in range(len(sims)):
        left = sims[g - 1] if g > 0 else np.inf
        right = sims[g + 1] if g + 1 < len(sims) else np.inf
        if depth[g] > threshold and sims[g] <= left and sims[g] <= right:
            raw.append(g)
    gap_of = {g + 2: g for g in raw}          # boundary sentence -> gap index
    bounds = sorted(gap_of)                   # sentence indices that start a segment

    # enforce minimum segment length: drop the weaker (higher-similarity)
    # boundary of any short segment, i.e. merge it into that neighbour
    def segs(bs):
        edges = [0] + bs + [len(sents)]
        return list(zip(edges[:-1], edges[1:]))

    while True:
        short = [(a, b) for a, b in segs(bounds) if b - a < MIN_SEG]
        if not short:
            break
        a, b = short[0]
        options = [x for x in (a, b) if x in gap_of]  # 0 and len(sents) are not removable
        drop = max(options, key=lambda x: sims[gap_of[x]])
        bounds.remove(drop)

    candidates = []
    for c, (a, b) in enumerate(segs(bounds)):
        chunk = sents[a:b]
        candidates.append({
            "c": c, "s0": a, "s1": b - 1,
            "start": chunk[0]["start"], "end": chunk[-1]["end"],
            "text": " ".join(s["text"] for s in chunk),
        })

    final_gaps = {gap_of[b] for b in bounds}
    drift = {
        "window": WINDOW, "min_segment": MIN_SEG,
        "threshold": round(threshold, 4),
        "threshold_rule": f"depth > mean + {DEPTH_STD_K}*std",
        "gap_to_boundary_sentence": "gap g -> new segment starts at sentence g+2",
        "sentences": [{"i": s["i"], "start": s["start"], "end": s["end"]} for s in sents],
        "gaps": [{
            "g": g,
            "boundary_sentence": g + 2,
            "t": sents[g + 2]["start"],
            "similarity": round(float(sims[g]), 4),
            "depth": round(float(depth[g]), 4),
            "above_threshold": bool(g in raw),
            "boundary": bool(g in final_gaps),
        } for g in range(len(sims))],
        "candidate_count": len(candidates),
    }
    return candidates, drift


def print_candidates(cands):
    print(f"{'c':>2}  {'range':>11}  {'sents':>7}  {'words':>5}  first words")
    for c in cands:
        rng = f"{common.mmss(c['start'])}-{common.mmss(c['end'])}"
        first = " ".join(c["text"].split()[:9])
        print(f"{c['c']:>2}  {rng:>11}  {c['s0']:>3}-{c['s1']:<3}  "
              f"{len(c['text'].split()):>5}  {first}...")
    n = len(cands)
    ok = TARGET[0] <= n <= TARGET[1]
    print(f"\n{n} candidates (target {TARGET[0]}-{TARGET[1]}: {'OK' if ok else 'OUTSIDE TARGET'})")


def stage1():
    sents = common.sentences(common.load_transcript())
    cands, drift = detect_candidates(sents)
    DRIFT_PATH.write_text(json.dumps(drift, indent=1))
    return sents, cands


# ---------------------------------------------------------------- Stage 2
# v2 ("v2-llm-bounded"): Haiku sees every sentence with its index and may move
# a candidate boundary by <= MAX_SHIFT sentences, split a candidate, or merge
# sparingly. The prompt carries no ground-truth hints. The v1 prompt (merge-only)
# and its results are preserved in reports/v1_drift_only/.
VERSION = "v2-llm-bounded"
MAX_SHIFT = 3
MIN_MOMENT = 4
FAILED_PATH = HERE / "data" / "stage2_failed.json"

LABEL_SYSTEM = """You segment a talk transcript into self-contained moments. A moment holds one story or idea together with the point the speaker draws from it, so a listener could jump to it and understand it on its own.

You receive the transcript as numbered sentences, grouped into candidate segments that an automatic topic-shift detector proposed. The detector is approximate: its boundaries are often a few sentences early or late, it sometimes misses a change of topic, and it sometimes cuts one story in two.

Refine the candidates into moments. You may:
1. MOVE a candidate boundary by at most 3 sentences earlier or later, so that a story and the point drawn from it stay together.
2. SPLIT a candidate at a sentence index when it contains two distinct stories or topics.
3. MERGE adjacent candidates, sparingly, only when they continue the same story. A different story (a different event, place, or activity) is a different moment even when the theme is similar; never merge just because two segments share the talk's overall theme.

Constraints:
- Moments are contiguous and in order, and together cover every sentence from 0 to {last} exactly once.
- Each moment is at least 4 sentences long.
- Every moment start (except the first, which is 0) is either within 3 sentences of a candidate boundary (a kept or moved boundary; at most one moment start per candidate boundary) or a split at least 4 sentences away from every candidate boundary.

For each moment return:
{{"title": "<3-8 words naming the concrete topic>", "summary": "<2-3 sentences: what happens and the point the speaker makes>", "start_sentence": <int>, "end_sentence": <int>}}
Return ONLY a JSON array of moments in time order, no prose, no code fences."""


def _validate(text: str, cands: list[dict], n_sents: int) -> tuple[list[dict], list[str]]:
    """Parse + validate the moment list; return (moments, boundary_types).
    Raises ValueError with a message fit to show the model on retry."""
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    data = json.loads(t)
    if not isinstance(data, list) or not data:
        raise ValueError("reply must be a non-empty JSON array of moments")
    for k, d in enumerate(data):
        for key, typ in (("title", str), ("summary", str), ("start_sentence", int), ("end_sentence", int)):
            if not isinstance(d.get(key), typ):
                raise ValueError(f"moment {k}: bad or missing '{key}'")
    expect = 0
    for k, d in enumerate(data):
        if d["start_sentence"] != expect:
            raise ValueError(f"moment {k} starts at sentence {d['start_sentence']} but must start at "
                             f"{expect} (moments must be contiguous and cover every sentence once)")
        size = d["end_sentence"] - d["start_sentence"] + 1
        if size < MIN_MOMENT:
            raise ValueError(f"moment {k} (sentences {d['start_sentence']}-{d['end_sentence']}) has "
                             f"{size} sentences; minimum is {MIN_MOMENT}")
        expect = d["end_sentence"] + 1
    if expect != n_sents:
        raise ValueError(f"moments end at sentence {expect - 1} but must end at {n_sents - 1}")

    cand_bounds = [c["s0"] for c in cands[1:]]
    used, types = set(), ["start"]
    for d in data[1:]:
        b = d["start_sentence"]
        near = [cb for cb in cand_bounds if abs(b - cb) <= MAX_SHIFT]
        if not near:
            types.append("split")
            continue
        cb = min(near, key=lambda x: abs(b - x))
        if cb in used:
            raise ValueError(f"two moment starts map to candidate boundary {cb}; a split must be at "
                             f"least {MAX_SHIFT + 1} sentences from every candidate boundary")
        used.add(cb)
        types.append("kept" if b == cb else f"moved {b - cb:+d}")
    return data, types


def label(cands: list[dict], sents: list[dict]) -> tuple[list[dict], dict]:
    system = LABEL_SYSTEM.format(last=len(sents) - 1)
    user = "\n\n".join(
        f"### candidate {c['c']} | sentences {c['s0']}-{c['s1']} | "
        f"{common.mmss(c['start'])}-{common.mmss(c['end'])}\n"
        + "\n".join(f"[{s['i']}] {s['text']}" for s in sents[c["s0"]:c["s1"] + 1])
        for c in cands
    )
    user += ("\n\nCandidate boundaries (sentence index where a candidate starts): "
             + ", ".join(str(c["s0"]) for c in cands[1:]))
    calls, raw, errors = [], [], []
    data = types = None
    for attempt in range(2):  # validate, retry once, then fail loudly
        prompt = user if attempt == 0 else (
            user + f"\n\nYour previous reply was invalid: {errors[-1]}\n"
            "Fix it and return the full JSON array again.")
        r = common.claude(system, prompt, common.CHEAP_MODEL, max_tokens=4000)
        calls.append(r)
        raw.append(r["text"])
        try:
            data, types = _validate(r["text"], cands, len(sents))
            break
        except (ValueError, json.JSONDecodeError) as e:
            errors.append(str(e)[:300])
            print(f"Stage 2 attempt {attempt + 1} invalid: {errors[-1]}")
    if data is None:
        FAILED_PATH.write_text(json.dumps({"errors": errors, "outputs": raw}, indent=1))
        raise SystemExit(f"Stage 2 failed validation twice: {errors}. Raw outputs in {FAILED_PATH}")

    moments = []
    for m, (d, bt) in enumerate(zip(data, types)):
        s0, s1 = d["start_sentence"], d["end_sentence"]
        moments.append({
            "moment_id": m,
            "start": sents[s0]["start"], "end": sents[s1]["end"],
            "title": d["title"], "summary": d["summary"],
            "sentence_start": s0, "sentence_end": s1,
            "boundary": bt,
            "candidates": [c["c"] for c in cands if c["s0"] <= s1 and c["s1"] >= s0],
            "text": " ".join(s["text"] for s in sents[s0:s1 + 1]),
        })
    cost = {
        "model": common.CHEAP_MODEL,
        "attempts": len(calls),
        "errors": errors,
        "input_tokens": sum(c["input_tokens"] for c in calls),
        "output_tokens": sum(c["output_tokens"] for c in calls),
        "seconds": round(sum(c["seconds"] for c in calls), 2),
        "usd": sum(c["usd"] for c in calls),
    }
    return moments, cost


# ---------------------------------------------------------------- Stage 3
def text_embedding(text: str) -> np.ndarray:
    words = text.split()
    if len(words) <= LONG_WORDS:
        return common.embed([text])[0]
    subs = [" ".join(words[i:i + SUBWIN_WORDS]) for i in range(0, len(words), SUBWIN_WORDS)]
    v = common.embed(subs).mean(axis=0)
    return v / np.linalg.norm(v)


def index(moments: list[dict], summary_coll=SUMMARY_COLL, text_coll=TEXT_COLL):
    client = common.chroma()
    for name in (summary_coll, text_coll):
        try:
            client.delete_collection(name)
        except Exception:
            pass
    ids = [str(m["moment_id"]) for m in moments]
    metas = [{"moment_id": m["moment_id"], "start": m["start"], "end": m["end"],
              "title": m["title"]} for m in moments]
    if summary_coll:
        docs = [f"{m['title']}. {m['summary']}" for m in moments]
        client.create_collection(summary_coll).add(
            ids=ids, documents=docs, embeddings=common.embed(docs).tolist(), metadatas=metas)
    tvecs = np.stack([text_embedding(m["text"]) for m in moments])
    client.create_collection(text_coll).add(
        ids=ids, documents=[m["text"] for m in moments],
        embeddings=tvecs.tolist(), metadatas=metas)


# ---------------------------------------------------------------- reporting
def print_moments(moments):
    print(f"{'n':>2}  {'range':>11}  {'sents':>7}  {'words':>5}  {'boundary':<9}  title")
    for m in moments:
        rng = f"{common.mmss(m['start'])}-{common.mmss(m['end'])}"
        print(f"{m['moment_id']:>2}  {rng:>11}  {m['sentence_start']:>3}-{m['sentence_end']:<3}  "
              f"{len(m['text'].split()):>5}  {m.get('boundary', ''):<9}  {m['title']}")


def alignment(moments, tol=10.0) -> float:
    """Print which moment(s) overlap each lesson; return the fraction of lesson
    starts within `tol` seconds of some moment start."""
    lessons = json.loads(LESSONS_PATH.read_text())
    hits = 0
    print(f"\n{'lesson':<48}  {'start':>5}  overlapping moments   start-match")
    for l in lessons:
        over = [m["moment_id"] for m in moments
                if min(m["end"], l["end"]) - max(m["start"], l["start"]) > 0]
        nearest = min(abs(m["start"] - l["start"]) for m in moments)
        hit = nearest <= tol
        hits += hit
        name = f"{l['n']:>2}. {l['title']}"
        print(f"{name:<48}  {common.mmss(l['start']):>5}  {str(over):<20}  "
              f"{'yes' if hit else 'no'} ({nearest:.0f}s)")
    score = hits / len(lessons)
    print(f"\nboundary score: {hits}/{len(lessons)} = {score:.2f} "
          f"(lesson starts within {tol:.0f}s of a moment start)")
    return score


def build():
    sents, cands = stage1()
    print("Stage 1 candidates")
    print_candidates(cands)
    moments, cost = label(cands, sents)
    MOMENTS_PATH.write_text(json.dumps({"version": VERSION, "labelling": cost, "moments": moments}, indent=1))
    index(moments)
    print(f"\nStage 2 labelling: {cost['attempts']} call(s), {cost['input_tokens']} in / "
          f"{cost['output_tokens']} out tokens, {cost['seconds']:.0f}s, ${cost['usd']:.4f} "
          f"(${cost['usd'] / len(moments):.4f} per moment)")
    print(f"Stage 3 indexed {len(moments)} moments -> '{SUMMARY_COLL}', '{TEXT_COLL}'\n")
    print_moments(moments)
    alignment(moments)


def load_moments() -> list[dict]:
    return json.loads(MOMENTS_PATH.read_text())["moments"]


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "candidates":
        _, cands = stage1()
        print_candidates(cands)
        print(f"wrote {DRIFT_PATH.relative_to(HERE)}")
        # offline preview: how well do raw Stage 1 boundaries match the lessons?
        alignment([{"moment_id": c["c"], **c} for c in cands])
    elif cmd == "build":
        build()
    else:
        print("usage: python moments.py [build|candidates]")
