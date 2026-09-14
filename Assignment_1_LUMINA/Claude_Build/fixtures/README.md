# Test fixtures (Claude_Build)

Files here are the fixed standard we measure against locally, before and after the graded bench,
so a number quoted in the write-up always points at a known artifact.

| File | What | How made | sha256 |
|---|---|---|---|
| `bench-60p.pdf` | 60-page text-only PDF (Helvetica, PDF 1.4), 24,638 bytes. The exact file `benchmark/bench.mjs` uploads in its "ingest during search" phase (`workload.ingest_during_search_pdf_pages: 60`). | `node fixtures/make-bench-pdf.mjs` (calls the bench's own `makePdf`; deterministic) | `7efc570897693ffea3121b94ac0daf55273422489daf4d4ed46e80cbed72b3c8` |

The RAG recall corpus is **not** copied here: it lives in `eval/gold/corpus/` (provided, read-only)
and is uploaded from there by `bin/upload.py` and by the bench.

Do not hand-edit a fixture. Regenerate it with the script and update the hash in this table.
