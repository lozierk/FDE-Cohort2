"""Moment RAG query path: RRF over two moment collections, multi-moment answer.

CLI:
    python moment_rag.py ask "question" [--rrf-ratio R]

Query path = one embedding, two Chroma lookups, one Sonnet call. All moment
work (drift, labelling, summary embedding) happened at ingestion (moments.py).

`preview=True` swaps in a text-only index of the unlabelled Stage 1 candidates
(collection `candidate_text`, no LLM). It exists only so run_eval.py --offline
can compare retrieval before the API key is available; it is not the pipeline.
"""
import sys

import common
import moments as M

RRF_K = 60
TOP_N = 10
# Adaptive k: keep moment 1 always, then moments 2..k only while their fused
# RRF score >= MOMENT_RRF_RATIO * top score. 0.0 = fixed k (v2 behaviour).
# Chosen by the offline sweep in run_eval.py --sweep (same 12 questions, no held-out set).
MOMENT_RRF_RATIO = 0.97
PREVIEW_COLL = "candidate_text"

_units = {}  # (preview) -> {moment_id: moment dict}


def _load_units(preview: bool) -> dict:
    if preview not in _units:
        if preview:
            sents, cands = M.stage1()
            units = [{"moment_id": c["c"], "start": c["start"], "end": c["end"],
                      "title": f"Candidate {c['c']}", "text": c["text"],
                      "sentence_start": c["s0"], "sentence_end": c["s1"]} for c in cands]
            M.index(units, summary_coll=None, text_coll=PREVIEW_COLL)
        else:
            units = M.load_moments()
        _units[preview] = {u["moment_id"]: u for u in units}
    return _units[preview]


def retrieve(q: str, k: int = 3, preview: bool = False, ratio: float | None = None) -> list[dict]:
    """Top-k distinct moments by RRF over both collections, cut adaptively:
    moment 1 always, moments 2..k only while score >= ratio * top score."""
    ratio = MOMENT_RRF_RATIO if ratio is None else ratio
    units = _load_units(preview)
    client = common.chroma()
    names = [PREVIEW_COLL] if preview else [M.SUMMARY_COLL, M.TEXT_COLL]
    qvec = common.embed([q])[0].tolist()
    scores = {}
    for name in names:
        coll = client.get_collection(name)
        res = coll.query(query_embeddings=[qvec], n_results=min(TOP_N, coll.count()))
        for rank, meta in enumerate(res["metadatas"][0], start=1):
            mid = meta["moment_id"]
            scores[mid] = scores.get(mid, 0.0) + 1.0 / (RRF_K + rank)
    ranked = sorted(scores, key=scores.get, reverse=True)[:k]
    top = [mid for n, mid in enumerate(ranked) if n == 0 or scores[mid] >= ratio * scores[ranked[0]]]
    return [{"moment_id": mid, "start": units[mid]["start"], "end": units[mid]["end"],
             "title": units[mid]["title"], "score": round(scores[mid], 5),
             "text": units[mid]["text"]} for mid in top]


def answer(q: str, k: int = 3, ratio: float | None = None) -> dict:
    retrieved = retrieve(q, k, ratio=ratio)
    ordered = sorted(retrieved, key=lambda r: r["start"])
    context = "\n\n".join(
        f"[{n}] {r['title']} ({common.mmss(r['start'])}–{common.mmss(r['end'])})\n{r['text']}"
        for n, r in enumerate(ordered, start=1)
    )
    # same answer rules as baseline.answer
    system = (
        "You answer questions about Adm. William McRaven's UT Austin commencement address "
        "using ONLY the numbered transcript excerpts below. Cite the excerpt number(s) you "
        "used like [2], and include their timestamps in your answer. If the excerpts do not "
        "contain the answer, say so plainly -- do not use outside knowledge.\n\n" + context
    )
    result = common.claude(system, q, common.ANSWER_MODEL, max_tokens=800)
    return {
        "answer": result["text"],
        "retrieved": [{k_: r[k_] for k_ in ("moment_id", "start", "end", "title", "score")}
                      for r in ordered],
        "input_tokens": result["input_tokens"],
        "output_tokens": result["output_tokens"],
        "seconds": result["seconds"],
        "usd": result["usd"],
    }


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "ask":
        # optional: --rrf-ratio R overrides MOMENT_RRF_RATIO for this call
        ratio = float(sys.argv[sys.argv.index("--rrf-ratio") + 1]) if "--rrf-ratio" in sys.argv else None
        r = answer(sys.argv[2], ratio=ratio)
        print(r["answer"])
        print()
        for m in r["retrieved"]:
            print(f"  [{m['moment_id']}] {common.mmss(m['start'])}–{common.mmss(m['end'])}  "
                  f"rrf={m['score']:.4f}  {m['title']}")
        print(f"\ninput_tokens={r['input_tokens']} output_tokens={r['output_tokens']} "
              f"seconds={round(r['seconds'])} usd={r['usd']:.4f}")
    else:
        print('usage: python moment_rag.py ask "question"')
