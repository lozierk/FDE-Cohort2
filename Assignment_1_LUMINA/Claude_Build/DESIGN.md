# DESIGN.md — LUMINA (Claude build)

> v1.5, 2026-09-15. Drafted 2026-09-09 as v0.1; the two open trade-offs (LLM provider, worker
> placement) were decided by Kurt on 2026-09-11 as v1.0. v1.1 updates the design to match the
> week 2 build: Spaces, ingest, hybrid retrieval, and deep search are now running. v1.2 applies
> the docs-mode preflight rule to web mode (Kurt, 2026-09-14); v1.3 adds Sonnet 5 for the deep
> answer only, trade-off 9; v1.4, after the first full bench: the fresh-thread gate on the
> preflight becomes a standalone-question check, memory recall becomes the loop's own first
> step, memory requests keep their model turn, and Tavily raw content is cleaned of markdown
> before a snippet is chosen; v1.5, deployed: auto mode with a Space that answered takes the
> docs fast path (trade-off 10). The five graded headings below are read by `eval/build-report.mjs`.

## Components

Seven pieces, four of them ours. **Web UI** (provided, untouched) runs on Vercel and only
ever talks to the gateway. **Gateway** is an Express service on a public Fly.io Machine: it
validates requests against the zod contract, rate-limits per `X-User-Id`, and streams SSE
through to the browser. **Agent service** is an Express service on a private Fly.io Machine
with no public address: it owns the agent loop, the tools (`web_search`, `fetch_page`,
`search_documents`, `save_memory`, `recall_memory`, `plan_research`), the provider keys, and
the spend gates. **Jobs worker** is a child process of the agent Machine that polls the `jobs`
collection and does the CPU-heavy work: PDF parsing, chunking, embedding, indexing, and the
read-your-write probe. **MongoDB Atlas** (one free M0 cluster, database `lumina_claude`) holds
threads, messages, memories, spaces, documents, chunks with their vectors, the `searchCache`,
`jobs`, `requests`, and GridFS originals. **Providers**: Anthropic direct for the LLM (Claude
Haiku 4.5, `claude-haiku-4-5`), OpenAI for embeddings, Tavily for web search.
**Run logs** are files, `runs/<requestId>.json`, written by the agent service per answer; they
carry state the grader reads and are the only component that is neither a service nor a
collection.

Spaces and document ingest are built. Upload writes to a GridFS bucket (`uploads`) and a `jobs`
row; the jobs worker is a forked child process of the agent service, not a thread on the request
path. It inherits the vector backend setting from its parent, restarts on crash with growing
backoff, and shuts down on `SIGTERM` alongside the parent. Consequence: the agent service needs a
long-lived host, which is why it stays off Vercel; the gateway can run on either Vercel or Fly.
Retrieval is hybrid: Atlas Vector Search plus an Atlas Search text index, fused with reciprocal
rank fusion, no re-rank step. Deep search (`depth: "deep"`) is built too: a forced planning call,
a bounded fan-out over sub-questions sharing one source registry, and a synthesis pass, detailed
under Communication and State below.

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

Parsing is page-aware: a chunk never crosses a PDF page or a Markdown section, one chunk per
page or section slice. Same-page chunks retrieved together merge into one source with a locator
(page or heading), and the snippet is the whole merged chunk text — the recall check keys on page
match and the grounding check keys on `docId` plus locator, top 5 only, so a query-chosen passage
would fail both. Deep search owns its own cap: it reserves one of `DEEP_DAILY_CAP` (5) credits per
user per UTC day before anything else runs, atomically, in a `deepQuota` collection; the credit is
refunded only if planning fails before any retrieval starts. The quick loop's research phase
(opener, preflight, tool loop) now lives in one shared function, `loop/research.ts`, that both
gears call; quick behavior is unchanged.

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
visibly `pending`; nothing is lost because the job row is the record. The worker stays inside
the agent app rather than a separate Fly app: see Trade-offs.

Docs mode answers straight from the preflight document search when it found anything; the model
may request at most `DOCS_EXTRA_SEARCHES` (1) more, enforced in the loop and stated in the trace
`reason`. That change took docs-mode TTFT p95 from 12.35 s to 1.62 s, because every recall hit
had already come from the preflight search.

Auto mode with a Space attached searches the Space first as well, and since v1.5 it also
answers straight from that search when it found anything. Until then auto kept its model turn
so the model could add the web; on the bench's mode=auto probe the model spent that turn on a
fetch of a doc source (rejected in 0 ms, doc sources have no URL), a web search and a page
fetch before answering: TTFT 6.9 s and 9.4 s in the two deployed runs of 2026-09-15, against
0.4–1.0 s for the same question in docs mode. Gate 2 of the provided eval is a five-query smoke
whose p95 is its slowest query, and it blocks every later gate, so that one turn failed the
grader's path outright. Empty retrieval keeps the turn in both modes.

Web mode now follows the same rule on a fresh thread: when the preflight search returns page
text for at least two results (`WEB_PREFLIGHT_MIN_SOURCES`), the loop goes straight to
synthesis. Before the change, 25 quick web runs showed the cold search at 1.3–2.9 s, each
research turn about 2 s, and a median of one extra fetch — TTFT 4.7–13 s against the 2.5 s p95
gate. After it, ten cold questions ran 1.8–3.6 s TTFT (median 2.4 s) and ten warm repeats
0.6–0.9 s, at $0.011–0.012 cold and $0.003–0.004 warm. What remains is Tavily itself:
1.0–2.3 s on a cold query whether or not raw content is requested (measured both ways, five
queries each), plus about 0.7 s to the synthesis call's first token. With half the bench
workload repeated, the bench's p95 lands on a cold query, so we expect about 3 s against the
2.5 s gate, and the miss is documented on `/evals` rather than bought with a looser cap. Under
the threshold — one page of text, or none — the model keeps its turn, to fetch or reformulate.
Follow-ups keep theirs too, and deep sub-questions always do.

"Fresh thread" turned out to be the wrong gate. The first full bench (2026-09-14 evening) sends
all 40 web queries down one thread, so 39 of them took the research turn: TTFT p95 12.8 s, the
answer p95 15.0 s, and a 10% search cache hit rate because the model rephrased every search.
The rule is now "fresh thread, or a question that stands on its own" (`loop/standalone.ts`):
fewer than four words, a continuation opener ("And …", "What about …"), or a pronoun in the
opening words or as the last word marks a follow-up, and everything else preflights on the
user's words. A wrong "standalone" costs one search and some off-topic passages next to the
history the synthesis always sees; a wrong "follow-up" costs the model turn every follow-up paid
before. All 20 bench questions pass the check, pronouns in the middle included; the twelve
follow-up shapes in `test/standalone.test.ts` do not. The lesson: measure with the grader's
harness, not only your own — `ask.py` opened a thread per question, and the bench does not.

The same bench failed every memory gate, for the mirror-image reason: the fast path takes the
model's turn away, and `save_memory` and `recall_memory` were tools only a model turn could
call. Two changes. An instruction about the user ("Remember this preference for all future
answers: …", `looksLikeMemoryRequest`) is not searched and keeps its model turn, which is
offered `save_memory`. And every quick run now recalls memory as its FIRST step, a real
`recall_memory` trace step the loop makes itself (one embedding, one Mongo scan, about
100 ms), whose lines go into the synthesis system prompt — so a preference saved in one thread
reaches the answer in the next without a model turn spent asking for it. A side effect worth
naming: the stream now always opens with that trace, so a model-provider failure on the first
call surfaces as the stream's `error` event rather than a 502 response.

Citation grounding was the third miss (0.913, gate 0.95), and the audit
(`scripts-local/grounding-audit.mjs`, which re-scores stored answers with the bench's own
matcher) put the failures in three bins. Nine snippets began with markdown the grader's
tag-stripped HTML never contains — `[Previous](/learn/bm25)`, `![](…)`, `# Heading` — because
Tavily's raw content is markdown; `cleanRawContent` in the provider now keeps the link text
and drops the syntax. Four were YouTube pages, whose "text" is a transcript the HTML does not
carry; video and login-walled hosts are no longer citable sources. The rest were short
snippets with one token the page serves as an entity (`isn&rsquo;t`), so `SNIPPET_MIN` rose
from 40 to 160 characters to leave a clean 12-token run on one side of any such token.

Two more from the third bench. The search cache holds results for six hours, so a cleaning
that lives only in the provider does nothing for a cached row: the web-search tool cleans
again as it registers a result. And a rendered formula is text we were given but never text
the grader's tag-stripper produces, so the passage chooser skips any sentence with more than
8% of its characters outside plain prose (`looksLikeMarkup`). The gateway had its own defect:
it mirrored the agent's bodiless 204 on DELETE /memory/:id as a "non-JSON body" 502, which
failed all three memory gates on a save and a recall that had in fact worked.

The remaining TTFT outliers were the queries whose search extracted text for fewer than two
results: the model's turn went one way every time (fetch the unread page), at 7.9 and 8.9 s
against 0.7 s for the other 38. The loop now fetches up to `WEB_PREFLIGHT_FETCHES` (2) such
results itself, as visible `fetch_page` steps, and skips the turn once the threshold is met;
a failed fetch is a failed step and the model keeps its turn as before.

Deep search sends its `plan` frame as the first paint, before any retrieval. The planner prompt
is deliberately terse — fifteen-word questions, six-word reasons — because output tokens are the
latency: 330–400 tokens measured at 3.0–4.9 s, about 245 tokens at 2.4–3.5 s, against a 4 s gate.
Sub-questions then fan out over a pool of `DEEP_CONCURRENCY` (3), sharing one source registry, one
tool-call ledger (cap 24, in-flight calls counted), and one wall clock (240 s). Each sub-question
preflights its own search and gets a per-sub budget derived from the plan size, so the shared cap
is never hit on finished work — six sub-questions get three calls each, five or fewer get four. A
failure in one sub-question aborts the others and ends the stream with an `error` frame. Merge is
free because there is one registry: one citation numbering, dedupe by url or `docId`+locator, each
source credited to the sub-question that found it first. Synthesis reads up to 4 passages per
sub-question, 20 total, grouped under the sub-question that found them, and writes a direct
answer, one section per sub-question, then "What is still unknown."

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
with backoff and the document fails loudly if it never becomes visible. Atlas Search lags
writes by about 3 s, so the worker waits for the probe rather than trusting the write. GridFS
uses one bucket per process, with indexes ensured at boot; without that, the first upload of a
process paid about 456 ms for driver index checks. `deepQuota` rows carry a TTL and expire two
to three days after the day they govern. `/stats.deepToday` counts request rows and is a
report; the quota collection is the gate, and the two can differ by refunded planning failures.

## Trade-offs

1. **Anthropic direct with Claude Haiku 4.5 instead of OpenRouter with GLM-4.6.** We are
   doing this for simplicity and speed. One vendor, one key, one SDK, and a model whose
   behavior on tool use and citations we already know, so the first working loop arrives
   sooner and debugging stays inside one system. Haiku 4.5 clears the graded cost gate of five
   cents per quick answer with room to spare, and first-party prompt caching keeps the system
   prompt and tool definitions cheap across a multi-step loop. Given up: the shared-model
   comparison with the Codex build, and the lower per-token price of an open-weight model on a
   pinned OpenRouter endpoint. That earlier plan (OpenRouter, `z-ai/glm-4.6` at one pinned
   provider, reasoning off) is recorded on the board as D-10 and stays a candidate for a later
   refactor once the build is stable; the provider call sits behind one module so the swap is
   contained.
2. **Atlas Vector Search instead of a dedicated vector store.** One document per citation and
   no second system to keep consistent, at the cost of the M0 three-index limit, which is why
   each build needs its own cluster.
3. **Worker as a child process on the agent Machine instead of a separate app.** Fewer moving
   parts and one deploy, at the cost of CPU contention during a large PDF and the risk that
   Fly stops a private Machine with jobs still pending. Chosen for simplicity; the bench is
   the tripwire. If it shows quick-search latency spikes during indexing, the worker becomes a
   separate app, and nothing in the job protocol has to change because the `jobs` collection
   is already the only interface between them.
4. **Measured tokens times published rates instead of a flat rate table.** `costUsd` is
   computed per call from the usage block Anthropic returns on every response (input, output,
   cache-write and cache-read tokens, each at its own rate for Haiku 4.5) and summed across
   the loop, so the graded number tracks what was billed, cache discounts included. Given up:
   the simplicity of the starter's `sla.json` price table, which stays as the documented
   fallback when a response carries no usage. The rates live in one config file with the model
   id, so a later model swap changes one place.
5. **Quick as the default with no server-side upgrade** is a requirement, not a trade-off,
   but it costs something real: a user who asks a deep question in quick mode gets a shallow
   answer, and the UI toggle is the only remedy.
6. **No re-rank step after hybrid retrieval.** Reciprocal rank fusion over Atlas Vector Search
   and Atlas Search already put every gold answer in the top 5 (recall@5 39/39 on the gold set),
   so a re-ranker would add a model turn — about 2 s on Haiku — for no measured gain. Given up:
   headroom against a harder or larger corpus than the gold set covers.
7. **The gateway rate limit is 300 requests per minute**, not the code default of 30, set by
   `RATE_LIMIT_PER_MINUTE` for the bench and the deployed gateway. The bench's own status
   polling during ingest would have tripped 30; the code default stays conservative for a
   deployment the bench doesn't drive. Measured week 2 numbers (Atlas, real providers): recall@5
   39/39; upload 202 accept 181–212 ms (gate p95 300); docs TTFT p95 1.62 s; docs cost $0.002 per
   answer; deep on the four bench questions: plan 2.4–3.5 s, distinct sources 2.7–7.0× the quick
   run of the same question (gate 2.0×), cost $0.086–0.137 (gate $0.35), wall clock 32–48 s (gate
   90 s); deep during a 60-page ingest ran in 31.8 s versus 47.9 s idle, and the document itself
   indexed in 11.9 s.
8. **Source numbers are assigned on first registration and never reassigned**, so the visible
   list can have gaps when a search result was never fetched. Kept on purpose: the research model
   already saw those numbers in tool results, and a stable number is worth more than a
   contiguous one.
9. **Two models, split by where the difference shows: Haiku 4.5 for planning, research and the
   quick answer; Sonnet 5 for the deep answer only** (`LLM_MODEL_SYNTHESIS_DEEP`; Kurt,
   2026-09-14, from an A/B of twelve questions per arm). Sonnet on the quick answer added
   0.3–1.2 s to first token on a 2.5 s gate already missed, and tripled the answer's cost
   ($0.008–0.013 vs $0.003–0.004 warm) for prose a reader could not tell apart; on the docs
   answers both arms hit all five gold facts. On the deep answer Sonnet cited 13–14 of the
   sources against Haiku's 7–9, wrote sections that read as one argument, and put the citation
   after the claim rather than before it, for 12–20% more cost ($0.080–0.093 vs $0.072–0.077,
   cap $0.35) behind a plan frame that is Haiku's either way, so deep first paint does not move.
   Each LLM call is priced against the model that made it, so a mixed run bills honestly, and
   `/health` names every model that can write an answer. Given up: one cache namespace across
   the run (caches are model-scoped; the deep synthesis prompt is unique per run anyway).

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

10. **Auto mode answers from the Space alone when the Space answered.** With a Space attached,
    `auto` used to search the documents first and then give the model a turn to add the web.
    Since 2026-09-15 a productive document search goes straight to synthesis, exactly as in
    docs mode, and the web is a mode switch away. What is given up: an auto question whose best
    answer needs both the attached documents and the web now gets the documents. What is gained:
    the mode=auto probe's TTFT drops from 6.9–9.4 s (a research turn the model spent on a
    doc-source fetch that cannot work, then the web) to the docs-mode 0.4–1.0 s, and the eval's
    smoke gate, which blocks on a five-sample p95 and blocks every gate after it, stops failing
    on that one question. When the Space returns nothing, auto still keeps its turn and can go
    to the web. Revert is one condition in `loop/research.ts`.
