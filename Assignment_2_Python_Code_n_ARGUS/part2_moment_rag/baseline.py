"""Baseline fixed-size chunk RAG. See DESIGN.md.

CLI:
    python baseline.py build
    python baseline.py ask "question"
"""
import sys

import common

COLLECTION = "baseline_chunks"
CHUNK_WORDS = 120
OVERLAP_WORDS = 30
STRIDE = CHUNK_WORDS - OVERLAP_WORDS


def _make_chunks(sents):
    words, word_sent = [], []
    for s in sents:
        for w in s["text"].split():
            words.append(w)
            word_sent.append(s["i"])

    chunks = []
    n = len(words)
    i = 0
    idx = 0
    while i < n:
        j = min(i + CHUNK_WORDS, n)
        chunk_words = words[i:j]
        start_sent = sents[word_sent[i]]
        end_sent = sents[word_sent[j - 1]]
        chunks.append({
            "idx": idx,
            "start": start_sent["start"],
            "end": end_sent["end"],
            "text": " ".join(chunk_words),
        })
        idx += 1
        if j == n:
            break
        i += STRIDE
    return chunks


def build():
    transcript = common.load_transcript()
    sents = common.sentences(transcript)
    chunks = _make_chunks(sents)

    embeddings = common.embed([c["text"] for c in chunks])
    client = common.chroma()
    try:
        client.delete_collection(COLLECTION)
    except Exception:
        pass
    coll = client.create_collection(COLLECTION)
    coll.add(
        ids=[str(c["idx"]) for c in chunks],
        documents=[c["text"] for c in chunks],
        embeddings=embeddings.tolist(),
        metadatas=[{"start": c["start"], "end": c["end"], "idx": c["idx"]} for c in chunks],
    )
    print(f"built {len(chunks)} chunks -> collection '{COLLECTION}'")
    return chunks


def retrieve(q: str, k: int = 5) -> list[dict]:
    client = common.chroma()
    coll = client.get_collection(COLLECTION)
    qvec = common.embed([q])[0].tolist()
    res = coll.query(query_embeddings=[qvec], n_results=k)
    out = []
    for doc, meta, dist in zip(res["documents"][0], res["metadatas"][0], res["distances"][0]):
        out.append({
            "idx": meta["idx"], "start": meta["start"], "end": meta["end"],
            "text": doc, "distance": dist,
        })
    return out


def answer(q: str, k: int = 5) -> dict:
    retrieved = retrieve(q, k)
    ordered = sorted(retrieved, key=lambda r: r["start"])
    context = "\n\n".join(
        f"[{n}] ({common.mmss(r['start'])}–{common.mmss(r['end'])}) {r['text']}"
        for n, r in enumerate(ordered, start=1)
    )
    system = (
        "You answer questions about Adm. William McRaven's UT Austin commencement address "
        "using ONLY the numbered transcript excerpts below. Cite the excerpt number(s) you "
        "used like [2], and include their timestamps in your answer. If the excerpts do not "
        "contain the answer, say so plainly -- do not use outside knowledge.\n\n" + context
    )
    result = common.claude(system, q, common.ANSWER_MODEL, max_tokens=800)
    return {
        "answer": result["text"],
        "retrieved": ordered,
        "input_tokens": result["input_tokens"],
        "output_tokens": result["output_tokens"],
        "seconds": result["seconds"],
    }


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "build":
        build()
    elif cmd == "ask":
        q = sys.argv[2]
        r = answer(q)
        print(r["answer"])
        print()
        for c in r["retrieved"]:
            print(f"  [{c['idx']}] {common.mmss(c['start'])}–{common.mmss(c['end'])}  dist={c['distance']:.2f}")
        print(f"\ninput_tokens={r['input_tokens']} output_tokens={r['output_tokens']} seconds={round(r['seconds'])}")
    else:
        print("usage: python baseline.py [build|ask \"question\"]")
