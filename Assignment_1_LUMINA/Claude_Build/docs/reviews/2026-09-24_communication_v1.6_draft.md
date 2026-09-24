# DESIGN.md v1.6 — proposed Communication section (draft for Kurt's review)

Drafted 2026-09-24 by Claude in response to Jayita's "trim the Communication section". Nothing in
DESIGN.md has been changed; this file is the proposal. The current section is 8,098 characters
in nine paragraphs; this replacement is three paragraphs. Every fact below is already in v1.5;
no new claims. The seven displaced paragraphs move verbatim to a new non-graded section at the
bottom of the file (heading given at the end), so `eval/build-report.mjs` stops putting them on
`/evals` but the repo keeps the story.

---

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

Every quick run opens with two steps the loop takes itself, before any model turn. First a
`recall_memory` lookup (one embedding, one Mongo scan, about 100 ms) whose lines go into the
synthesis prompt, so a preference saved in one thread reaches the next without a turn spent
asking for it. Then a preflight search on the user's own words. Docs mode, and auto mode with a
Space attached, search the Space and answer straight from that search when it found anything;
the model may ask for at most one more (`DOCS_EXTRA_SEARCHES`). Web mode does the same when the
question stands on its own (`loop/standalone.ts`: a fresh thread, or no pronoun and no
continuation opener) and the search returned page text for at least two results
(`WEB_PREFLIGHT_MIN_SOURCES`); below that the loop fetches up to two thin results itself as
visible `fetch_page` steps (`WEB_PREFLIGHT_FETCHES`), and if still short hands the model its
turn. Follow-ups, deep sub-questions, empty retrieval, and an instruction about the user
(`looksLikeMemoryRequest`, which is offered `save_memory`) always keep the model turn. These
rules are what bought the TTFT gate: docs p95 12.35 s to 1.62 s; web cold 4.7–13 s to a
median of 2.4 s and warm repeats 0.6–0.9 s, at about $0.011 cold and $0.003 warm. What remains
is Tavily's 1.0–2.3 s cold search plus about 0.7 s to the synthesis call's first token. One
consequence worth naming: because the stream now opens with the recall trace, a model-provider
failure on the first call arrives as the stream's `error` event rather than a `502`. The
bench-by-bench story behind each rule is under "Bench-driven changes" at the end of this file.

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

---

## What moves, and where

Append after "Reading notes", as the last section of the file:

```
## Bench-driven changes (not graded; the story behind v1.2–v1.5)

The rules in Communication were each forced by a measured miss on the grader's own path.
Kept here in the order they happened, verbatim from the versions that introduced them.
```

followed by these seven paragraphs of the current Communication section, unchanged and in this
order:

1. "Docs mode answers straight from the preflight document search …" (v1.2, docs fast path, 12.35 s → 1.62 s)
2. "Auto mode with a Space attached searches the Space first as well …" (v1.5, the mode=auto smoke failure)
3. "Web mode now follows the same rule on a fresh thread …" (v1.2, the 25-run before/after and the Tavily floor)
4. ""Fresh thread" turned out to be the wrong gate …" (v1.4, the standalone check and "measure with the grader's harness")
5. "The same bench failed every memory gate, for the mirror-image reason …" (v1.4, memory-first step)
6. "Citation grounding was the third miss (0.913, gate 0.95) …" plus "Two more from the third bench …" (v1.4, the grounding audit's three bins, cache re-cleaning, the 204 mirror defect)
7. "The remaining TTFT outliers were the queries whose search extracted text for fewer than two results …" (v1.4, preflight fetches)

Header line to replace the v1.5 sentence in the file's blockquote:

> … v1.5, deployed: auto mode with a Space that answered takes the docs fast path (trade-off 10);
> v1.6, 2026-09-2x: Communication cut to protocols, fast paths and deep search on reviewer
> feedback; the bench-by-bench history moved, unchanged, to a non-graded section at the end.

## Size check

| | characters | share of graded text |
|---|---|---|
| Communication v1.5 | 8,098 | 40% |
| Communication v1.6 (this draft) | 3,769 | 27% |
| Components / Responsibilities / State / Trade-offs | 2,112 / 1,711 / 1,469 / 5,103 | unchanged |

## After Kurt approves

1. Edit DESIGN.md as above (one commit, "DESIGN v1.6: Communication trimmed on reviewer feedback").
2. Rebuild the report with the `build-report.mjs` line from `scripts-local/finish-report.sh` only
   (same flags; add `--video <url>` if the demo is ready), then `cp reports/report.json reports/latest.json`.
   Do not run the whole script: its export step would pull in every run since 9/15.
3. Kurt: `fly deploy -c fly.gateway.toml --remote-only`, then `scripts-local/assemble-public.sh` and push.
