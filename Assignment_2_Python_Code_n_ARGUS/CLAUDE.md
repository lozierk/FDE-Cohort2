# Assignment 2 — Agentic Router notebook (Part 1) + Moment RAG (Part 2)

Hamza's FDE Bootcamp, Cohort 2. Due **Friday 2026-09-25**. Kurt submits each part on
its own as soon as it is done. Briefs: `Assignment_Part_1.md`, `Assignment_Part_2.md`.

## Layout
- `part1_agentic_router/` — Part 1 deliverable. `Agentic_Router.ipynb` is the executed
  notebook (source of truth). `.venv` (uv, Python 3.11, kernel `a2-part1`),
  `Agentic_RAG/` (prebuilt Qdrant index, gitignored, re-fetch per README),
  `offline_harness.py` (fake-LLM proof, no tokens), `smoke_qdrant.py`.
- `docs/recon/` — read before Part 2: momentsearch moment logic, notebook structure,
  classmate benchmark (Muthukumar), original untouched notebook.
- `part2_moment_rag/` — Part 2 build (not started).
- `Resume_from_*.md` — most recent by filename is authoritative.

## Rules
- Never read, cat, or ls `.env` files; report key names and lengths only.
- Part 1 is graded scaffolding: change only the stub cells and cells added after them.
- Run the notebook with `.venv/bin/jupyter nbconvert --execute --inplace
  --ExecutePreprocessor.kernel_name=a2-part1` from `part1_agentic_router/`.
- Orchestrate per the global rule: delegate reading and routine builds; keep judgment inline.
- Display precision: fractions + 2dp, whole-second latencies, no false precision.
- Don't copy the classmate's video (Jobs Stanford talk) or approach; beat it on LLM
  answers, semantic moment boundaries, multi-moment retrieval, and eval discipline.
