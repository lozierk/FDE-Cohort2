# Audit: Jayita's cohort review of LUMINA submissions, and what it means for our build

Written 2026-09-24 ≈ 09:00–10:00 ET by Claude for Kurt. Source: the Maven "Build a Perplexity
Clone" channel, 28 submissions and all 27 of Jayita Chatterjee's replies (captured in full via the
page's chat client, saved verbatim in `2026-09-24_maven_submissions_and_jayita_replies.md`).
Checks against our own build were made this morning against the live deployment and the repo;
each is labelled **verified** or **inferred**. No files outside `docs/reviews/` were changed.
**Keep this file out of any public repo: it quotes classmates' work and an instructor's private-channel feedback.**

## Overview

Jayita reviewed every submission in one sweep on 2026-09-23 between 11:24 AM and 12:59 PM ET,
newest post first. Her review of ours opens with "outstanding work", names three things she
liked (measured Haiku/Sonnet split, keeping the 45 ms miss, the page-size cap and
runs/failing/ notes) and asks for three polish items, all hygiene, none a product defect:

1. **Trim the Communication section of DESIGN.md.**
2. **Stop committing `reports/`.**
3. **Add the demo video to the report.**

Of 27 reviews, ours is one of four with no product or engineering defect named (the others:
Raj, Beat, Juan, each of whom still got one product ask). Nine builds were told to fix
grounding or fail-loud behaviour, seven failed her canonical probe "who is president of USA?",
and eleven were told to write trajectory notes in their own words. **Our build passes her probe
today** (verified below). The three asks are each under an hour of work; the recommended
sequence and a draft reply are at the end.

Since her sweep, four classmates have already posted fixes in their threads (Muthukumar,
André, Silvio, Xiaoya), which suggests she re-reads threads. A reply from us after the fixes
is worth posting.

## Part 1 — Jayita's three items for our build

### 1. "Trim the Communication section of DESIGN.md"

**What she is seeing (verified).** The graded Communication section is 8,098 characters over
about 100 lines, 40% of all graded design text, and nearly four times the size of Components
(2,112) or Responsibilities (1,711). Only its first paragraph and its last (deep search) answer
the design question "how do the pieces talk". The middle seven paragraphs are a changelog of
bench-driven changes from v1.2–v1.5: the docs-mode preflight, the auto-mode incident, the web
preflight with its before/after numbers, the "fresh thread was the wrong gate" lesson, the
memory-gate fixes, the three grounding-audit bins, the cache-cleaning and 204-mirroring
defects, and the TTFT outlier fetches. Good material, wrong heading.

**Proposed shape (about 2,500 characters, a 70% cut).** Keep three paragraphs:

- *Protocols and failure semantics* — the existing first paragraph, unchanged.
- *Fast paths* — one compact paragraph: docs and auto-with-Space answer straight from the
  preflight document search when it found anything; web mode on a standalone question
  (`loop/standalone.ts`) answers from the preflight web search when at least two results carry
  page text, fetching up to two thin results itself; memory is recalled as the loop's own first
  step; a memory instruction keeps its model turn. One sentence on what each rule cost and
  bought (TTFT 12.35 s → 1.62 s docs; 4.7–13 s → median 2.4 s web), with the numbers pointing
  to the bench, not retold.
- *Deep search* — the existing last paragraph, unchanged.

Move the displaced narrative, verbatim, to a new non-graded section under "Reading notes",
e.g. `## Bench-driven changes (not graded; the story behind v1.2–v1.5)`. Nothing is deleted;
`eval/build-report.mjs` reads only the five graded headings, so the moved text leaves the
/evals page and stays in the repo for anyone who reads DESIGN.md. Bump the header to v1.6 with
one changelog line ("Communication trimmed on reviewer feedback; the change history moved to a
non-graded section").

**How it reaches /evals (verified).** The served report embeds the design text, so the page only
changes after a rebuild. `scripts-local/finish-report.sh` re-exports runs from the deployment
and re-sorts failures before it builds; running it whole would pull in every run since 9/15,
including this morning's probe and any visitor traffic, and could move the quality checks.
Rebuild with the `build-report.mjs` line alone (same flags, plus `--video`), then
`cp reports/report.json reports/latest.json` and redeploy the gateway. No bench re-run, so no
re-roll; the 85/85 and the 45 ms miss stay exactly as measured.

**Related, optional.** Trade-offs is 5,103 characters over ten items. She told Julia to "trim
the trade-offs to your strongest four" and Yasemin to add "at least three", so her range is
roughly three to six. She did not ask us to cut it. If Kurt wants the page tighter, keep
trade-offs 1 (LLM provider), 2 (worker placement), 9 (Sonnet for the deep answer) and 10 (auto
fast path) as the graded four and move the rest below with the same non-graded treatment.

### 2. "Stop committing reports/"

**What she is seeing (verified).** Our working repo ignores `reports/` (the starter's
`.gitignore` does, and `git ls-files reports` is empty). The public snapshot is different on
purpose: `scripts-local/assemble-public.sh` copies `reports/latest.json` in and appends a
`.gitignore` exception with the comment "the served report is evidence, keep it". So
`github.com/lozierk/Claude_Build_Submission` carries one file, `reports/latest.json` (38 KB),
and that is the one she saw. Her rule is the starter's convention: the report lives at
`/evals`, the repo carries code and design.

**Options.**

- **(a) Remove it, recommended.** Drop the two lines in `assemble-public.sh` (the `cp` and the
  `.gitignore` append), `git rm --cached reports/latest.json` in the snapshot, commit, push.
  The live `/evals` page remains the evidence, and the git tag on the snapshot already pins
  which code produced it. Cheapest, and exactly what she asked.
- **(b) Keep a frozen copy, renamed.** If Kurt wants an immutable record in the repo (the
  reason we added it: a stored report can go stale while the page still claims it, which is what
  happened to Michal), move it to `docs/evidence/report-2026-09-15.json` and say so in the
  README. This honours the letter of her request while keeping the artefact. Slight risk she
  reads it as the same thing under a new name.
- **(c) Keep and explain.** Not recommended; it argues with the reviewer over a hygiene point.

Pushing to the existing remote is a Kurt-typed `!` step under the classifier guardrail.

### 3. "Add your demo video to the report"

**Status (verified).** `reports/report.json` has no `video` field; the `runNotes` header
carries the stack and measurement summary. `finish-report.sh` already supports `VIDEO=<url>`
and `build-report.mjs --video`. Kurt's earlier plan was an optional video by 9/18; the
assignment deadline has passed, but she is still reading updates in threads.

**What her other comments say a good video is.**

- Length: she told Roshan to "cut the demo to 90 seconds". Target 60–90 s.
- Host: Loom and YouTube both accepted; she praised Elie for putting the Loom URL "inside the
  final /evals/report.json"; she called out Madhavan because the video link "is just
  github.com". Gabriel embedded his on /evals.
- Content she rewards: the plan frame arriving before retrieval on deep, memory carrying into
  a new thread (asked of Elie and Prateek), an honest failure (praised for Beat and André),
  and the /evals page itself.

**Suggested 75-second script for ours.** (1) Quick ask with a citation click, ~15 s. (2) Deep
ask: the plan paints first, sub-questions fan out, merged numbering, ~25 s. (3) Save a
preference, open a new thread, watch it honoured, ~15 s. (4) /evals: 85/85, the 45 ms miss
kept, the step-by-step replay of a real deep run, ~20 s. Add the URL with
`VIDEO=… ` on the rebuild described under item 1, so one redeploy carries both changes.

## Part 2 — Cohort-wide patterns, and where our build stands

Each pattern below is something she raised for at least two builds. "Ours" is what I could
verify this morning, with the evidence.

| Pattern (how many builds) | Ours today | Evidence |
|---|---|---|
| **"Who is president of USA?" grounding probe** — 7 failed: Muthukumar, Madhavan, Shobhit answered Biden; Felipe answered Biden with no sources; Roshan could not answer (nav text); Yasemin and Neha gave a non-answer with citations | **Pass (verified).** Fresh thread, web, quick: "The current president of the United States is Donald John Trump. [1] He was sworn into office on January 20, 2025, as the 47th president. [1]" | Live gateway, 09:4x ET: TTFT 2,013 ms, 2,469 ms total, $0.0106, `terminated: done`, `searchCached: false`, trace recall_memory → web_search → sources → tokens |
| **Fetch the page before citing; never answer from snippets** — Juan, Neha, Xiaoya (and Saurabh in our own 9/15 review) | **Pass on substance, ambiguous on appearance (verified).** Our web fast path answers from Tavily's *raw page content*, which is the page text, not a snippet, so grounding scores 1.0. But the trace shows `web_search` then synthesis, with no `fetch_page` step, which is the visual shape she flagged for Xiaoya. | Probe trace above; DESIGN.md Communication, web preflight paragraph |
| **Fail loud: 502 before headers, `error` after, never an invented answer** — Felipe, Shobhit, Madhavan failed; Raj, André, Muthukumar praised | **Pass by design, with one documented exception.** Because every quick run now opens the stream with the `recall_memory` trace, a provider failure on the first model call surfaces as an `error` event inside a 200, not a 502. She praised Raj for the opposite: "holding back the start of the stream until retrieval succeeds is exactly how you get an honest 502 instead of an apology inside a 200." | DESIGN.md Communication, memory paragraph ("A side effect worth naming") |
| **Agent not publicly reachable** — Felipe's agent is public; Anurag's keys sit on the Vercel edge; Saurabh's IAM-token Cloud Run is "the most secure deployment in the cohort" | **Pass (verified).** Agent is a private Fly Machine with no public address; the gateway reaches it over Fly's private network. There is no auth token on that hop: the gateway only knows `AGENT_URL`. | `backend/gateway/src/env.ts`; our 9/15 Saurabh review confirmed his agent returns 403 to the public |
| **/health names every model in use** — praised for Juan and Beat; Andrii and Sahar told to add Haiku | **Pass (verified).** `"model": "claude-haiku-4-5; deep synthesis: claude-sonnet-5"`. Cosmetic defect: the JSON repeats the whole payload inside a nested `ai` object, twice. | `curl https://lumina-claude-gateway.fly.dev/health` |
| **Trajectory notes in the learner's own words** — asked of 11 builds; Julia's were flagged as written by her coding agent | **Pass.** She praised ours; Kurt wrote P1. | Her reply; `docs/p1-*.txt` |
| **Do not edit `quality/rules.json`; propose bonus rules separately** — Saurabh, Sahar | **Pass.** Untouched by decision. She invited Hoyin and Saurabh to submit precedents as bonus-rule proposals. | Project decision on record |
| **Capped or errored runs belong in `runs/failing/`** — Hoyin, Hafeez, Anurag | **Pass.** She praised our automatic routing. | Her reply |
| **Worker off the request path; uploads must not slow search** — Hua praised; Xiaoya, Prateek told to separate | **Pass.** Forked child process of the agent Machine; the ingest-vs-search gate passes. | Report SLA table |
| **Deep planner writes searchable, specific sub-questions; every one gets researched** — Swarnav, Hafeez, Raj, Kotesh, Muthukumar | **Pass.** Terse planner prompt, per-sub budget, plan p95 within gate. | DESIGN.md deep paragraph; report |
| **Cold-path TTFT** — Andrii, Roshan, Kotesh, Hoyin, Yasemin, Neha, Elie, Prateek, Saurabh | **Pass.** 16/16 SLA on the served bench; probe TTFT 2.0 s on an uncached query. | Report; probe |
| **Router should make a real choice when a Space is selected, not always search documents** — Beat | **Same shape as Beat's, not flagged for us.** Auto mode with a Space searches the Space first and answers from it when it found anything; the model turn only returns when retrieval is empty. | DESIGN.md v1.5, trade-off 10 |
| **404 for an unknown space** — Xiaoya | **Pass (verified).** | `GET /spaces/spc_doesnotexist/documents` → 404 |
| **DESIGN.md hygiene: own words, no template comments, all five headings, describes the real deployment** — Madhavan, Roshan, Shobhit, André, Saurabh, Hua, Yasemin | **Pass (verified).** No `<!--` comments remain; five headings present; Fly deployment described. | grep; heading list |
| **Video present, short, linked from the report** — asked of 16 builds | **Missing.** See item 3. | `report.json` |

**Two observations from the probe worth a look.** The displayed snippets for sources [1] and
[2] are navigation chrome ("Español Call us at 1-844-USAGOV1 …", "Help inform the discussion
Support the Miller Center Facebook X …"). The answer itself was right and grounded, but a
reviewer scanning sources sees menus, which is exactly what she told Roshan to clean "with
Readability or something similar before the model reads them". Our `cleanRawContent` handles
markdown syntax; it does not strip boilerplate. Second, `/health` returns its payload nested
inside itself under `ai` (a duplicated object); harmless, but untidy on the one endpoint she
reads first.

## Part 3 — Changes to consider, ranked

**A. Do before asking her to look again (her three asks).**

| # | Change | Effort | Decision needed |
|---|---|---|---|
| A1 | Trim Communication to three paragraphs; move the change history to a non-graded section; v1.6 | ~45 min writing | Kurt approves the cut shape above, or edits it |
| A2 | Stop shipping `reports/latest.json` in the public snapshot (option a) or rename it to `docs/evidence/` (option b) | ~10 min + a push Kurt types | a or b |
| A3 | Record a 60–90 s demo, add `--video` on the same rebuild, redeploy the gateway | recording time + ~15 min | Kurt records; Loom or YouTube |
| A4 | Reply in our Maven thread once A1–A3 are live (draft below) | 2 min | Kurt posts |

**B. Cheap hardening her comments point at (not asked of us; each strengthens a line she
praised in someone else).**

| # | Change | Why | Effort |
|---|---|---|---|
| B1 | Shared secret on the gateway→agent hop: an `AGENT_TOKEN` env on both apps, checked by one agent middleware, sent by the gateway | The Fly private network is the fence; a token is the lock. This is the software equivalent of the IAM token she called "the most secure deployment in the cohort" on Saurabh's build (Kurt's highlight). Also protects against anything else that lands in the same Fly org | ~25 lines, two Fly secrets, redeploy both |
| B2 | Hold the SSE headers until the preflight search (or the first provider call) succeeds, then emit the buffered `recall_memory` trace | Turns a first-call provider outage back into a pre-headers 502, the behaviour she praised on Raj's build; removes the "side effect worth naming" from DESIGN.md | ~30 lines in the ask handler; re-verify the memory gates |
| B3 | Strip navigation boilerplate before snippet selection (Readability-style main-content extraction, or a "skip sentences with a phone number / social-media word list" heuristic) | Sources read as menus on the probe; she named this fix to Roshan | ~1 hr; re-run grounding audit on stored answers, no bench needed |
| B4 | Make the fast path legible in the trace: either a reason string that says "page text extracted for N results; no fetch needed", or a zero-cost `fetch_page` step marked "served from search raw content" | Pre-empts the "answered from snippets without fetching" reading she gave Xiaoya | ~10 lines |
| B5 | De-duplicate the nested `ai` object in `/health` | Tidiness on the endpoint she opens first | 5 min |

**C. Optional.**

| # | Change | Note |
|---|---|---|
| C1 | Trim Trade-offs to the strongest four on the graded page, rest below | Her range from other reviews is three to six; not asked of us |
| C2 | Submit a bonus-rule proposal | She invited two classmates to. Our candidates: "a snippet must survive the grader's tag-stripper" (the markdown-in-raw-content bin) and "measure on the grader's harness, not your own" (the fresh-thread lesson). Proposal, not an edit to `rules.json` |
| C3 | Let auto mode with a Space fall through to the web when the doc hits are weak (score threshold), not only when empty | Beat was asked for a "real choice"; ours has the same always-docs shape. Costs TTFT on the docs path that we bought for the gate, so only if there is a quality case |

## Part 4 — Standing in the cohort (from her language, not a score)

Her strongest openers went to Kurt ("outstanding"), Swarnav ("outstanding"), Beat
("outstanding submission"), Raj ("exceptionally clean"), Julia ("superb engineering"), Juan,
Andrii, Sahar ("excellent work"), Roshan ("engineering here is excellent"). Ours is the only
one of those with no product ask. Confirmations of our 9/15 peer reviews: Saurabh's two
"MISSING" trajectories and the TTFT miss were both called out; Michal's app is now down with
the stale report we predicted; Muthukumar has since re-run to 85/85 with a real Tavily-401
failing run and a 50 s demo.

## Draft reply for Kurt to post in our Maven thread (after A1–A3)

> Thank you, Jayita. All three are done: DESIGN.md v1.6 cuts Communication to the protocols,
> the fast paths and deep search (the bench-by-bench history moved to a non-graded section
> below), the public repo no longer carries reports/, and the demo is linked from the report
> and on /evals. The served numbers are unchanged, still the 2026-09-15 run with its 45 ms miss.

## Method and cost

Submissions and replies were read through the page's own chat client, so nothing was
truncated; the raw capture is the companion file. One live probe was run against our gateway
on a fresh thread and user id (`audit-jayita-probe-20260924`), cost $0.0106; it adds one run
log on the agent and does not touch the served report. Health and the unknown-space check were
free GETs. No board messages were pending. No repository files outside `docs/reviews/` changed.
