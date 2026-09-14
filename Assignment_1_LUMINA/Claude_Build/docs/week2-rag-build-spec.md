# Week 2 build spec, part A: Spaces, the jobs worker, and RAG — Claude_Build

Written 2026-09-14 by Claude (session 5). Read alongside `docs/week1-build-spec.md` (the hard
rules there still hold), `DESIGN.md` v1.0, `AGENTS.md` "RAG (MongoDB Atlas)", `SPEC.md` §5.4,
§7, §8, and `packages/contract/src/{db,http,sse}.ts`. The contract is law. Deep search is
part B, a separate spec; nothing here touches `plan_research` or `depth`.

## Hard rules (repeated because they are automatic fails)
- Never edit `web/`, `packages/contract/`, `benchmark/`, `eval/`, `quality/`, `scripts/`.
  Reading `eval/gold/corpus/*` as a test fixture is fine; writing there is not.
- No new npm dependencies. `multer` 2, `pdfjs-dist` 4.10 (hoisted to the root
  `node_modules`), `mongodb` 6 (GridFS included), `openai`, `mongodb-memory-server` are installed.
- Parsing, chunking, embedding, and indexing happen in the worker process, never on the
  request path. The upload route writes to GridFS, inserts two rows, and answers `202`.
- A document is `indexed` only after the read-your-write probe finds one of its own chunks
  through the vector index.
- Every chunk carries a locator. A document citation without one is worthless to the grader.
- Never cite a chunk that was not retrieved in this request. The `SourceRegistry` is the only
  path to a citation number; do not build a second one.
- Fail loud. A provider exception in the worker fails the job and the document with the error
  string; in the loop it ends the run with `terminated: "error"`.
- Do not print, log, or copy `.env` or any key. Do not raise any cap or threshold.
- `npm test` and `npm run typecheck` in `backend/agent` must stay green (30 tests today) and
  the new work must add tests (see §9). `backend/gateway` is unchanged by this spec.

## 1. What the grader measures (design against this, not against prose)
From `benchmark/bench.mjs` phase 2 and `benchmark/sla.json`:
- `202` accept latency p95 ≤ 300 ms, measured on `POST /spaces/{id}/documents`.
- `indexedViaWorker`: every corpus file reaches `status: "indexed"` within 240 s, polling
  `GET /spaces/{id}/documents` every 1.2 s.
- **recall@5 ≥ 0.70** over 30 of the 39 gold questions in `eval/gold/rag_gold.jsonl`, asked with
  `mode: "docs"` and the bench's `spaceId`. A hit is: among the **first five `kind: "doc"`
  entries of the `sources` event**, one whose title stem matches the gold `doc` filename AND
  (for PDF items) `locator.page === item.page`, or (for Markdown items) the gold `anchor`
  phrase is found verbatim, whitespace-normalized, inside `source.snippet`.
- `pageLocator`: at least one doc citation carries `locator.page`.
- `routerPicksDocs`: `mode: "auto"` with a `spaceId` on a corpus question must produce a
  `search_documents` trace step and at least one `kind: "doc"` source.
- Grounding for doc citations checks `source.snippet` against the snippet text keyed by
  `docId + locator`; it is self-referential, so a verbatim chunk text as snippet always grounds.
- Search p95 during a 60-page PDF ingest may be at most 1.3× idle. This is why the worker is a
  separate OS process.

Consequences: chunk boundaries never cross a PDF page; the `snippet` of a doc source is the
whole chunk text, not a query-chosen 300-char passage; the title of a doc source is the
uploaded filename; the first `search_documents` call's top-5 are the first five doc sources.

## 2. Files to create or change (agent service only)

```
src/config/rag.ts                 NEW   declared retrieval + chunking constants (env-overridable)
src/env.ts                        EDIT  worker + RAG env vars (§3)
src/store/index.ts                EDIT  spaces, documents, chunks, jobs accessors + indexes
src/store/gridfs.ts               NEW   bucket 'uploads': put(buffer, filename, mime) / get(fileId)
src/routes/spaces.ts              NEW   POST /spaces, GET /spaces, POST+GET /spaces/:id/documents
src/index.ts                      EDIT  mount spaceRoutes; spawn the worker child (§6); 501 list shrinks
src/ingest/parse.ts               NEW   pdf (pdfjs-dist, page-aware), markdown, plain text → ParsedUnit[]
src/ingest/chunk.ts               NEW   ParsedUnit[] → Chunk drafts with locator + ord
src/ingest/probe.ts               NEW   read-your-write probe, both backends
src/ingest/index-document.ts      NEW   the job body: stages, pct, resumable
src/worker.ts                     EDIT  poll / claim / sweep / run, one process
src/retrieval/search-chunks.ts    NEW   hybrid retrieval ($vectorSearch + $search + RRF) and the cosine-scan fallback
src/tools/search-documents.ts     NEW   the tool; replaces the stub in tools/index.ts
src/tools/index.ts                EDIT  import the real tool
src/tools/types.ts                EDIT  addEmbeddingTokens(n) on ToolContext (§7.4)
src/loop/sources.ts               EDIT  doc candidates: key by docId+locator, carry locator, snippet = chunk text
src/loop/prompts.ts               EDIT  Space notice in the research prompt (§7.3)
src/loop/quick.ts                 EDIT  docs/auto preflight (§7.2); per-request embedding tokens
bin/upload.py                     NEW   create a Space, upload files, wait for indexed, print timings
bin/recall.py                     NEW   ask the gold questions through ask.py's path, score recall@5 the bench's way
test/ingest.test.ts               NEW   parse + chunk + probe + index-document against in-memory Mongo
test/spaces.test.ts               NEW   the routes
test/retrieval.test.ts            NEW   search_documents on the cosine-scan backend + registry changes
```

## 3. Config and env
`src/config/rag.ts` exports the declared defaults; `env.ts` reads overrides with the same
`num()` helper and the names below. SPEC §5.4: "top-k and thresholds declared in config, not
hard-coded."

| Env var | Default | Meaning |
|---|---|---|
| `WORKER` | `child` | `child`: index.ts spawns the worker process at boot. `none`: it does not (tests, or when `npm run worker` runs it separately). |
| `WORKER_POLL_MS` | `2000` | poll interval when the last poll found nothing (DESIGN.md: two seconds). After a job, poll again immediately. |
| `WORKER_LEASE_SEC` | `120` | a `running` job whose `claimedAt` is older than this is swept back to `pending`. |
| `WORKER_MAX_ATTEMPTS` | `3` | after this many claims the job is `failed` and the document `failed` with the last error. |
| `MAX_UPLOAD_MB` | `25` | multer `limits.fileSize`; over → `413`. |
| `CHUNK_CHARS` | `1000` | target chunk length in characters (≈ 250 tokens). |
| `CHUNK_OVERLAP_CHARS` | `150` | overlap between consecutive chunks inside one unit. |
| `EMBED_BATCH` | `64` | texts per embedding call. |
| `RAG_TOP_K` | `5` | chunks returned by `search_documents` and registered as sources. |
| `RAG_CANDIDATES` | `20` | results taken from each ranker before fusion. |
| `RAG_VECTOR_NUM_CANDIDATES` | `100` | `$vectorSearch.numCandidates`. |
| `RAG_RRF_K` | `60` | the RRF constant. |

Add every one of these to `.env.example` with a one-line comment. Do not add them to `.env`.

## 4. Data
Shapes are `DocumentDoc`, `ChunkDoc`, `JobDoc`, `SpaceDoc` from the contract; indexes are
already applied on Atlas (`scripts/indexes.json`: `chunks {docId, ord}`, `chunks {spaceId}`,
`chunks_vector` with filter fields `spaceId` and `userId`, `chunks_text` with `text` as string
and `spaceId`/`userId` as `token`). `ensureIndexes()` adds the regular indexes for
`spaces`, `documents`, `chunks`, `jobs` from that file so the in-memory fallback has them too.
- `chunks._id = "${docId}:${ord}"` (deterministic, so a retried job upserts instead of duplicating).
- `documents.title` = the uploaded filename as sent in the multipart part (`retrieval-basics.pdf`).
  `mimeType`, `bytes`, `fileId` (GridFS id as string), `status`, `pct`, `pages` (PDF only), `chunks` (count once written).
- `jobs.payload = { docId, spaceId }`, `kind: "index_document"`. `attempts` starts at 0.
- GridFS bucket name `uploads`, one file per document, metadata `{ docId, spaceId, userId }`.

## 5. Routes (`src/routes/spaces.ts`)
Follow the pattern in `routes/threads.ts`: `requireUser`, zod-parse bodies, `sendError`, and
validate every response with the contract schema before sending. A space that does not exist
and a space owned by another user are the same `404`.
- `POST /spaces` body `CreateSpaceBody` → `201 CreateSpaceResponse`.
- `GET /spaces` → `200 ListSpacesResponse`, newest first, this user only.
- `POST /spaces/:spaceId/documents` multipart, field name `file` (the bench sends exactly that).
  multer `memoryStorage`, `limits: { fileSize: MAX_UPLOAD_MB·1024·1024, files: 1 }`.
  Accept by extension of the filename or by mime: `.pdf`/`application/pdf`,
  `.md`/`text/markdown`, `.txt`/`text/plain`; anything else `400`. multer's `LIMIT_FILE_SIZE`
  → `413`. No file part → `400`. Then, in order: GridFS write, `documents` insert
  (`pending`, `pct: 0`), `jobs` insert (`pending`), respond `202 UploadDocumentResponse`.
  Measure and log `ms` for the whole handler; it must be well under 300 ms for the bench
  files (≤ 13 KB) and the 60-page synthetic PDF.
- `GET /spaces/:spaceId/documents` → `200 ListDocumentsResponse`, oldest first. `DocumentRow`
  omits `pages`/`chunks`/`error` when unset (the schemas use `.optional()`, so do not send `null`).
- `POST /threads/:id/ask` with a `spaceId` (any mode): look the space up first; unknown or not
  this user's → `404` before any streaming starts. Existing behaviour otherwise.
- Remove these four routes from the `ROUTES` 501 loop in `index.ts` by mounting `spaceRoutes`
  before it (the loop already skips nothing else; mounting first is enough because the
  registered handlers win).

## 6. The worker (`src/worker.ts`, `src/ingest/*`)
One OS process, Kurt's decision (DESIGN.md trade-off 3). `index.ts` spawns it at boot when
`WORKER=child`:
- Use `child_process.fork` on this file's sibling `worker` module with
  `execArgv: process.execArgv` so it works under both `npx tsx src/index.ts` (tsx registers its
  loader through execArgv) and `node dist/index.js`. Verify both by running them; if tsx does
  not carry its loader in `execArgv` on this machine, fall back to
  `spawn(process.execPath, ['--import', 'tsx', workerPath])` in development and say so in a
  comment. Env is inherited, so the child reads the same `.env`.
- Log the child's pid at boot; on exit, log the code and restart after 5 s with backoff up
  to 60 s. Kill the child on the parent's `SIGTERM`/`SIGINT`.
- `npm run worker` keeps working as a standalone process for a two-process deploy.

Worker loop (`worker.ts` `main()`):
1. `workerId = "${hostname()}:${pid}"`. Log once at boot with the poll interval and backend.
2. Every tick: **sweep** (`running` with `claimedAt < now − WORKER_LEASE_SEC` → `pending`, log
   each), then **claim** with the atomic `findOneAndUpdate` from the file's own header
   comment (`status: 'pending'` → `running`, `claimedAt`, `workerId`, `$inc attempts`, oldest
   first). Nothing claimed → sleep `WORKER_POLL_MS`. Claimed → run it, then poll again at once.
3. If `attempts > WORKER_MAX_ATTEMPTS` at claim time: mark the job `failed` and the document
   `failed` with `error: "gave up after N attempts: <last error>"`, do not run it.
4. Run `indexDocument(job)` (below). Success → job `done`. Throw → job `pending` if attempts
   remain (with `error` set for the log) else `failed` + document `failed` with the message.
   Never swallow; every failure lands in the document row's `error` and in a `log.error`.
5. Refresh `claimedAt` every 30 s while a job runs so a slow 60-page PDF is not swept mid-job.

`indexDocument({ docId, spaceId, userId })` in `src/ingest/index-document.ts`, stages in order,
each stage sets `documents.status` and `pct` before it starts:
- **parsing** (pct 5 → 35). Read the GridFS file to a Buffer. `parse(buffer, mimeType, title)`
  → `ParsedUnit[]`. Set `pages` for PDFs.
- **embedding** (pct 35 → 85). `chunk(units)` → drafts `{ ord, text, locator }`. Load the ids
  of chunks already present for this `docId`; skip embedding for those (finished work is not
  re-run after a crash). Embed the rest in batches of `EMBED_BATCH`; after each batch
  `bulkWrite` upserts by `_id`, update `pct` proportionally and `chunks` = written so far.
  Log embedding tokens and their cost per job (they are not charged to any answer).
- **probe** (pct 85 → 100). `probe(chunk0)` from `src/ingest/probe.ts`: on
  `atlas-vector-search`, run the same `$vectorSearch` the tool uses with chunk 0's own
  embedding and `spaceId` filter, `limit: 5`, and succeed when a returned `_id` starts with
  `${docId}:`. Retry on miss with backoff 1, 2, 4, 8, 16, 32 s (≈ 63 s total), then throw
  `"read-your-write probe failed: chunk not visible in chunks_vector after 63 s"`. On
  `mongo-cosine-scan` the probe is `findOne({ _id })` on the chunk, and the log says so.
- **indexed**: `status: "indexed"`, `pct: 100`, `chunks: <count>`. Only here, only after the probe.
- A document with zero extractable text (blank PDF, empty file) → `failed` with
  `error: "no text could be extracted"`. Not `indexed` with zero chunks.

### 6.1 Parsing (`src/ingest/parse.ts`)
`ParsedUnit = { text: string; locator: Locator }` where a unit is one PDF page, one Markdown
section, or the whole plain-text file.
- **PDF**: `import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'` (Node build, no
  worker thread: pass `{ data, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: false }`
  and set `disableWorker` if the version requires it; confirm on `eval/gold/corpus/retrieval-basics.pdf`).
  For each page, `getTextContent()`; join `items` in order, inserting `"\n"` when `hasEOL`
  is true and `" "` otherwise; collapse runs of spaces. One unit per page, `locator: { page }`
  (1-based). Verify: page 1 of `retrieval-basics.pdf` contains `The common default is 1.2`
  (gold g01) and the page count equals `pages.json`'s for that file.
- **Markdown**: split on ATX headings (`^#{1,6}\s`). Each section is one unit with
  `locator: { heading: <heading text without the hashes> }`; text before the first heading is a
  unit with `{ heading: <filename> }`. Keep the heading line as the first line of the section
  text so the anchor phrase and its context stay together. Strip nothing else; code fences
  stay as text.
- **Plain text**: split into windows of `CHUNK_CHARS` at line boundaries; `locator: { line }`
  = 1-based first line of the window.

### 6.2 Chunking (`src/ingest/chunk.ts`)
Within one unit only (never across a page or a section): if the unit's text is ≤
`CHUNK_CHARS + CHUNK_OVERLAP_CHARS`, it is one chunk. Otherwise slide a window of `CHUNK_CHARS`
that breaks at the last sentence end or newline before the limit, and start the next window
`CHUNK_OVERLAP_CHARS` back from that break, at a word boundary. Every chunk inherits its
unit's locator. `ord` increments across the whole document. Empty or whitespace-only chunks are
dropped. Chunk text is stored exactly as it will be shown as the citation snippet.

## 7. Retrieval and the loop

### 7.1 `search_documents` (`src/tools/search-documents.ts`, `src/retrieval/search-chunks.ts`)
Tool schema: `{ query: string }` only. Behaviour:
- No `ctx.spaceId` → `{ ok: false, error: 'no Space is attached to this request; ask the user to pick one' }`.
- Embed the query once (`ctx.addEmbeddingTokens`).
- `searchChunks({ spaceId, queryText, queryVec })` returns up to `RAG_TOP_K` hits
  `{ chunk, score, ranks: { vector?, text? } }`:
  - **atlas-vector-search**: two aggregations run in parallel. Dense:
    `$vectorSearch { index: 'chunks_vector', path: 'embedding', queryVector, numCandidates: RAG_VECTOR_NUM_CANDIDATES, limit: RAG_CANDIDATES, filter: { spaceId } }`
    then `$project` everything but `embedding`. Lexical:
    `$search { index: 'chunks_text', compound: { must: [{ text: { query, path: 'text' } }], filter: [{ equals: { path: 'spaceId', value: spaceId } }] } }`,
    `$limit: RAG_CANDIDATES`, same projection. Fuse with RRF: `score(d) = Σ 1/(RAG_RRF_K + rank_i(d))`
    over the lists that contain `d`, sort desc, tie-break by lower `ord`, take `RAG_TOP_K`.
  - **mongo-cosine-scan**: load this space's chunks (cap 5 000, log a warning above 2 000),
    rank by cosine, and by query-term overlap using `terms()` from `loop/sources.ts` as the
    lexical half, fuse the same way. Same function signature; `/health` already says which backend is live.
  - No re-rank step. Documented reason (put it in the module header and in DESIGN.md later):
    the corpus is four documents; RRF over two rankers already lifts exact-token hits, and a
    cross-encoder or LLM re-rank would add a model round trip inside a 2.5 s TTFT budget.
- Register every hit with `ctx.sources.add({ kind: 'doc', title: document.title, docId, locator, text: chunk.text })`
  in fused order (needs one `documents` lookup per distinct docId; cache it per request).
- Content returned to the model: one line per hit,
  `[n] <filename>, p. <page> | § <heading> | line <line> — <first 300 chars>`; then, if the
  space holds documents not yet `indexed`, one line
  `Not yet searchable (still indexing): <filename> (<status>), …`. Zero hits →
  `{ ok: true, content: 'No matching passages in this Space for "<query>".' }` (a real outcome, not an error).
- Trace `input` is the query; the loop already records `ms` and `ok`.

### 7.2 Preflight in `quick.ts`
Mirror the existing web preflight. On a fresh thread (`history.length === 0`) when
`ctx.spaceId` is set and `mode` is `docs` or `auto`, run `search_documents` with the user's
query before the first model turn, as a real `tool_use`/`tool_result` pair, reason
`"mode=docs: search the Space first"` / `"mode=auto: a Space is attached, search it first"`.
Then the model continues as today (in `auto` it may add web searches). The existing web
preflight stays as is for `mode=web`. In `auto` without a `spaceId` nothing changes.
Why: the 30 gold queries are fresh threads in `docs` mode; one preflight saves a model
turn (≈ 1.6 s) on every one of them, and it guarantees `routerPicksDocs`.

### 7.3 Prompts (`prompts.ts`)
`researchSystemPrompt` takes an optional `space?: { name: string; documents: string[] }`; when
present add, after the scope line:
`The user attached the Space "<name>" holding: <filenames>. Prefer search_documents for anything these could answer; use the web only for what they do not cover.`
In `docs` mode the scope line becomes
`Look only in the user's uploaded documents; do not call web tools.` (they are not offered anyway).
In `synthesisUserContent`, doc passages render as `[n] <filename>, p. N` (or `§ heading` / `line N`) with no url.

### 7.4 Registry and cost
- `SourceRegistry.add`: the dedupe key is `url` for web, `${docId}#${locatorKey}#${ord?}` for
  doc, where `locatorKey` is `p<page>` / `h:<heading>` / `l<line>`; carry `locator` and pass
  it through in `toSources` and `toPassages`. For a doc candidate `chooseSnippet` returns the
  whole chunk text (it is ≤ `CHUNK_CHARS + CHUNK_OVERLAP_CHARS`), never `bestPassage`.
  `toPassages` keeps doc passages whole, title `<filename>, p. N`. Ranking by overlap and
  `PASSAGE_LIMIT` apply unchanged. Existing `sources.test.ts` must stay green.
- Replace `providers.embedder.tokensUsed` in `totalCost` with a per-request counter:
  `ToolContext.addEmbeddingTokens(n)` that `search_documents`, `recall_memory`, `save_memory`
  call after each embed; `runQuickLoop` sums it. The `Embedder.tokensUsed` field can stay.

## 8. Health and logs
`/health` is unchanged (`vectorStore` already reports the backend). Boot log line in
`index.ts` gains `worker: child <pid> | none`. One `log.info` per job with
`{ docId, spaceId, pages, chunks, embedTokens, embedCostUsd, parseMs, embedMs, probeMs, probeAttempts }`.
Upload handler logs `{ docId, bytes, ms }`. Nothing else new at info level.

## 9. Tests (node:test, in-memory Mongo, fakes; see `test/routes.test.ts` for the bootstrap)
- `spaces.test.ts`: create → list; other user's space → 404; upload `.md` → 202 with
  `status: "pending"`, row visible with `pct: 0`, a `jobs` row `pending`; `.exe` → 400; a
  26 MB buffer → 413 (build the buffer in the test, do not commit a fixture).
- `ingest.test.ts`: `parse()` on `eval/gold/corpus/retrieval-basics.pdf` → page count matches
  `eval/gold/pages.json` and page 1 contains `The common default is 1.2`; `parse()` on
  `agent-loops-and-failure.md` → a unit whose heading section contains
  `three values, set explicitly at the call site`; `chunk()` never crosses a unit, respects
  overlap, drops empties; `indexDocument()` end to end with `FakeEmbedder` and the cosine
  backend → `indexed`, `chunks > 0`, chunk ids `${docId}:${ord}`; run it twice → same chunk
  count (upsert, no duplicates); a corrupt PDF buffer → document `failed` with a non-empty error.
- `retrieval.test.ts`: seed chunks with `FakeEmbedder` vectors, `search_documents` in a
  fake-LLM ask with `mode: "docs"` → `sources` event entries have `kind: "doc"`, `docId`,
  `locator`, snippet equal to chunk text; the trace has a `search_documents` step first;
  no `spaceId` → tool step `ok: false` and the answer cites nothing; registry keeps two
  chunks of one doc as two numbers.
- Worker sweep and claim: a unit test on the claim/sweep functions with two fake workers →
  one job claimed once; a stale `running` row returns to `pending`.

## 10. Acceptance (I run these; the builder runs the first two before reporting)
1. `npm run typecheck && npm test` in `backend/agent` (all green, ≥ 45 tests).
2. Local, real providers, from `Claude_Build/`: start agent (worker child appears in the log)
   and gateway; `python3 bin/upload.py eval/gold/corpus/*.pdf eval/gold/corpus/*.md` creates a
   Space, uploads all four, and prints per-file `202 ms` and time to `indexed`. Expect `202`
   under 300 ms and `indexed` in under 60 s each on Atlas.
3. `python3 bin/recall.py <spaceId>` asks all 39 gold questions in `docs` mode through the
   gateway and scores recall@5 exactly the bench's way (stem match + page or anchor on the
   first five doc sources). Target ≥ 0.80 locally so the bench's 30-question subset clears
   0.70 with margin. It prints the misses with the top-5 locators so we can tune chunking.
4. One `mode: "auto"` question with the `spaceId` → trace shows `search_documents` first and a doc source.
5. Upload `fixtures/bench-60p.pdf` (the bench's own 60-page PDF, sha256 in `fixtures/README.md`)
   while running two `ask.py` web questions → search p95 during ingest ≤ 1.3× idle, read from the
   agent log. Record idle and during-ingest numbers with the fixture hash.

## 11. Out of scope here, so do not build it
Deep search (part B). Web PDFs in `fetch_page` (a follow-up that reuses `ingest/parse.ts`).
Document delete or replace. A second synthesis model. Any gateway change. Any deploy config.

## 12. Report back with
The file list with one line each; test counts before and after; the exact pdfjs import and
options that worked on Node 22; how the child process is spawned under tsx and under node;
measured `202` ms and time-to-indexed for the four corpus files; anything you could not do,
stated plainly rather than worked around.
