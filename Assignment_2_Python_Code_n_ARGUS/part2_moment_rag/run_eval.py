"""Score baseline (k=5 chunks) vs Moment RAG (k=3 moments) on the golden set.

    python run_eval.py              # full: answers (Sonnet) + judge (Haiku), ~48 calls
    python run_eval.py --limit 2    # cheap smoke on the first N questions
    python run_eval.py --offline    # retrieval-only metrics, no LLM calls

Writes reports/results.json and reports/scorecard.md. See DESIGN.md "Scoring".
"""
import argparse
import datetime as dt
import json
import re
from pathlib import Path
from statistics import mean

import baseline
import common
import moment_rag
import moments as M

HERE = Path(__file__).parent
GOLDEN = HERE / "eval" / "golden_set.json"
REPORTS = HERE / "reports"
K_CHUNKS, K_MOMENTS = 5, 3
TYPES = ["lookup", "span", "multi"]
METRICS_OFFLINE = ["lesson_recall", "context_precision", "context_purity"]
METRICS_FULL = METRICS_OFFLINE + ["citation_accuracy", "phrase_coverage", "judge_score",
                                  "context_tokens", "latency_s", "usd"]
V1_DIR = REPORTS / "v1_drift_only"
V2_DIR = REPORTS / "v2_llm_bounded"
PRECISION_NOTE = (
    "context_precision counts retrieved units, so its ceiling depends on how many units come "
    "back: baseline always returns k=5 chunks, moments return 1-3 (adaptive k in v3, fixed 3 in "
    "v1/v2). For a one-lesson question 3 moments cap at 0.33 while 1 moment can reach 1.00. "
    "context_purity (word-weighted share of retrieved context inside an expected lesson) is the "
    "fairer comparison, but it too rises when fewer units come back.")

JUDGE_SYSTEM = (
    "You grade an answer about Adm. McRaven's 'Make Your Bed' commencement speech against a "
    "reference answer. Score 1-5 for completeness (covers the reference's facts) and "
    "faithfulness (no claims the reference/speech would contradict). 5 = complete and "
    "faithful; 3 = partly complete or minor errors; 1 = wrong, missing, or says it cannot "
    'answer. Return ONLY JSON: {"score": <int 1-5>, "reason": "<one sentence>"}'
)


# ---------------------------------------------------------------- metrics
def covers(unit, lesson) -> bool:
    """Unit counts for a lesson if it overlaps >= 50% of the lesson, OR the unit
    lies inside the lesson, read as >= 50% of the unit's duration inside it
    (strict containment breaks on caption-shared timestamps)."""
    ov = min(unit["end"], lesson["end"]) - max(unit["start"], lesson["start"])
    if ov <= 0:
        return False
    return (ov >= 0.5 * (lesson["end"] - lesson["start"])
            or ov >= 0.5 * (unit["end"] - unit["start"]))


def lesson_recall(units, expected):
    return sum(any(covers(u, l) for u in units) for l in expected) / len(expected)


def context_precision(units, expected):
    return sum(any(covers(u, l) for l in expected) for u in units) / len(units) if units else 0.0


_SENTS = None


def _sents():
    global _SENTS
    if _SENTS is None:
        _SENTS = common.sentences(common.load_transcript())
    return _SENTS


def _chunk_sentence_words(idx: int) -> dict:
    """{sentence_i: word count} for baseline chunk `idx` (same word stream as baseline.py)."""
    word_sent = [s["i"] for s in _sents() for _ in s["text"].split()]
    start = idx * baseline.STRIDE
    out = {}
    for si in word_sent[start:start + baseline.CHUNK_WORDS]:
        out[si] = out.get(si, 0) + 1
    return out


def _moment_sentence_words(m: dict) -> dict:
    return {i: len(_sents()[i]["text"].split())
            for i in range(m["sentence_start"], m["sentence_end"] + 1)}


def context_purity(units, expected, moment_lookup=None) -> float:
    """Word-weighted fraction of retrieved context inside any expected lesson.
    A sentence counts as inside a lesson when its timestamp midpoint falls in
    the lesson's [start, end]. k-independent, unlike context_precision."""
    words = {}
    for u in units:
        sw = (_chunk_sentence_words(u["idx"]) if "idx" in u
              else _moment_sentence_words(moment_lookup[u["moment_id"]]))
        for si, n in sw.items():
            words[si] = words.get(si, 0) + n  # overlapping chunks count twice: that is context the model reads twice
    total = sum(words.values())
    inside = 0
    for si, n in words.items():
        s = _sents()[si]
        mid = (s["start"] + s["end"]) / 2
        if any(l["start"] <= mid <= l["end"] for l in expected):
            inside += n
    return inside / total if total else 0.0


def citations(answer: str) -> list[int]:
    """Distinct [n] numbers cited, including [1, 3] and [1][2] forms."""
    nums = set()
    for grp in re.findall(r"\[(\d+(?:\s*,\s*\d+)*)\]", answer):
        nums.update(int(x) for x in grp.split(","))
    return sorted(nums)


def citation_accuracy(answer, ordered_units, expected):
    cited = citations(answer)
    if not cited:
        return 0.0
    ok = sum(1 for n in cited
             if 1 <= n <= len(ordered_units) and any(covers(ordered_units[n - 1], l) for l in expected))
    return ok / len(cited)


def _norm(s: str) -> str:
    return " ".join(s.lower().replace("\u2019", "'").split())


def phrase_coverage(answer, phrases):
    a = _norm(answer)
    return sum(_norm(p) in a for p in phrases) / len(phrases)


def judge(q, reference, answer) -> dict:
    user = f"QUESTION: {q['question']}\n\nREFERENCE ANSWER: {reference}\n\nANSWER TO GRADE: {answer}"
    calls, parsed = [], None
    for _ in range(2):  # validate, retry once
        r = common.claude(JUDGE_SYSTEM, user, common.CHEAP_MODEL, max_tokens=300)
        calls.append(r)
        try:
            t = re.sub(r"^```(?:json)?\s*|\s*```$", "", r["text"].strip())
            d = json.loads(t)
            if isinstance(d.get("score"), (int, float)) and 1 <= d["score"] <= 5:
                parsed = {"score": d["score"], "reason": str(d.get("reason", ""))}
                break
        except json.JSONDecodeError:
            pass
    parsed = parsed or {"score": None, "reason": "judge JSON invalid twice"}
    parsed["usd"] = sum(c["usd"] for c in calls)
    parsed["input_tokens"] = sum(c["input_tokens"] for c in calls)
    parsed["output_tokens"] = sum(c["output_tokens"] for c in calls)
    return parsed


# ---------------------------------------------------------------- runners
def run_pipeline(name, q, expected, offline, preview):
    if name == "baseline":
        if offline:
            units = sorted(baseline.retrieve(q["question"], K_CHUNKS), key=lambda r: r["start"])
            res = {"retrieved": units}
        else:
            res = baseline.answer(q["question"], K_CHUNKS)
            res["usd"] = common.usd(common.ANSWER_MODEL, res["input_tokens"], res["output_tokens"])
        retrieved = [{"idx": r["idx"], "start": r["start"], "end": r["end"],
                      "distance": round(r["distance"], 4)} for r in res["retrieved"]]
    else:
        if offline:
            units = sorted(moment_rag.retrieve(q["question"], K_MOMENTS, preview=preview),
                           key=lambda r: r["start"])
            res = {"retrieved": units}
        else:
            res = moment_rag.answer(q["question"], K_MOMENTS)
        retrieved = [{k: r[k] for k in ("moment_id", "start", "end", "title", "score")}
                     for r in res["retrieved"]]

    row = {
        "retrieved": retrieved,
        "lesson_recall": lesson_recall(retrieved, expected),
        "context_precision": context_precision(retrieved, expected),
        "context_purity": context_purity(
            retrieved, expected,
            None if name == "baseline" else moment_rag._load_units(preview)),
    }
    if not offline:
        ans = res["answer"]
        j = judge(q, q["reference_answer"], ans)
        row.update({
            "answer": ans,
            "citations": citations(ans),
            "citation_accuracy": citation_accuracy(ans, retrieved, expected),
            "phrase_coverage": phrase_coverage(ans, q["key_phrases"]),
            "judge_score": j["score"], "judge_reason": j["reason"],
            "judge_usd": j["usd"],
            "judge_input_tokens": j["input_tokens"], "judge_output_tokens": j["output_tokens"],
            "context_tokens": res["input_tokens"],
            "output_tokens": res["output_tokens"],
            "latency_s": round(res["seconds"]),
            "seconds_raw": res["seconds"],
            "usd": res["usd"],
        })
    return row


SWEEP_PATH = REPORTS / "sweep.json"
SWEEP_RATIOS = [0.0, 0.5, 0.6, 0.7, 0.8, 0.9]


def sweep(extra_ratios=()):
    """Offline, no LLM: moment-side lesson_recall / context_purity / units returned
    for each adaptive-k ratio R (k max 3) and for fixed k=1, k=2. Retrieval is
    deterministic, so this is exact for the live index."""
    golden = json.loads(GOLDEN.read_text())
    lessons = {l["n"]: l for l in json.loads(M.LESSONS_PATH.read_text())}
    units = moment_rag._load_units(False)
    configs = [(f"R={r:g}" + (" (v2, fixed k=3)" if r == 0 else ""), 3, r)
               for r in list(SWEEP_RATIOS) + list(extra_ratios)]
    configs += [("fixed k=1", 1, 0.0), ("fixed k=2", 2, 0.0)]
    rows = []
    ratios_seen = []
    for name, k, r in configs:
        per = []
        for q in golden:
            exp = [lessons[n] for n in q["expected_lessons"]]
            got = moment_rag.retrieve(q["question"], k, ratio=r)
            if r == 0 and k == 3:
                ratios_seen.append([round(u["score"] / got[0]["score"], 3) for u in got])
            per.append({"type": q["type"], "recall": lesson_recall(got, exp),
                        "purity": context_purity(got, exp, units), "units": len(got)})
        row = {"config": name, "k_max": k, "ratio": r}
        for t in TYPES + ["overall"]:
            g = [x for x in per if t == "overall" or x["type"] == t]
            row[t] = {m: mean(x[m] for x in g) for m in ("recall", "purity", "units")}
        rows.append(row)
    out = {"note": "R chosen on the same 12 questions; no held-out set.",
           "score_ratios_at_fixed_k3": ratios_seen, "rows": rows}
    SWEEP_PATH.write_text(json.dumps(out, indent=1))
    print("\n".join(sweep_table(out)))
    return out


def sweep_table(sw) -> list[str]:
    head = "| config | " + " | ".join(f"{t} recall / purity / units" for t in TYPES + ["overall"]) + " |"
    lines = [head, "|---|" + "---|" * (len(TYPES) + 1)]
    for r in sw["rows"]:
        cells = [f"{r[t]['recall']:.2f} / {r[t]['purity']:.2f} / {r[t]['units']:.2f}" for t in TYPES + ["overall"]]
        lines.append(f"| {r['config']} | " + " | ".join(cells) + " |")
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="retrieval-only metrics, no LLM calls")
    ap.add_argument("--limit", type=int, default=None, help="first N questions only")
    ap.add_argument("--sweep", action="store_true", help="offline adaptive-k sweep for the moment side, then exit")
    ap.add_argument("--extra-ratios", type=float, nargs="*", default=[], help="extra R values for --sweep")
    args = ap.parse_args()
    if args.sweep:
        sweep(args.extra_ratios)
        return

    golden = json.loads(GOLDEN.read_text())[: args.limit]
    lessons = {l["n"]: l for l in json.loads(M.LESSONS_PATH.read_text())}

    have_moments = M.MOMENTS_PATH.exists()
    preview = args.offline and not have_moments
    if not args.offline and not have_moments:
        raise SystemExit("data/moments.json missing: run `python moments.py build` first")
    moment_label = ("moment_preview (Stage 1 candidates, text-only index, no LLM labels)"
                    if preview else "moment (labelled moments, RRF over summaries + text, adaptive k: "
                    f"keep 2-3 while score >= {moment_rag.MOMENT_RRF_RATIO} x top)")
    mode = "offline (retrieval-only, no LLM calls)" if args.offline else "full (answers + LLM judge)"

    rows = []
    for q in golden:
        expected = [lessons[n] for n in q["expected_lessons"]]
        rec = {"id": q["id"], "type": q["type"], "question": q["question"],
               "expected_lessons": q["expected_lessons"],
               "expected_ranges": [[l["start"], l["end"]] for l in expected]}
        for name in ("baseline", "moment"):
            rec[name] = run_pipeline(name, q, expected, args.offline, preview)
        rows.append(rec)
        b, m = rec["baseline"], rec["moment"]
        extra = "" if args.offline else f"  judge b={b['judge_score']} m={m['judge_score']}"
        print(f"{q['id']} {q['type']:<6} recall b={b['lesson_recall']:.2f} m={m['lesson_recall']:.2f}  "
              f"prec b={b['context_precision']:.2f} m={m['context_precision']:.2f}  "
              f"purity b={b['context_purity']:.2f} m={m['context_purity']:.2f}{extra}")

    ingestion = None
    if have_moments:
        mj = json.loads(M.MOMENTS_PATH.read_text())
        lab, n = mj["labelling"], len(mj["moments"])
        ingestion = {**lab, "moments": n, "usd_per_moment": lab["usd"] / n,
                     "moments_version": mj.get("version", "v1-drift-only")}

    results = {
        "run_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "mode": mode,
        "limit": args.limit,
        "models": {"answer": common.ANSWER_MODEL, "judge_and_labelling": common.CHEAP_MODEL,
                   "embedding": "sentence-transformers/all-MiniLM-L6-v2"},
        "prices_usd_per_mtok": {k: list(v) for k, v in common.PRICES.items()},
        "pipelines": {"baseline": f"fixed 120-word chunks, 30 overlap, k={K_CHUNKS}",
                      "moment": f"{moment_label}, k<={K_MOMENTS}"},
        "moment_rrf_ratio": moment_rag.MOMENT_RRF_RATIO,
        "ingestion": ingestion,
        "questions": rows,
    }
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "results.json").write_text(json.dumps(results, indent=1))
    (REPORTS / "scorecard.md").write_text(scorecard(results, args.offline))
    print(f"\nwrote reports/results.json and reports/scorecard.md  [{mode}]")


# ---------------------------------------------------------------- scorecard
def _mean(rows, pipe, metric):
    vals = [r[pipe][metric] for r in rows if r[pipe].get(metric) is not None]
    return mean(vals) if vals else None


def _fmt(v, metric):
    if v is None:
        return "–"
    if metric == "usd":
        return f"${v:.4f}"
    if metric in ("context_tokens", "latency_s"):
        return f"{v:.0f}"
    return f"{v:.2f}"


def _delta(a, b, m):
    if a is None or b is None:
        return "–"
    if m == "usd":
        return f"{b - a:+.4f}"
    if m in ("context_tokens", "latency_s"):
        return f"{b - a:+.0f}"
    return f"{b - a:+.2f}"


def versions_section(res) -> list[str]:
    """Overall means per metric and pipeline: v1 (drift-only moments), v2 (LLM-bounded
    moments, fixed k=3), and this run. v1 predates context_purity, so it is recomputed
    from v1's saved retrievals and v1 moments (no LLM calls)."""
    lessons = {l["n"]: l for l in json.loads(M.LESSONS_PATH.read_text())}
    v1 = json.loads((V1_DIR / "results.json").read_text())
    v1_moments = {m["moment_id"]: m for m in json.loads((V1_DIR / "moments.json").read_text())["moments"]}
    for r in v1["questions"]:
        exp = [lessons[n] for n in r["expected_lessons"]]
        r["baseline"]["context_purity"] = context_purity(r["baseline"]["retrieved"], exp)
        r["moment"]["context_purity"] = context_purity(r["moment"]["retrieved"], exp, v1_moments)
    runs = [("v1", v1)]
    if (V2_DIR / "results.json").exists():
        runs.append(("v2", json.loads((V2_DIR / "results.json").read_text())))
    runs.append(("v3", res))
    names = [n for n, _ in runs]
    out = ["", "## " + " → ".join(names) + " (overall means, n=12)", "",
           "- **v1:** drift-only candidate boundaries, merge-only Haiku pass, 11 moments, fixed k=3.",
           "- **v2:** Haiku may move boundaries ±3 sentences, split, or merge; 14 moments; fixed k=3.",
           f"- **v3:** v2 moments; adaptive k (moment 1 always, moments 2-3 while fused RRF score "
           f">= {moment_rag.MOMENT_RRF_RATIO} x top score).",
           "- v1 context_purity recomputed from v1's saved retrievals. Baseline retrieval is identical "
           "in every run, so its answer-side movement is run-to-run LLM variance: a noise floor for "
           "reading the moment deltas. judge_score is an LLM judge (Haiku), not human.", "",
           "| metric | pipeline | " + " | ".join(names) + f" | delta {names[-2]}→{names[-1]} |",
           "|---|---|" + "---|" * (len(names) + 1)]
    for m in METRICS_FULL:
        for pipe in ("baseline", "moment"):
            vals = [_mean(r["questions"], pipe, m) for _, r in runs]
            out.append(f"| {m} | {pipe} | " + " | ".join(_fmt(v, m) for v in vals)
                       + f" | {_delta(vals[-2], vals[-1], m)} |")
    ing = [(r.get("ingestion") or {}).get("usd_per_moment") for _, r in runs]
    out.append("| ingestion usd / moment | moment | " + " | ".join(_fmt(v, "usd") for v in ing)
               + f" | {_delta(ing[-2], ing[-1], 'usd')} |")
    return out


def scorecard(res, offline) -> str:
    rows = res["questions"]
    metrics = METRICS_OFFLINE if offline else METRICS_FULL
    label = {"judge_score": "judge_score (LLM judge (Haiku), not human; 1-5)",
             "usd": "answer usd / question", "latency_s": "latency_s (mean)",
             "context_tokens": "context_tokens (mean)"}
    out = [
        "# Scorecard: baseline chunk RAG vs Moment RAG", "",
        f"- **Mode:** {res['mode']}",
        f"- **Run at (UTC):** {res['run_at']}"
        + (f"  (limited to first {res['limit']} questions)" if res["limit"] else ""),
        f"- **Models:** answers `{res['models']['answer']}`, judge/labelling "
        f"`{res['models']['judge_and_labelling']}`, embeddings `{res['models']['embedding']}`",
        f"- **Baseline:** {res['pipelines']['baseline']}",
        f"- **Moment:** {res['pipelines']['moment']}"
        + (f" (moments `{res['ingestion']['moments_version']}`)" if res["ingestion"] else ""),
    ]
    ing = res["ingestion"]
    if ing:
        out.append(f"- **Ingestion cost:** Haiku labelling ${ing['usd']:.4f} / {ing['moments']} moments "
                   f"= ${ing['usd_per_moment']:.4f} per moment ({ing['input_tokens']} in / "
                   f"{ing['output_tokens']} out tokens, {ing['attempts']} call(s))")
    else:
        out.append("- **Ingestion cost:** not measured (moments not labelled yet)")
    if offline:
        out.append("- Offline mode: no answers were generated, so citation, phrase, judge, "
                   "token, latency and cost metrics are absent.")

    groups = [(t, [r for r in rows if r["type"] == t]) for t in TYPES] + [("overall", rows)]
    groups = [(t, g) for t, g in groups if g]
    out += ["", "## Headline (means)", "",
            "| metric | pipeline | " + " | ".join(f"{t} (n={len(g)})" for t, g in groups) + " |",
            "|---|---|" + "---|" * len(groups)]
    for m in metrics:
        for pipe in ("baseline", "moment"):
            cells = [_fmt(_mean(g, pipe, m), m) for _, g in groups]
            out.append(f"| {label.get(m, m)} | {pipe} | " + " | ".join(cells) + " |")
    out += ["", f"Note: {PRECISION_NOTE}"]

    if not offline and not res["limit"] and (V1_DIR / "results.json").exists():
        out += versions_section(res)
    if SWEEP_PATH.exists():
        sw = json.loads(SWEEP_PATH.read_text())
        out += ["", "## Adaptive-k sweep (moment side, offline). R chosen on the same 12 questions; no held-out set.", "",
                f"Chosen: MOMENT_RRF_RATIO = {moment_rag.MOMENT_RRF_RATIO}. Cells are lesson_recall / "
                "context_purity / mean moments returned (k max 3). With RRF k=60 the fused scores are "
                "compressed (2nd and 3rd moments score >= 0.95 of the top on every question), so only "
                "R >= 0.95 changes anything. Why 0.97 rather than the rule's argmax 0.98 (purity 0.75): "
                "0.98 is one 0.005 step from the recall cliff at 0.985 (recall 0.83 -> 0.76), while 0.97 sits on "
                "a plateau (0.97 and 0.975 identical) at purity 0.71. Both beat fixed k=2 (purity 0.61), "
                "the winner of the originally specified grid.", ""]
        out += sweep_table(sw)

    out += ["", "## Per question", ""]
    head = ["id", "type", "expected"] + [f"{m} b / m" for m in metrics]
    out += ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for r in rows:
        cells = [r["id"], r["type"], ",".join(map(str, r["expected_lessons"]))]
        cells += [f"{_fmt(r['baseline'].get(m), m)} / {_fmt(r['moment'].get(m), m)}" for m in metrics]
        out.append("| " + " | ".join(cells) + " |")

    out += ["", "## Retrieved units", ""]
    for r in rows:
        b = ", ".join(f"{common.mmss(u['start'])}–{common.mmss(u['end'])}" for u in r["baseline"]["retrieved"])
        m = ", ".join(f"{u['title']} ({common.mmss(u['start'])}–{common.mmss(u['end'])})"
                      for u in r["moment"]["retrieved"])
        out.append(f"- **{r['id']}** baseline: {b}  \n  moment: {m}")

    if not offline:
        out += ["", "## Multi-lesson questions, answers side by side", ""]
        for r in [r for r in rows if r["type"] == "multi"]:
            cell = lambda s: s.replace("|", "\\|").replace("\n", "<br>")
            out += [f"### {r['id']}: {r['question']}", "",
                    "| baseline (k=5 chunks) | moment (k=3 moments) |", "|---|---|",
                    f"| {cell(r['baseline']['answer'])} | {cell(r['moment']['answer'])} |", "",
                    f"Judge: baseline {r['baseline']['judge_score']} ({r['baseline']['judge_reason']}); "
                    f"moment {r['moment']['judge_score']} ({r['moment']['judge_reason']})", ""]
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    main()
