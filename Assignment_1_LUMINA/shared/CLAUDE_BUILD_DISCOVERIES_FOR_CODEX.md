# LUMINA — discoveries from the Claude build, relevant to the Codex build

Compiled 2026-09-15 by Claude for a possible Codex restart (Kurt's call, post-Friday). These are
things the Claude build learned the hard way that the same spec will hit again. Scope: project
`lumina-a1`. Evidence lives in `Claude_Build/docs/WRITEUP.md`, `docs/reviews/`, and the run logs.

## The one that matters most
**Measure with the grader's own harness (`eval/eval.mjs --deploy-url <gateway>`), not only your
own ask script.** Claude's own `ask.py` was green on every number that mattered; four full bench
runs found four real defects it structurally could not see, because the bench does things you
never do by hand. Run the grader's path early and often.

## The four defects the bench found (all will recur on this spec)
1. **TTFT is model turns, not search.** Telling the model "you are in web mode" and then spending
   a model turn on whether to search burns ~2 s learning what the mode already said. Preflight the
   first search on the user's own words when the question stands alone, inject it as a real
   `tool_use`/`tool_result` pair, and skip the research turn. Gate the fast path on "fresh thread
   OR a standalone question", not `history.length===0` — the bench sends all 40 web queries down
   ONE thread, so a fresh-thread gate takes the slow path 39/40 times.
2. **An instruction is not a question.** If the fast path fires on a "remember X" probe, the
   research loop runs zero model turns and `save_memory` is never offered, so memory silently
   fails. Detect memory instructions and keep their model turn; also recall memory as the loop's
   own first step, not a tool the model must think to call.
3. **Markdown is not page text (grounding).** Tavily returns markdown; the grader scores against
   tag-stripped HTML. Snippets opening with `[x](y)` or `#` match nothing. Clean raw content to
   plain text (keep link text, drop syntax); drop video/login-walled hosts as non-citable; raise
   the min snippet length. The 6-hour search cache holds dirty rows, so clean AGAIN when the tool
   registers a result, not only in the provider.
4. **A 204 is not JSON.** The agent answers `DELETE /memory/:id` with a bodiless 204; a gateway
   JSON proxy that assumes a body turns it into a 502 and fails all three memory gates. Only the
   full chain shows this; no agent-level test can.

## Gate mechanics that bite
- **Cache-repeat gate:** a verbatim repeat must report `searchCached: true`. If your search query
  is model-rewritten each run, the normalized cache key differs and it never hits — one classmate
  fails exactly here. Preflight on the user's words fixes it. (Verified live on ours: cold false /
  1100 ms → repeat true / 5 ms.)
- **Gate 3 (trajectory) reads `runs/` before gate 4 runs the bench.** An emptied `runs/` fails a
  green smoke. Sort error runs to `runs/failing/` at WRITE time; capped runs stay visible in
  `runs/` (a cap is a truthful outcome).
- **`/health` must name model, search provider, vector store, db.** The grader reads it.
- **`sources` before the first token, every answer.** Deep must stream the `plan` frame first.

## Provider / infra notes
- **Haiku 4.5 prompt-cache minimum is 4,096 tokens.** A ~1,100-token system prefix never caches;
  do not chase caching below the floor.
- **Retry boundary = the first stream event, not the stream call.** The SDK returns the stream
  object before the request fails. Turn SDK retries OFF; use an explicit policy: ≤2 retries, each
  wait capped (~2 s) regardless of the provider's `retry-after`, only before the first token,
  abortable on client disconnect.
- **Every tool call under a hard deadline (~20 s):** a timed-out tool is a failed step carrying an
  error, never a run that hangs until the wall clock.
- **Wrap retrieved page text as an untrusted-source boundary** — data to cite, not instructions to
  follow. Cheap prompt-injection defence the rubric rewards implicitly.
- **Ingest: never mark a document `indexed` before a read-your-write probe** confirms the chunk is
  searchable (Atlas Search lags writes ~3 s). Probe with the chunk's own embedding via the same
  `$vectorSearch` the tool uses; fail loudly if it never appears.
- **Deploy shape:** agent private (no public IP), gateway public with auto-stop OFF (so a cold
  start is not timed as the app); write run logs to Mongo AND disk so the eval reads exported runs
  rather than an ephemeral machine's disk.

## Model split (if Codex wants to A/B)
Claude ran a 12-question-per-arm A/B and shipped Haiku everywhere except the DEEP answer, which is
Sonnet 5. Pay for the pricier model only where the difference shows; the quick/docs answers were
indistinguishable. Account `costUsd` per call per model from the usage block Anthropic returns.

## What classmate deployed builds got wrong (reviewed grader's-eye, 2026-09-15; see docs/reviews/)
- **A served report goes stale while the page still claims the score.** One build shows 85/85 from
  9/11 but the live app degraded under it (empty sources, 23 s TTFT). Re-run the eval the morning
  of submission; trust the live app, not the stored JSON.
- **P1 trajectories left as "MISSING" placeholders** cost 5 manual points that "cannot be skipped".
- **`report.json` = `{}`** fails the whole rubric; validate it against the zod `EvalsReport` before
  publishing.
- **Tavily pay-as-you-go exhaustion** takes the whole app offline; watch the balance near the
  deadline.
- **Editing a provided folder is an automatic fail** (`web/ packages/ benchmark/ eval/ quality/
  scripts/`). Kurt chose to leave `benchmark/sla.json` and `quality/rules.json` untouched even
  though their comments invite edits; P2 stays a warning, explained in the run notes.
