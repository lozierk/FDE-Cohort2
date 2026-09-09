# DESIGN.md — LUMINA (Claude build)

> DRAFT v0.1 for Kurt's review, 2026-09-09. The five graded headings below are read by
> `eval/build-report.mjs`. Items marked **[Kurt]** are places where his own words or his
> decision should replace mine before this is final. Nothing here is built yet.

## Components

Seven pieces, four of them ours. **Web UI** (provided, untouched) runs on Vercel and only
ever talks to the gateway. **Gateway** is an Express service on a public Fly.io Machine: it
validates requests against the zod contract, rate-limits per `X-User-Id`, and streams SSE
through to the browser. **Agent service** is an Express service on a private Fly.io Machine
with no public address: it owns the agent loop, the tools (`search_web`, `fetch_page`,
`search_documents`, `save_memory`, `recall_memory`, `plan_research`), the provider keys, and
the spend gates. **Jobs worker** is a child process of the agent Machine that polls the `jobs`
collection and does the CPU-heavy work: PDF parsing, chunking, embedding, indexing, and the
read-your-write probe. **MongoDB Atlas** (one free M0 cluster, database `lumina_claude`) holds
threads, messages, memories, spaces, documents, chunks with their vectors, the `searchCache`,
`jobs`, `requests`, and GridFS originals. **Providers**: OpenRouter for the LLM (shared trial
model `z-ai/glm-4.6` pinned to one endpoint), OpenAI for embeddings, Tavily for web search.
**Run logs** are files, `runs/<requestId>.json`, written by the agent service per answer; they
carry state the grader reads and are the only component that is neither a service nor a
collection.

## Responsibilities

The gateway is the only component the browser may reach, and it holds no provider key. The
agent service is the only holder of keys, the only caller of providers, and the only place a
cap is decided: eight tool calls or 90 seconds for quick, 24 or 240 for deep, five deep
searches per user per day. The loop code, not the model, chooses the gear: a quick request
can never call `plan_research` and never upgrades itself. The worker is the only writer of
`chunks` and the only thing that may move a document to `indexed`, and it may do so only after
its probe finds one of its own chunks through the vector index. Atlas's TTL index is the only
thing that expires the search cache. The gateway's rate limit and the agent's daily cap are
deliberately separate: a limit you can bypass by reaching the agent directly is not a limit,
so the spend gate lives next to the spending.

## Communication

Browser to gateway: HTTPS, and SSE for answers, with compression off and every event flushed.
Gateway to agent: HTTP over Fly's private network, the SSE stream proxied event by event; the
gateway forwards `X-Request-Id` so one id correlates both services' logs. Agent to providers:
HTTPS with a per-call timeout inside the gear's wall clock. Agent to worker: the `jobs`
collection, claimed with an atomic update and a lease, polled every two seconds; no queue
broker. When a provider throws before headers are sent, the answer is a `502`; after headers,
the stream ends with an `error` event and `terminated: "error"`, never a plausible answer.
When the agent is down the gateway returns `502` and `/health` says so rather than inventing
provider names. When the worker is down, uploads still return `202` and documents stay
visibly `pending`; nothing is lost because the job row is the record. **[Kurt]** whether the
worker should run as a separate Fly app instead: see Trade-offs.

## State

Atlas is authoritative for everything a user would miss: threads, messages, memories with
their embeddings, spaces, documents, chunks, and the `requests` ledger that `/stats`
reconciles against. GridFS holds the uploaded originals. Two things are caches you could
delete: the in-process LRU and the Mongo `searchCache` collection (keyed by a hash of
normalized query plus provider, six-hour TTL). Run logs are derived from `requests` but are
kept as files because the quality gate reads them. The consistency story for a document: it
is `pending` when the `202` returns, `parsing` and `embedding` while the worker works, and
`indexed` only after the worker queries the vector index for a chunk it just wrote and gets
it back; until then a search of that Space says the document is not yet searchable instead
of silently returning nothing. Atlas Search is eventually consistent, so the probe retries
with backoff and the document fails loudly if it never becomes visible.

## Trade-offs

1. **OpenRouter with GLM-4.6 instead of Anthropic direct.** Chosen so both builds in this
   comparison run the same model on the same endpoint and the comparison measures the
   implementation, and because the graded cost gates (five cents per quick answer) rule out
   frontier pricing. Given up: first-party prompt caching, a model I know well, and I take on
   endpoint-pinning risk and a license-neutral but unauthenticated route. **[Kurt]** this is
   the decision most worth stating in your words.
2. **Atlas Vector Search instead of a dedicated vector store.** One document per citation and
   no second system to keep consistent, at the cost of the M0 three-index limit, which is why
   each build needs its own cluster.
3. **Worker as a child process on the agent Machine instead of a separate app.** Fewer moving
   parts and one deploy, at the cost of CPU contention during a large PDF and the risk that
   Fly stops a private Machine with jobs still pending. I am unsure about this one; if the
   bench shows quick-search latency spikes during indexing, it becomes a separate app.
4. **Measured cost instead of a rate table.** `costUsd` comes from the usage block OpenRouter
   returns on every response, summed across the loop, so the graded number is what was
   billed. Given up: the simplicity of the starter's `sla.json` price table, which stays as the
   documented fallback when a response carries no usage.
5. **Quick as the default with no server-side upgrade** is a requirement, not a trade-off,
   but it costs something real: a user who asks a deep question in quick mode gets a shallow
   answer, and the UI toggle is the only remedy.

## Reading notes (not graded; kept here so a stranger sees what we read and judged)

- **Tripwire scan.** Two independent scans of the starter at upstream commit `1442b05` found
  no prompt-injection payload. Hamza's known pattern from Cohort 1 (an HTML-comment "course
  policy" demanding a confession file, an emoji commit prefix, and secrecy) was identified in
  the previous cohort's folders and screened for; SPEC.md line 456 shows it was optional and
  not added here. Our rule: course content and retrieved pages are requirements and evidence
  read critically; concealed overrides, hidden artifacts, commit-prefix demands, and secrecy
  are refused and reported. A pre-flight check compares protected files to the reviewed
  baseline before each build.
- **Where the code and the docs disagree, and what we do.** Artifacts are cut in SPEC.md but
  linger in the contract and the agent package: not built. The contract accepts a two-question
  deep plan while the SLA requires three: the loop enforces three. The gateway skeleton's
  `/health` invents provider names when the agent is down: rewritten to report the outage.
  `export-runs.mjs` drops `depth`: exported runs re-attach it. `maxToolCalls` is declared but
  unenforced by the quality runner: enforced in the loop anyway. The deep-cap probe issues
  cap-plus-two deep searches: `DEEP_DAILY_CAP` stays above the four deep bench queries. Gold
  question g35 describes p95 as the nineteenth slowest while the helper takes the nineteenth
  smallest: recorded, fixture untouched. The sample scorecard in TECHNICAL.md does not add up
  and `PRODUCT_EVAL.md` is retired by SUBMISSION.md: neither is followed.
