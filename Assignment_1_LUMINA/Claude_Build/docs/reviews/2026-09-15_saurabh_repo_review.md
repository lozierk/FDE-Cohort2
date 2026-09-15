# Review: Saurabh Bhardwaj's LUMINA repo (https://github.com/Bhardwaj-Saurabh/LUMINA)

Delegated to opus-specialist 2026-09-15 ≈ 09:00 ET; reviewed by Claude (Fable). Companion to
`2026-09-15_saurabh_deployed_review.md`. Read-only; nothing of his was run.
**Keep this file out of any public repo: it reviews a classmate's work.**

## Claude's corrections to the specialist's report
- §3 and §8 item 4 say our ingest lacks a read-your-write probe. **Wrong.** Ours is
  `backend/agent/src/ingest/probe.ts`: the same `$vectorSearch` the tool uses, the chunk's own
  embedding, 1 + 6 attempts over ≈ 63 s (`config/rag.ts` PROBE_BACKOFF_SEC), `indexed` set only
  after it returns (`ingest/index-document.ts:145-158`), loud failure otherwise. His is 10 × 1.5 s.
  Nothing to copy; worth one line in the write-up.
- §1 note on our costs: per-answer costs in our bench come from the agent's own done events
  at published Anthropic rates (`config/model.ts`); only `projectedMonthlyUsd` and
  `declaredPriceTableUsd` use sla.json's placeholder table. Kurt decided 2026-09-15: files
  untouched, say so in run notes (`docs/RUN_NOTES_PENDING.md`).
- Red-line diff independently confirmed by Claude: web/, packages/contract/, eval/, scripts/
  byte-identical to the pinned starter; `benchmark/sla.json` cost_model and
  `quality/rules.json` precedents changed in his commit 38bbf5d.
Everything else below is the specialist's text, unedited.

---

# Saurabh's LUMINA repo — grader's-eye review

**Decision: Kurt's "well crafted" is confirmed for the code and the README, and challenged on submission hygiene.** The engineering is the best I've seen at this level; the repo contains four avoidable self-inflicted wounds, one of which is a literal red-line trigger.

## 1. Red line: he edited two provided files

`diff -rq` (excluding node_modules/dist) of his `web/ packages/contract/ benchmark/ eval/ quality/ scripts/` against our pinned starter: **web/, packages/contract/, eval/, scripts/ are byte-identical.** Two differ:

- `benchmark/sla.json` — `cost_model` re-declared (anthropic/claude-sonnet-5 $3/$15 → azure-openai/gpt-5.4-mini $0.75/$4.50, embeddings 3-small→3-large $0.13), plus a `_declared` provenance string.
- `quality/rules.json` — all 10 `"TODO — record…"` precedent placeholders replaced with real dated incidents (C1, A2, A3, E1, E2, E3, B1, B2, B3).

Both edits were one commit, `38bbf5d "M9: real prices, case law filled"`.

`scripts/create-indexes.mjs` and `scripts/indexes.json` **are in ours too**, byte-identical — they are starter files, not his.

**Verdict: he edited two of the five folders named in `eval/rubric.json:122`.** The mitigation is strong — the files ask for it. `benchmark/sla.json:5` says *"PRICES ARE PLACEHOLDERS: set them to your providers' published rates before trusting the dollar figures"*; `quality/rules.json:2` says *"placeholders are marked TODO and reported by P2, which warns until the cohort fills them."* PROGRESS.md calls it "the one sanctioned edit". But he contradicts himself: `backend/agent/src/env.ts:55` — written *after* that commit — still says *"`benchmark/sla.json`'s cost_model, **which we may not edit**"*. A literal grader has a defensible auto-fail; a reasonable one accepts it. **This is a coin-flip he did not need to take.**

For Kurt: our sla.json is untouched, so our dollar figures are priced at Sonnet-5 rates ($3/$15) regardless of Haiku, and our rules.json still emits P2 warnings. Neither is wrong under the red line, but our cost numbers are not real prices. Flag in the write-up rather than editing.

## 2. Structure, README, docs, and what shouldn't be public

**README.md (174 lines, ~1,100 words) is the best artifact in the repo.** It leads with a banner image, a one-sentence product claim (L7), three live links (L9), and "hand-rolled agent loop, no framework" (L11). Then: *What it does* → *Measured, on the deployed app* (a 10-row table that **includes the failing row**, L40: "2.7–4.7 s across three runs — over target. Not fixed.") → *For engineering leaders* (4 numbered claims, each linking a source file) → *Three bugs worth the interview* (L79-81) → *For people who want to build this* (a reading order) → stack → repo map → *Honest status* → a LinkedIn CTA. **It speaks to a hiring manager, not a grader** — and that is the whole point of 9f03403, "Restructure the repo around a README that speaks to readers, not graders."

**docs/ is where it slips.** 4 of 6 files are *course material he republished*: `ASSIGNMENT.md`, `PRD.md` (L3 names "Owner: Hamza Farooq"), `SPEC.md` (510 lines), `TECHNICAL.md` (384 lines — `TECHNICAL.md:315-330` is the course's worked-example scorecard for a fictional "Priya Nair · 91/100"). Only `ARCHITECTURE.md` (1,075 lines, his, genuinely the design authority) and `RUNBOOK.md` (135 lines, his) are his own. The four course docs restate each other and bury his two.

`docs/RUNBOOK.md:5` is now **stale and contradicts the repo**: "README.md is the course's assignment brief and is left exactly as delivered" — untrue since the restructure.

**PROGRESS.md is a 56 KB session log** — status block, milestone table, then an append-only per-session table with tests/gates/next/notes. It is the single most persuasive engineering artifact here and also 10× longer than anyone will read.

**AI config is committed**: `CLAUDE.md` (his), `AGENTS.md` (course-provided), `.claude/agents/{gate-runner,implementer,test-writer,red-line-auditor}.md`, `.claude/skills/{lumina-edd,lumina-tdd,lumina-track,fde-lumina-eval}`. It reveals a disciplined test-first pipeline with a dedicated red-line auditor — genuinely impressive, and it also makes the AI-assisted process explicit.

**Nothing secret is exposed.** `.env.example` has every value blank; `.gitignore:4-6,16-17` is careful (it even narrows the `.env*` glob Vercel wrote so `.env.example` stays tracked); `docker-compose.yml` is a bare local mongod. `.github/workflows/deploy.yml` exposes GCP project `all-thing-agentic-505911`, project number 630908588763, the WIF pool and the deploy SA email — WIF is designed for this, so it is disclosure, not leakage.

**Two things I'd question publishing:** (a) `.env.example` is a mess — his Azure block was prepended at L1-16, and the *original* scaffold block survives below it, duplicate header at L18, `ANTHROPIC_API_KEY=` at L31, `EMBEDDING_MODEL=text-embedding-3-small` at L41, and `RATE_LIMIT_PER_MINUTE=30` at L64 — the exact value his own `quality/rules.json` C1 precedent says broke the bench and was re-declared to 600. It is the first config file a reader opens and it contradicts his README's stack line. (b) PROGRESS.md's session log contains "**Azure key echoed to terminal during check — rotate after project; confirm work-resource policy**" — a self-disclosed incident against a *work* resource, permanently public.

## 3. Agent service — genuinely excellent

`backend/agent/src/core/loop.ts` (386 lines) is the standout. Optimistic streaming: the answer *is* a turn, no second synthesis call (L198-243). `terminated` is set at five explicit exits and never guessed: `cap` only on a *refused admission* while the model still wanted tools (L296-303, L336-339), `error` on provider throw or dangling citation (L171-174, L364-371), and a deterministic capped finish that emits no `[n]` so the citation audit still passes (L343-354). Tool dispatch carries the same deadline as the provider call (L185-195) — added after a 230 s hang.

Grounding is structural, not prompted: `tool_choice: 'required'` until a retrieval tool has actually run, and if the model dodges with `recall_memory` the advertised set narrows to retrieval only (L246-264). `core/registry.ts:41-49` enforces `DEEP_ONLY_TOOLS` **at dispatch**, not just in the advertised list — that is R2 done properly.

**Tools**: `web_search` and `fetch_page` (`core/tools/webTools.ts`), `search_documents`, `save_memory`/`recall_memory`, `plan_research`. `fetch_page` exists and vets every URL before the network (L102) and wraps page text in `<untrusted_source>` (L112) — the reason it never appears in a trace is a deliberate prompt+economics choice: `loop.ts:99-102` tells the model one search suffices, and `webTools.ts:15` feeds it 1500 chars of Tavily content so it does not need to fetch. **A grader reading a trace still sees snippet-only** (rubric `eval/rubric.json:22`), so this optimisation costs him points.

**Deep fan-out is parallel but not subagents**: `core/deep/orchestrator.ts:285` — `mapWithConcurrency(plan.subQuestions, 3, researchOne)`, one research turn per sub-question, each over its own registry built on a `taggedSink` so every source carries its `subQuestion` structurally (`runAsk.ts:274-280`). One shared collector and one shared Budget give contiguous merged numbering. Sub-questions cannot recurse (documented at orchestrator.ts:16-19). **This is not the stretch-bonus "isolated subagents"** — no separate context per branch — so I would not award those 5 points.

**Why an identical repeat misses the cache** — two independent causes, both in `providers/search/cached.ts`:
1. `searchCached` = `stats().allHits` = `hits > 0 && misses === 0` (L222). `runAsk.ts:215-217` fires `prewarm(body.query)` on every quick web run; when the model's own `web_search` arrives while that prewarm is still in flight it **joins**, and `join()` increments `misses` (L160-167, deliberately: "a join is a miss whatever it joined"). One join ⇒ `allHits` false ⇒ `searchCached: false`, even though nothing was paid twice.
2. The key is `sha256(normalizedQuery|provider|shape)` (L92-96) over the **model-written** query, not the user's. If the model rephrases, it is a new key and a real paid miss. He knows — the system prompt at `loop.ts:97-99` begs the model to reuse the user's wording, and the header comment at L88-91 documents the live observation.

Net: his reported 97.5 % hit rate and the `done.searchCached` flag measure different things, and prewarm-issued provider calls are counted in neither `hits` nor `misses` (only in `prefetch.issued`, `cached.ts:219-224`).

**Read-your-write probe — found, as claimed.** `core/rag/ingest.ts:133-140` calls `probeUntilSearchable` before `setStatus('indexed')`, 10 attempts × 1500 ms; `ingest.ts:194-196` throws *"probe found no searchable chunk for … the vector index is not queryable"*. The probe itself (`repos/chunks.ts:90-107`) runs a real `$vectorSearch` with the vector just written and checks `hits.some(h => h.docId === docId)`. The file header states the principle: *"`indexed` is unreachable without a probe that found the chunks we just wrote."* **This is better than anything in ours and worth copying outright.** [Claude: wrong, see corrections above.]

**Jobs worker** (`worker.ts`) is its own process, claim→work→finish, with a stale-lease sweeper for crashes and a *final, visible* `failed` for genuine errors (L8-19) — and it fails the *document*, not just the job, so the progress bar cannot hang forever (L116-121).

**Cost accounting**: `runAsk.ts:73-74` prices in/out from env at the declared Azure rates (`env.ts:76-77`); embeddings are priced at chat rates, an over-count he documents as "in the honest direction" (`env.ts:42`). `Budget` (`core/budget.ts`) is four-dimensional with a reserved synthesis allowance, and `tryReserveToolCall()` is check+increment in one synchronous step (L48-57).

**Retries**: `providers/llm/retry.ts` — SDK retries disabled, policy bounded (`maxWaitMs`), abortable (L108-123), and logged via `onRetry`. Written after a 66 s TTFT caused by the OpenAI SDK sleeping on Azure's `Retry-After: 30` inside `completions.create`. Excellent.

**Tests: 397 (353 agent across 32 files, 44 gateway across 5).** README says 422 — stale by one commit, or counting differently; minor. **None need Atlas** — only `db.ts` and `env.ts` reference `MONGODB_URI`; every test runs on fakes (`testing/fakes.ts`, 454 lines). Coverage is where it matters: `loop.test.ts` 1039 lines, `cached.test.ts` 682, `orchestrator.test.ts` 481.

## 4. Gateway — clean, and the rate limit matches what we saw

`backend/gateway/src/app.ts`: routes are generated from the contract's `ROUTES` array (L249-255), so auth and method can't drift. SSE is **byte-level pass-through with backpressure** and no parsing (L207-211). Client-disconnect is detected on `res.on('close')` + `writableEnded`, with a comment explaining why `req.on('close')` aborted every upstream in 0 ms (L184-190). Header relay is an **allowlist** (L70-88) — etag, cache-control, x-published-at — added after the deployed gateway was silently dropping the agent's ETag. After headers are sent, an error just ends the stream; JSON is never injected into an SSE body (L272-280).

**Rate limiting explains our 60×200 exactly**: `index.ts:18-22` sets burst 60, `env.ts:38` sets 600/min, and cost is 5 for `POST /ask|/documents`, 1 for everything else. 60 concurrent `GET /memory` is precisely the burst; the 61st would 429. `middleware/rateLimit.ts:63` computes `Retry-After` from the request's *full* price.

**IAM**: `proxy/idToken.ts` hits the metadata server directly (no SDK), caches until 60 s before `exp`, and dedupes concurrent mints (L49-56). Fails loud at the gateway rather than as an opaque 403.

**`/evals/report.json`** is served by the *agent* (`http/app.ts:202-221`) as a read of a published artifact — strong ETag, `X-Published-At`, 304 — and 404s when unpublished rather than returning an empty report ("never an empty report that looks like a bad score", L207). The gateway proxies it and relays those headers.

**CORS**: `app.ts:100-102`, `origin: deps.corsOrigins`, fed from `CORS_ORIGINS` (`env.ts:25-28`). Default is permissive in the factory but the composition root always passes the list — matches the live behaviour (foreign origin refused).

## 5. DESIGN.md and doc-vs-code drift

All five answers are present and match the code: gateway holds no keys ✓, worker is "the only component allowed to … mark a document as `indexed`" ✓ (enforced in ingest.ts), "the agent loop is the only place that determines `done|cap|error`" ✓, eventual-consistency/read-your-write ✓ (DESIGN.md:130-133).

**The Anthropic contradiction is fixed in the repo** — commit `6db67b4 "Update DESIGN.md"` (today) rewrote trade-off 2 as "A custom agent loop instead of an agent framework" (DESIGN.md:146-150), no provider named. **But the deployed `/evals` page still serves the report published 2026-09-14**, which inlines the *old* design text. Unless he republishes, the grader still reads "Anthropic SDK" against a gpt-5.4-mini deployment.

**New problem he introduced fixing it**: DESIGN.md:5-41 and 75-108 are now **pandoc ASCII box-drawing tables** (`\#` escape at L6, `---------` rules). `eval/build-report.mjs:79` parses these sections by heading into plain strings and `web/src/EvalsPage.tsx:212-224` renders them in a `<dd>` — as unformatted text, a wall of dashes. His prose is good; the rendering will be worse than before.

**Claims not backed by a run**: README L41 "Tests 422" (actual 397). README L36 "Search cache hit rate 97.5 %" is bench-measured but, per §3, is not the same quantity as the `searchCached` flag the rubric checks. Everything else in that table traces to a recorded bench run in PROGRESS.md.

## 6. Commit history — the best evidence of process

40 commits over 8 days, milestone-shaped (`M1 done`, `M2 batch 1..5`, `M5`, `M6`, `M7 RAG`, `M8 deep search`, `M9`, `M10`), each batch naming its test count ("49 tests green", "96 tests green"). Then four **correction** commits that are worth more than the features:

- `a52ef88 "Correct a wrong latency claim: transport is ~100ms, the gap is ours"`
- `35e3cdf "Correct the PROGRESS status block, which claimed a gate that fails"`
- `20f0e22 "M2 and M6 closed on measured evidence; correct the EDD smoke-gate claim"`
- `e15d999 "…repair the session-log table"`

He publicly reverses his own claims, and PROGRESS.md's Status block currently reads **"Blockers: `ttft p95` FAILS: 4666 ms against a 2500 ms gate"**. That is rare and it is exactly what a hiring manager wants to see.

## 7. Grader's verdict against `eval/rubric.json`

| Row | Pts | Call | Evidence |
|---|---|---|---|
| UI & contract | 10 | **10** | All probes pass live; routes generated from `ROUTES` |
| Search & cited answers | 20 | **15-17** | Grounding 0.97, retrieval 1.0, zero dangling — but "trace shows fetch_page not snippet-only" fails, and `searchCached=true` on an identical repeat fails |
| Memory | 10 | **10** | Full save→recall→list→delete verified live |
| RAG | 15 | **15** | 202 <300 ms, probe-gated `indexed`, page locators, recall@5 1.000 over 39 |
| Deep search | 15 | **15** | Plan-first, per-sub-question attribution, contiguous merge, 5.1× sources, inside cost/time caps |
| Performance & SLA | 10 | **6-7** | `bench.mjs` exits 1 (ttft p95 4666 vs 2500); quality has an A3 warning, no error |
| Observability | 5 | **5** | One requestId across both services; `/health` complete |
| Deep search quality (manual) | 5 | **4-5** | Deep genuinely better, not longer |
| **Human gate (manual)** | 5 | **0** | Both trajectories are still the literal `MISSING` placeholder on the live page |
| Deploy & docs (manual) | 5 | **3-4** | Deployment is textbook; no `runNotes`/`repo`/`video`; design section renders as raw text |
| **Red lines** | — | **at risk** | `benchmark/sla.json` + `quality/rules.json` modified |
| Stretch: subagent deep search | +5 | **0** | Parallel, but not isolated subagents |

**Likely 79-84/100, with a tail risk of a red-line zero.**

**Versus ours**: we are ahead where it is cheap to be ahead — 82/85 automated with one 45 ms deep-plan miss vs his failing gate 2, trajectories filled vs his `MISSING`, `fetch_page` in traces vs his snippet-only, provided folders untouched vs his two edits. He is ahead where it is expensive — 14 s / $0.011 deep vs our 85.9 s p95 / $0.143, 397 fake-driven tests vs ours, an ingest probe we do not have [Claude: we do], and a README that is a portfolio piece while ours is a submission.

## 8. What Kurt should copy — ranked

1. **The README shape.** His leads with a product sentence + three live links + the measured table *including the failure*, in ~1,100 words, before any setup instruction. Ours should do the same and go further on one axis he can't: **lead the measured table with 82/85 and the trajectories filled**, and put the Fly/Vercel + Haiku/Sonnet-5 split in the stack line. Steal the literal section headings *"For engineering leaders"* and *"Three bugs worth the interview"* — the second is the highest-value 200 words in his repo and we have better material for it (the 230 s hang, the 45 ms miss we stood on, the TTFT fast path).
2. **Name the failure in the README, in the table.** His L40 and L149-155 ("Honest status") turn a miss into a credibility asset. Our one 45 ms deep-plan miss deserves exactly that treatment — one row, one sentence on why we stood on it.
3. **Source links inside the claims.** Every assertion in his "For engineering leaders" section ends in a `→ path/to/file.ts` link. Cheap, and it makes the README auditable.
4. **The read-your-write probe idea** — [Claude: already in ours; write it up instead.]
5. **A short RUNBOOK.md** (his is 135 lines) separate from the README. Ours has DEPLOY.md — keep it, link it from the README's build section.
6. **A one-screen honest-status block** at the end of the README.

**What NOT to copy:**
- **Do not touch any provided folder**, even where the file invites it. Instead: declare real prices in a `docs/COSTS.md` and say in the README that `sla.json`'s cost model is the scaffold's placeholder Anthropic rates and ours are X. Zero red-line exposure, same honesty credit.
- **Do not republish the course docs** (ASSIGNMENT/PRD/SPEC/TECHNICAL) in a public repo. Link them or keep one `docs/ASSIGNMENT.md` for context. Four of his six docs are someone else's writing, and they bury his ARCHITECTURE.md.
- **Do not publish the raw session log.** PROGRESS.md at 56 KB is a private asset with a self-disclosed key-exposure note in it. Publish a ~2-page "build diary" — milestones, gate results, the failures — and keep the full log local.
- **Do not let `.env.example` rot.** Ours must name exactly the providers the README names. His still advertises `ANTHROPIC_API_KEY` and a rate limit he abandoned.
- **Do not pandoc your DESIGN.md.** The `/evals` page renders those five answers as plain strings; write them as short prose and bullets, never tables.
- **Do not ship with `MISSING` trajectories** — 5 points, and it is the first thing on the page that looks unfinished.

## Open questions only Kurt can answer

1. **Do we tell Saurabh?** The sla.json/rules.json edit is a real red-line exposure and there is time before 09-18. His DESIGN.md fix also isn't live — the published report still carries the Anthropic text.
2. **How public is our repo going to be** (D-12)? Almost every recommendation above turns on that. `Claude_Build/docs/reviews/` must stay out of any public repo.
3. **Is the cost-model question worth a paragraph in WRITEUP.md?** [Claude: decided, run notes.]
4. **Do we spend the time on the ingest probe** before 09-18? [Claude: moot, we have it.]
