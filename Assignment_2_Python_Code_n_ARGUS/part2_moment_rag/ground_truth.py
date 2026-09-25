"""Build data/lessons.json: ten hand-checked lessons from the ten
'if you want to change the world' refrains. See DESIGN.md for the boundary rule.
"""
import json
import re
from pathlib import Path

import common

OUT = Path(__file__).parent / "data" / "lessons.json"

TITLES = [
    "Make your bed",
    "Find someone to help you paddle",
    "Measure a person by the size of their heart",
    "Get over being a sugar cookie",
    "Don't be afraid of the circuses",
    "Slide down the obstacle head first",
    "Don't back down from the sharks",
    "Be your very best in the darkest moment",
    "Start singing when you're up to your neck in mud",
    "Don't ever ring the bell",
]

# key noun/phrase each lesson's text must contain, for the sanity check
KEY_NOUNS = [
    "bed", "paddle", "heart", "sugar cookie", "circus",
    "obstacle", "shark", "darkest moment", "mud", "bell",
]

REFRAIN_RE = re.compile(r"if you want to change the world", re.I)
LESSON1_START_MARKER = "Every morning in SEAL training"


def build():
    transcript = common.load_transcript()
    sents = common.sentences(transcript)

    refrain_idxs = [s["i"] for s in sents if REFRAIN_RE.search(s["text"])]
    if len(refrain_idxs) != 10:
        raise SystemExit(
            f"expected 10 refrains, found {len(refrain_idxs)} at {refrain_idxs} "
            "-- inspect and fix REFRAIN_RE, do not hand-edit the JSON"
        )

    lesson1_start = next(
        s["i"] for s in sents if s["text"].startswith(LESSON1_START_MARKER)
    )

    lessons = []
    for n, refrain_idx in enumerate(refrain_idxs, start=1):
        start_idx = lesson1_start if n == 1 else refrain_idxs[n - 2] + 1
        moral_idxs = [refrain_idx - 1, refrain_idx]
        story_idxs = list(range(start_idx, refrain_idx - 1))

        story = " ".join(sents[i]["text"] for i in story_idxs)
        moral = " ".join(sents[i]["text"] for i in moral_idxs)

        lessons.append({
            "n": n,
            "title": TITLES[n - 1],
            "start": sents[start_idx]["start"],
            "end": sents[refrain_idx]["end"],
            "story": story,
            "moral": moral,
        })

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(lessons, indent=1))

    # --- print table for human review ---
    print(f"{'n':>2}  {'range':>13}  {'words':>5}  title / first 8 words")
    for l in lessons:
        text = l["story"] + " " + l["moral"]
        words = len(text.split())
        first8 = " ".join(text.split()[:8])
        rng = f"{common.mmss(l['start'])}-{common.mmss(l['end'])}"
        print(f"{l['n']:>2}  {rng:>13}  {words:>5}  {l['title']} | {first8}...")

    # --- sanity checks ---
    problems = []
    prev_end = -1
    for l in lessons:
        dur = l["end"] - l["start"]
        if dur < 40:
            problems.append(f"lesson {l['n']} is only {dur:.0f}s (< 40s)")
        if l["start"] < prev_end:
            problems.append(f"lesson {l['n']} starts before previous lesson ends")
        prev_end = l["end"]
        noun = KEY_NOUNS[l["n"] - 1]
        full_text = (l["story"] + " " + l["moral"]).lower()
        if noun not in full_text:
            problems.append(f"lesson {l['n']} text missing key noun '{noun}'")

    if problems:
        print("\nSANITY CHECK FAILURES:")
        for p in problems:
            print(" -", p)
        raise SystemExit(1)
    else:
        print(f"\nsanity check OK: 10 lessons, in order, all >= 40s, all key nouns present")
        print(f"wrote {OUT}")


if __name__ == "__main__":
    build()
