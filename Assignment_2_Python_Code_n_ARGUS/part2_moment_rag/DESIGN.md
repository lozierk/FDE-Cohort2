# Part 2 — Moment RAG on McRaven's "Make Your Bed" (UT Austin 2014)

Video: https://www.youtube.com/watch?v=yaQZFhrW0fU  (id `yaQZFhrW0fU`)
Manual English captions, 281 segments, 19.4 min, ~3,200 words, ten numbered lessons
each closed by the refrain "if you want to change the world".

Goal: a baseline chunk-RAG and a Moment-RAG pipeline over the same transcript, the
same embedding model, the same answer model, and the same golden set, so the only
variable is the retrieval unit. Score both. Small Python scripts, no deploy, no UI.

## Fixed choices (do not re-decide)
- Python 3.11 via `uv` (`uv venv .venv --python 3.11`; `uv pip install -r requirements.txt`).
- Embeddings: `sentence-transformers` `all-MiniLM-L6-v2`, local. Same model in both
  pipelines (isolates the moment effect; also the classmate's model, so like-for-like).
- Vector store: `chromadb` persistent client at `./chroma_db/` (gitignored).
- LLM: Anthropic. Answers: `claude-sonnet-5`. Cheap passes (moment labelling,
  judging): `claude-haiku-4-5-20251001`. Key from `ANTHROPIC_API_KEY` env (dotenv
  fallback to `.env`; never print or read the key). Load the `claude-api` skill
  before writing any Anthropic SDK code.
- Timestamps everywhere as seconds (float) internally, rendered `mm:ss` for humans.
- Display precision: fractions to 2dp, latencies to whole seconds. Never invent numbers.
- Every LLM call records `input_tokens`, `output_tokens`, wall seconds.

## Files
```
part2_moment_rag/
  DESIGN.md                 this file
  README.md                 how to run + results summary (written last)
  requirements.txt
  .env.example              ANTHROPIC_API_KEY=
  .gitignore                .venv/ chroma_db/ .env __pycache__/
  common.py                 transcript load, sentence split, embeddings, chroma, claude()
  fetch_transcript.py       -> data/transcript.json
  ground_truth.py           -> data/lessons.json (ten lessons, start/end/title) 
  baseline.py               build + query fixed-size chunk RAG
  moments.py                detect + label moments -> data/moments.json, index them
  moment_rag.py             query the moment index, multi-moment answer
  run_eval.py               both pipelines x golden set -> reports/
  eval/golden_set.json
  data/                     transcript.json, lessons.json, moments.json (committed, small)
  reports/                  scorecard.md, results.json (committed)
```

## Data contracts
`data/transcript.json`: `{"video_id", "title", "duration_s", "segments": [{"start", "duration", "text"}]}`
straight from `youtube-transcript-api` (`YouTubeTranscriptApi().list(vid).find_transcript(["en"]).fetch()`),
manual track preferred over generated.

`common.sentences(transcript) -> [{"i", "start", "end", "text"}]`: join caption text
(newlines -> spaces), split on sentence punctuation, map each sentence's start to the
caption in which it begins and end to the caption in which it ends. Used by both pipelines.

`data/lessons.json` (ground truth, ten items): `[{"n": 1, "title": "Make your bed",
"start": s, "end": s, "story": "...", "moral": "..."}]`. Boundaries: a lesson starts
at the sentence that opens its story and ends at the sentence completing its
"if you want to change the world ..." refrain. Pre-lesson intro and post-lesson close
are not lessons. Derive with a script that finds the ten refrains, then hand-check
the starts against the transcript and print them for review.

`common.claude(system, user, model, max_tokens) -> {"text", "input_tokens",
"output_tokens", "seconds"}` — single wrapper, no streaming. The installed SDK (1.8.0) has no `temperature`; use `thinking={"type": "disabled"}` for determinism on both models.

## Baseline (baseline.py)
- Chunks: fixed **120 words, 30-word overlap**, built over the sentence stream
  ignoring sentence boundaries (the point is that it cuts mid-idea). Each chunk carries
  `start` = start of first word's sentence, `end` = end of last word's sentence.
  Expect ~35 chunks; lessons are ~300 words, so chunks split story from moral.
- Chroma collection `baseline_chunks`, metadata `{start, end, idx}`.
- `retrieve(q, k=5)` -> chunks with distances. `answer(q, k=5)` -> Sonnet with the
  chunks in time order, each prefixed `[n] (mm:ss–mm:ss)`; prompt requires citing `[n]`.
- CLI: `python baseline.py build`, `python baseline.py ask "question"`.

## Moment RAG (moments.py + moment_rag.py)
Stage 1 — candidate boundaries by embedding drift (no LLM):
- Windows of 3 consecutive sentences, stride 1; embed; cosine similarity between
  window i and i+1 gives a drift series. TextTiling-style depth score at each gap
  (how far the local similarity dips below its neighbours' peaks). Boundaries =
  gaps with depth > mean + 0.5·std, then enforce a minimum segment of 6 sentences
  (merge into the neighbour with the higher similarity). Target 8–16 candidates.
  Save the drift series to `data/drift.json` for a chart in the deck.
Stage 2 — one Haiku pass to label and refine:
- Prompt gets the candidate segments (index, mm:ss range, text) and asks for JSON:
  `[{"title", "summary" (2–3 sentences), "start_sentence", "end_sentence",
  "merge_with_previous": bool}]`. Haiku may merge adjacent candidates that are the
  same topic, never split (keeps the LLM from re-chunking). Resulting moments carry
  `start`, `end` (from sentence timestamps), `title`, `summary`, `text`.
- Save `data/moments.json`. Print a table: n, mm:ss range, title, words.
Stage 3 — index: two Chroma collections, `moment_summaries` (embed title + summary)
  and `moment_text` (embed full text; if > 256 words, embed the mean of 120-word
  sub-window embeddings). Same metadata `{moment_id, start, end, title}`.
Retrieval (`moment_rag.retrieve(q, k=3)`): query both collections top-10, fuse with
  Reciprocal Rank Fusion (k=60), return top-k distinct moments. Multi-moment by
  design: the answer prompt gets all k moments' full text in time order, each
  prefixed `[n] Title (mm:ss–mm:ss)`; require `[n]` citations and timestamps.
CLI: `python moments.py build`, `python moment_rag.py ask "question"`.

## Golden set (eval/golden_set.json) — 12 questions, three types
- `lookup` (4): answer sits inside one lesson, e.g. "What did the instructors do
  when a sugar cookie failed inspection?"
- `span` (4): needs a lesson's story AND its moral, e.g. "What happened with the
  boat crew of the little guys, and what lesson does McRaven draw from it?"
- `multi` (4): spans 2+ lessons, e.g. "Which lessons involve the SEAL instructors
  punishing or testing the trainees, and what was the point each time?"
Each: `{"id", "type", "question", "expected_lessons": [n...], "key_phrases": [3],
"reference_answer": "..."}`. Expected time ranges come from `lessons.json` at eval
time, not hard-coded. Write the reference answers from the transcript, not from memory.

## Scoring (run_eval.py) — same questions, both pipelines, k=5 chunks vs k=3 moments
Per question, per pipeline:
- `lesson_recall`: fraction of `expected_lessons` whose time range overlaps at least
  one retrieved unit (overlap ≥ 50% of the lesson OR the unit lies inside the lesson).
- `context_precision`: fraction of retrieved units overlapping any expected lesson.
- `citation_accuracy`: fraction of `[n]` citations in the answer whose unit overlaps
  an expected lesson (0 citations → 0).
- `phrase_coverage`: fraction of key_phrases present in the answer (case-insensitive,
  after collapsing whitespace).
- `judge_score` (Haiku, 1–5): answer vs reference_answer for completeness and
  faithfulness; prompt returns JSON `{"score", "reason"}`. Report as a mean with 2dp
  and label it "LLM judge (Haiku), not human".
- `context_tokens` (input_tokens of the answer call), `latency_s` (whole seconds).
Output `reports/results.json` (every run, every field) and `reports/scorecard.md`:
one table per metric grouped by question type, plus per-question rows, plus the
two answers side-by-side for the 4 `multi` questions. Fractions at 2dp.
Run cost budget: 12 q × 2 pipelines × (1 Sonnet + 1 Haiku) ≈ 48 calls. Fine.

## What "beat the classmate" means here (from docs/recon/recon_muthukumar.md)
He had: no LLM answers, rule-based pause/keyword boundaries, top-1 moment only,
2 questions. We have: LLM answers on both sides, semantic boundaries + LLM
labelling, multi-moment RRF retrieval, 12 questions in three types, a ground-truth
lesson set, and a scorecard with an honest failure analysis.

## Carried forward from Cohort 1 A3 reviewer feedback (Jayita, 2026-08-07)
Her "to improve": move CLIP off the query box, scale workers, add cost-per-document
instrumentation. Applied here:
- **Cost instrumentation.** `common.py` holds `PRICES = {model: (usd_per_M_input,
  usd_per_M_output)}` taken from the `claude-api` skill's rate card (cite the source
  in a comment; do not quote prices from memory). Every call returns `usd`. The
  scorecard reports ingestion cost per moment (Haiku labelling pass ÷ moment count)
  and answer cost per question per pipeline, to 4dp.
- **Write-path vs read-path.** All moment work (drift + Haiku labelling + summary
  embedding) is ingestion. The query path is one embedding, one Chroma lookup, one
  Sonnet call, same as the baseline. The reference codebase builds moments at query
  time (15 s fusion window); ours are persisted. Say so in the README and deck.
- Worker scaling is a deck limitation bullet, not a build item.
