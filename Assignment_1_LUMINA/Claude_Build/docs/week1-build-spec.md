# Week 1 build spec — Claude_Build (written 2026-09-11 by Claude, session 3)

Read alongside `DESIGN.md`, `TECHNICAL.md` Part 1–2, `AGENTS.md`, and `packages/contract/src/*`.
The contract is law: every response body and SSE frame must parse with its zod schema.

## Hard rules (automatic fail if broken)
- Never edit `web/`, `packages/contract/`, `benchmark/`, `eval/`, `quality/`, `scripts/`.
- Never loosen a cap or threshold. Caps come from `env.ts`; do not raise defaults.
- No key is ever logged, returned, or written to disk. `/health` names the model, never a key.
- Fail loud: a provider exception ends the run with `terminated: "error"` + `502` (or an
  `error` SSE frame if headers are out). Never a try/catch that returns a plausible answer.
- A quick run may never call `plan_research`. Enforce in the loop, not the prompt.
- Do not add npm dependencies. Installed and available: `@anthropic-ai/sdk` 0.125,
  `mongodb-memory-server` 11 (dev), plus the starter's `mongodb`, `jsdom`,
  `@mozilla/readability`, `openai`, `pino`, `zod`, `express`, `multer`, `pdfjs-dist`.
  If you truly need another, stop and report; do not install.

## Situation
No provider keys and no Atlas exist until tomorrow (2026-09-12). Build every provider
behind an interface with a real implementation (Anthropic, Tavily, OpenAI embeddings)
and a fake used for local runs and tests. Everything must be exercisable end to end today
with `LLM_PROVIDER=fake SEARCH_PROVIDER=fake` and no `MONGODB_URI` (in-memory Mongo).
Tomorrow the switch is env vars only. Keep the fakes minimal and scripted per test; do not
tune anything to the fake.

## Runtime decisions (from DESIGN.md v1.0)
- LLM: Anthropic direct, model id `claude-haiku-4-5`, via `@anthropic-ai/sdk`, manual
  tool-use loop (not the tool runner: we need per-step trace, timing, caps). No extended
  thinking. Streaming for the synthesis call. `max_tokens` 1024 for tool-decision calls,
  4096 for synthesis.
- Rates in one file `src/config/model.ts`: input $1.00/MTok, output $5.00/MTok, cache
  write $1.25/MTok, cache read $0.10/MTok. `costUsd` = usage tokens × rates, summed across
  every LLM call in the request, plus `search_usd_per_call` (0.008) per uncached search.
  Embedding cost $0.02/MTok when embeddings run.
- Search: Tavily REST (`POST https://api.tavily.com/search`, header
  `Authorization: Bearer <key>`, body `{query, max_results: 5, include_raw_content: true}`),
  no SDK. Raw content from the search response counts as fetched page text; `fetch_page`
  (readability + jsdom, 8 s timeout, 1.5 MB cap) is for pages the search did not extract.
- DB: `mongodb`. When `MONGODB_URI` is empty and `NODE_ENV !== 'production'`, start
  `mongodb-memory-server` once per process and use its URI; log one warning; `/health`
  reports `vectorStore: "mongo-cosine-scan"`. Also honor `VECTOR_BACKEND` from env.
- Worker: child process of the agent (Week 2). Do not build it this week; leave `worker.ts`.

## Agent service — build in this order, curl-verify each before the next

### 1. Provider layer `src/providers/`
- `llm.ts`: `interface LlmProvider { name; model; complete(req): AsyncIterable<LlmEvent> }`
  where req = `{system, messages, tools?, maxTokens, signal}` and LlmEvent is one of
  `{type:'text', text}`, `{type:'tool_use', id, name, input}`, `{type:'usage', input, output, cacheRead, cacheWrite}`,
  `{type:'stop', reason: 'end_turn'|'tool_use'|'max_tokens'}`.
  Messages use Anthropic's content-block shape (text, tool_use, tool_result) so the loop
  stores history once.
- `anthropic.ts`: real implementation using `client.messages.stream(...)` and its events.
  Put `cache_control: {type:'ephemeral'}` on the system prompt block and the tools array.
- `fake-llm.ts`: scripted. Constructed with a list of turns; each turn is either
  `{tool: name, input}` or `{text: '...'}`. Emits usage `{input: 100, output: 50}` per call.
  Selected when `LLM_PROVIDER=fake`. Default script (when no test script): one
  `web_search` with the user query, then a text answer citing `[1]` and `[2]`.
- `search.ts`: `interface SearchProvider { name: 'tavily'|'serpapi'|'fake'; search(q, signal): Promise<SearchResult[]> }`
  with `SearchResult = {title, url, snippet, content?: string}`.
  `tavily.ts` real; `fake-search.ts` returns two deterministic results whose `content` is
  a few paragraphs mentioning the query.
- `embeddings.ts`: `interface Embedder { model; embed(texts): Promise<number[][]> }`.
  `openai-embeddings.ts` real (`text-embedding-3-small`, 1536 dims); `fake-embeddings.ts`
  returns a deterministic hash-derived unit vector of 1536 dims.
- `index.ts` in providers: `makeProviders(env, secrets)` picks by env; throws at startup if
  a real provider is selected and its key is empty (fail loud, at boot, with the var name).

### 2. Tools `src/tools/`
Each tool: `{name, description, input_schema (JSON schema), run(input, ctx): Promise<ToolResult>}`
where `ToolResult = {ok: true, content: string, sourcesAdded?: number[]} | {ok: false, error: string}`.
`ctx` carries userId, threadId, requestId, spaceId, depth, the providers, the source
registry, the search cache, and a logger.
- `web_search`: through the cache (§3). Registers each result as a source candidate
  (url, title, fetched text = `content` if present). Returns to the model a numbered
  list `[n] title — url — first 300 chars`.
- `fetch_page`: fetches a url already seen in this request (refuse others: "url not in
  this request's results"), readability text, registers/updates the candidate's text.
- `recall_memory`, `save_memory`: implement against `memories` with the Embedder and a
  cosine scan (Week 1: `mongo-cosine-scan`; add `$vectorSearch` when Atlas exists behind
  the same function, selected by `env.vectorBackend`). `save_memory` only writes; the
  system prompt says when to use it (stable facts/preferences only).
- `search_documents`: present in the registry, returns `{ok:false, error:'document search not available yet'}`
  this week so a trace shows it honestly. Not offered to the model when mode is `web`.
- `plan_research`: NOT built this week; the loop refuses it for quick regardless.

Tool availability by mode: `web` → web_search, fetch_page, recall_memory, save_memory.
`docs` → search_documents, recall_memory, save_memory. `auto` → all four plus
search_documents. The model's tool list is filtered before the call.

### 3. Search cache `src/cache/`
Key = sha256(`${normalize(query)}|${provider}`), normalize = lowercase, trim, collapse
whitespace, strip trailing punctuation. Tier 1: in-process LRU (write your own, max 500,
respects `expiresAt`). Tier 2: `searchCache` collection with TTL index on `expiresAt`
(create with `expireAfterSeconds: 0` at startup; idempotent). TTL from env (21600 s).
Bypass both tiers when the query contains "today", "latest", "now", "current", or a
four-digit year ≥ current year; a bypassed search counts as uncached.
`searchCached` in `done` is true only if every search in the request was a hit (and there
was at least one search).

### 4. Source registry and grounding `src/loop/sources.ts`
Per request. Candidates are numbered in order of first appearance, 1..N, never renumbered.
When the loop reaches synthesis, it emits `sources` = every candidate that has fetched text,
with `snippet` chosen BY THE LOOP: the sentence or passage (≤ 300 chars, ≥ 40 chars) of
the candidate's fetched text with the highest term overlap with the query, taken verbatim.
Never let the model write a snippet. Candidates with no text (search hit without content,
never fetched) get the search snippet only if it appears verbatim in fetched text; otherwise
they are dropped and the model is told which numbers are citable. After synthesis, compute
`unresolvedCitations(answer, sources)` from the contract; if non-empty, log a warning with
the numbers and the requestId (do not alter the streamed text).

### 5. The quick loop `src/loop/quick.ts` and prompts `src/loop/prompts.ts`
Two phases, both bounded by the gear's caps (`maxToolCalls`, `maxWallClockSec`) from env,
checked before every tool call and every LLM call. Wall clock includes both phases.
- Phase 1, research: system prompt tells the model to gather what it needs with tools and
  to reply with only a short plain-text "ready" when it has enough (no answer text). Loop:
  LLM call → for each `tool_use` block run the tool (parallel blocks allowed; return all
  `tool_result` blocks in one user message; `is_error: true` on failure) → emit one `trace`
  event per tool call `{step, tool, input, ok, ms, reason, error?}` where `reason` is the
  text the model wrote before the tool call, or "model requested" if none. Stop when the
  model returns no tool_use, or the cap is hit (then `terminated: 'cap'`).
  Latency matters: the bench's TTFT is measured to the first `token` event, target p95
  2.5 s. So: do not add LLM round-trips that the query does not need; when `mode` is
  `web` and the thread has no prior messages, the loop MAY issue the first `web_search`
  itself with `reason: "mode=web: search first"` before asking the model anything, then
  give the model the results and let it decide whether to fetch more or stop.
- Phase 2, synthesis: emit `sources`. Then one streaming LLM call, no tools, system prompt
  for synthesis, user content = the question, the thread history (last 10 messages), and
  the numbered passages. Stream every text delta as a `token` event. Instruct: cite with
  `[n]` using only the listed numbers, every factual sentence cites, say plainly when the
  sources do not answer the question and cite nothing in that case.
- `done`: `{answerId, latencyMs, ttftMs, model, tokens:{in,out}, costUsd, searchCached, terminated, depth:'quick'}`.
  `ttftMs` = ms from request start to the first token frame.
- Error path: provider throws before headers → `502` JSON `ErrorBody`. After headers →
  `error` frame `{status: 502, error}` then end. Either way write the run log with
  `terminated: 'error'`.
- SSE: copy `backend/gateway/src/sse.ts` into the agent (headers, flush per frame);
  compression is never used on this route.
- Prompts live only in `prompts.ts`, exported as functions of (mode, depth, memories).

### 6. Routes `src/routes/`
- `POST /threads` → `{threadId}` (newId('thr')), title from body or "New thread".
- `GET /threads` → list for this user, newest first. `GET /threads/:id` → messages;
  404 if not this user's.
- `POST /threads/:id/ask` → validate `AskBody`; persist the user message; run the loop;
  persist the assistant message with `sources`, `answerId`, `done`; write the run log.
  If `depth === 'deep'`: respond `501 {error:"deep search not built yet"}` this week.
- `GET /memory`, `DELETE /memory/:id` per contract.
- `GET /stats` → computed from `requests` for this user: requests, answers,
  searchCacheHitRatePct, ttftP95Ms, costUsdToday (UTC day), deepToday, deepDailyCap.
- `/spaces*` stay 501 this week. `GET /evals/report.json` stays 404/501 for now.
- Every route reads `x-user-id`; missing → `401` (the gateway checks first, the agent
  checks again because a cap you can bypass is not a cap).

### 7. Run log and request ledger `src/runlog.ts`
After every ask, whatever the outcome: write `runs/<requestId>.json` in the `RunLog` shape
(validate with the contract's zod before writing; `tokens` = in + out; `toolCalls` in
order with `name, ok, error?, ms`), insert the same plus ids into `runs`, and insert a
`RequestDoc` row into `requests`. One pino info line per answer with
`requestId, toolCalls, terminated, tokens, costUsd, searchCached, ttftMs, latencyMs`.

### 8. Store `src/store/`
Thin functions over collections named in `COLLECTIONS`; ensure indexes at startup:
`threads(userId, createdAt)`, `messages(threadId, createdAt)`, `memories(userId)`,
`searchCache(expiresAt) TTL`, `requests(userId, createdAt)`. Every doc carries `userId`
and `createdAt`.

### 9. Tests `backend/agent/test/*.test.ts`, run with `node --import tsx --test test/`
Add `"test"` script to the agent package.json. Cover: cache key normalization and bypass
words; snippet selection is verbatim and within bounds; the loop with a scripted fake
emits events in contract order (trace* → sources → token* → done) and each frame parses;
cap enforcement stops at `maxToolCalls` with `terminated:'cap'`; a throwing fake produces
`terminated:'error'`; run log validates against `RunLog`; quick refuses `plan_research`.

### Verification before reporting done
```
npm run typecheck -w @lumina/agent && npm test -w @lumina/agent
LLM_PROVIDER=fake SEARCH_PROVIDER=fake npm run dev:agent   # in background
curl -s localhost:8000/health
curl -s -X POST localhost:8000/threads -H 'x-user-id: dev'
curl -N -X POST localhost:8000/threads/<id>/ask -H 'x-user-id: dev' -H 'content-type: application/json' -d '{"query":"What is Tavily?","mode":"web"}'
ls runs/ && node quality/check.mjs .
```
Report: what was built, every command's actual output summary, what is untested because
it needs a key, and any contract ambiguity you resolved and how.

## Gateway — `backend/gateway/src/`, independent of the agent's internals
1. `X-User-Id` on every route but `/health` → `401 ErrorBody` with requestId.
2. zod validation with the contract's body schemas (`CreateThreadBody`, `AskBody`,
   `CreateSpaceBody`) → `400` with the first zod issue message.
3. Per-user rate limit: fixed window per minute, `env.rateLimitPerMinute`, in-memory Map,
   `429 ErrorBody` with `resetsAt` (ISO). `/health` exempt.
4. Proxy every contract route to `env.agentUrl + path` with method, JSON body, and
   headers `x-user-id`, `x-request-id`, `content-type`. Copy upstream status and JSON
   body back. For `POST /spaces/:id/documents` stream the raw request body through
   untouched (multipart; do not parse). Timeout 15 s for JSON routes.
5. `POST /threads/:id/ask`: SSE pass-through. Set the SSE headers from `sse.ts`, pipe
   the upstream body chunk by chunk with a flush per chunk, no buffering, no compression.
   If the upstream returned a non-2xx before streaming, forward its status and JSON body.
   If the upstream connection fails, `502`. If the client disconnects, abort upstream.
   Timeout for the stream: `MAX_WALL_CLOCK_SEC_DEEP` + 10 s.
6. Upstream fetch failure or non-JSON body on a JSON route → `502 ErrorBody`, never 2xx.
7. `GET /evals/report.json`: if `../../reports/latest.json` exists serve it, else proxy.
8. Keep `/health` and the static hosting as provided.
Tests `backend/gateway/test/*.test.ts` with `node --import tsx --test test/`: 401, 400,
429, 502 when agent is down, and SSE pass-through ordering against a tiny stub agent
started in the test on a random port. Add `"test"` script to the gateway package.json.
Verify: `npm run typecheck -w @lumina/gateway && npm test -w @lumina/gateway`.
