# Maven "Build a Perplexity Clone" channel — submissions and replies (raw capture)

Captured 2026-09-24 ≈ 09:30 ET by Claude for Kurt, from
https://maven.com/boring-bot/ai-system-design/cohort-2/channel?channelId=680234cc-3b4d-4637-b4c6-b2064e45079a
via the page's Stream Chat client (`channel.state.messages` + `getReplies`), so every reply is
complete, not a truncated preview. Reply timestamps are UTC as the API returned them; Jayita's
sweep ran 2026-09-23 15:24Z–16:59Z, i.e. 11:24 AM–12:59 PM ET, newest post first.
28 submissions; 27 have a Jayita reply (Gabriel posted after her sweep).
**Keep this file out of any public repo: it quotes classmates' work and an instructor's private-channel feedback.**
The analysis is in `2026-09-24_jayita_feedback_audit.md`.

---

## [0] Michal Olczak — Fri Sep 11 2026 16:56 ET
Michal: https://lumina-web-sage.vercel.app

> **Jayita Chatterjee — 2026-09-23 16:59Z**
> Michal, your report shows a strong build. Grounding and recall are perfect, deep search reads five times the sources of quick, answers cost a fraction of a cent, and your design reserves the deep-search cap atomically before any work starts, which is a nice touch. Right now, though, the app is down: your Vercel gateway can't connect to the agent (a TLS error), and /health reports the agent and database as down. Please redeploy the agent or fix its URL and certificate, and show users a friendly message instead of the raw SSL error. Once it's back, re-run the eval so the quality checks read more than one run log. Write fuller trajectory notes about what each run taught you, and add your demo video.

## [1] Saurabh Bhardwaj — Mon Sep 14 2026 17:29 ET
Project Link: https://github.com/Bhardwaj-Saurabh/LUMINA
App: https://lumina-theta-woad.vercel.app

> **Jayita Chatterjee — 2026-09-23 16:57Z**
> Saurabh, this is strong engineering. Your Cloud Run setup, with the agent protected by an IAM token so only the gateway can reach it, is the most secure deployment in the cohort. Deep search reads five times the sources of quick at about a cent per answer. The precedents you wrote are genuinely valuable, especially the search that hung for 229 seconds and still produced a plausible answer. But they belong in your report as trajectories and in a bonus-rule proposal, not edited into quality/rules.json. Right now both trajectories on /evals show "MISSING", so re-run build-report.mjs with --successful and --failing and your notes. Also bring your first-text time under 2.5 seconds, update DESIGN.md for Azure OpenAI, and add your demo video.

> **Saurabh Bhardwaj — 2026-09-23 20:38Z**
> thank you for the feedback Jayita. I will update these. thanks for your comment.

## [2] MUTHUKUMAR SELVARASU — Tue Sep 15 2026 09:41 ET
https://lumina-ui-eight.vercel.app/

> **Jayita Chatterjee — 2026-09-23 16:55Z**
> Muthukumar, your app is live, the contract checks pass, and caching works nicely. I love the improvements to the front-end design, too. The Notes and Graph areas and the light/dark toggle make the app much more helpful and pleasant to use. A few changes would make a big difference. Your deep-search plan seems to use a fixed template, so let the model write sub-questions that fit each question. When I asked "who is president of USA?", the answer said Joe Biden even though the cited page says otherwise, so keep answers strictly to the fetched text. Finally, please regenerate your report with /fde-lumina-eval and include a real failing run, trajectory notes in your own words, and a short demo video. You have a solid base, and I look forward to the update!

> **MUTHUKUMAR SELVARASU — 2026-09-24 12:46Z**
> Thanks @Jayita Chatterjee
> Deep search no longer uses the fixed template. A live ask about electric vehicles and city air quality streamed four sub-questions for that question before any retrieval.
> "Who is president of USA?" answered Donald Trump, in office since January 20, 2025, from the Wikipedia page fetched in that request. That run is req_muf7k3flu4pzo5 on /evals.
> I regenerated the eval report from a full bench against the deployed gateway. bench.mjs exited 0. Automated score is 85/85. 202 accept p95 is 233 ms, search during ingest is 0.864× idle, citation grounding is 1, and recall@5 is 0.967.
> The two trajectories I read end to end are on /evals. The successful one is req_muf7k3flu4pzo5 (terminated done). The failing one is req_fail_muf6oxek (terminated error): web_search returned a Tavily 401, the step is ok: false with that error, and the run did not invent an answer.
> The short demo is about 50 seconds: https://lumina-ui-eight.vercel.app/demo/player.html
> It covers an ask with citations, a deep-search plan, /evals, light and dark theme, Graphify, and Notes.
> App: https://lumina-ui-eight.vercel.app · Report: https://lumina-ui-eight.vercel.app/evals

## [3] Kurt Lozier — Tue Sep 15 2026 10:59 ET
**LUMINA** — a Perplexity-style search agent that searches the web, reads the real pages, and streams back an answer with citations you can click. It has two gears: a fast quick mode, and a deep mode that plans sub-questions before it researches. It also runs RAG over PDFs you upload, with page-level citations, and it remembers your preferences across conversations.
**Try it:** https://lumina-claude.vercel.app · **Scores and live trajectories:** https://lumina-claude.vercel.app/evals · **Code and write-up:** https://github.com/lozierk/Claude_Build_Submission
A few things worth a look: it runs two models split by where the difference actually shows — Haiku 4.5 for speed, Sonnet 5 only for the deep answer, chosen from a measured A/B. It scores 85/85 automated against the grader's own eval on the deployed app. And the **/evals** page lets you replay a real deep-search run step by step. The write-up is honest about the one number I chose to stand on rather than re-roll to green.

> **Jayita Chatterjee — 2026-09-23 16:49Z**
> Kurt, this is outstanding work. Every gate passes against the deployed app, your protected folders are untouched, and choosing Haiku for speed and Sonnet only for the deep answer, based on a measured comparison, is exactly the kind of decision this course wants engineers to make. Keeping the run with a 45 ms miss instead of re-running until it went green shows real integrity. Your notes on the page-size cap and on routing error logs to runs/failing/ automatically show you learn from what you build. To polish: trim the Communication section of DESIGN.md, stop committing reports/, and add your demo video to the report.

## [4] Felipe Volpatto — Wed Sep 16 2026 09:27 ET
https://lumina-felipe.vercel.app

> **Jayita Chatterjee — 2026-09-23 16:46Z**
> Felipe, your trajectory notes are some of the most honest in the cohort, which makes this finding sharper. You wrote that the tempting bug is catching a provider error and answering "from the model's own weights", and that's exactly what happened in my test. Asked "who is president of usa?", web_search timed out, nothing was retrieved, and LUMINA confidently answered "Joe Biden" with no sources and a green "done". A failed search must end the run as an error with a 502, never as an uncited answer. Raise your search and fetch timeouts well above 900 ms. Two other fixes: your agent service is publicly reachable at lumina-agent-felipe.fly.dev, so put it behind Fly's private network, and check your deep-search planning and cost figures, which look too low to be real.

## [5] Prateek Dhawan — Wed Sep 16 2026 12:39 ET
Hi, I have used the free tiers and try to still meet whatever closely I can. Please review below:
Live app: https://lumina-web-two-orpin.vercel.app · Live eval report (JSON): https://lumina-8cqp.onrender.com/evals/report.json · Repo: https://github.com/prateekdhawan/FDE

> **Jayita Chatterjee — 2026-09-23 16:44Z**
> Prateek, your foundations are solid. Protected folders are untouched, the agent is private on loopback, citations never dangle, and your trajectory notes show real understanding of fail-loud behaviour. The problem is that the deployment can't carry the load: a 43% error rate, nearly 30 seconds before the first word, and uploads slowing search almost fourfold on the shared free-tier CPU. Move the worker to its own process or instance, or upgrade from the free tier, and re-run the benchmark. Beyond hardware, fix deep search so it reads at least twice as many sources as quick, and make memory carry into new threads. Finally, run the full gates and add your demo video.

> **Prateek Dhawan — 2026-09-23 17:46Z**
> Thanks for your comments @Jayita Chatterjee. Appreciate the feedback. As you rightly mentioned, hardware is one of the bottlenecks here. Just thought of learning and then improvising it further with more features. Thanks for pointing this out: "deep search so it reads at least twice as many sources as quick, and make memory carry into new threads". That's more like a direct improvement. Will work on it once I get some time for the rush and office hush :)

## [6] Madhavan Ekanathan — Thu Sep 17 2026 10:30 ET
Assignment 1: LUMINA Submission. Web: https://lumina-web-two-chi.vercel.app/ · Evals: https://lumina-web-two-chi.vercel.app/evals · Repo: https://github.com/aemadhavan/lumina

> **Jayita Chatterjee — 2026-09-23 16:41Z**
> Madhavan, the app is deployed, every contract check passes, and deep search works well. My "red nike shoes" test came back with five sensible sub-questions, nine tagged sources and a clearly structured report. The serious issue is grounding: asked "who is president of USA?", LUMINA answered Joe Biden and cited Wikipedia, even though it had fetched that page. The model answered from its own training data, so tell it to answer only from the fetched text, and check the claim against the source before citing. On the submission side, your benchmark ran against localhost instead of your Railway gateway, the video link is just github.com, and the failing trajectory (req_failing_sample) wasn't a real failure on the deployed app. Re-run /fde-lumina-eval against Railway, produce a genuine failing run, add your demo video, and rewrite DESIGN.md in your own words.

## [7] André Savoia — Thu Sep 17 2026 20:43 ET
https://maven-savoia-lumina.vercel.app

> **Jayita Chatterjee — 2026-09-23 16:38Z**
> Andre, your report shows a strong build. Every gate passed, citations are grounded, first text arrives in under 2 seconds, and answers cost a fraction of a cent. It's also good to see that when things break, your gateway reports an honest 503/502 rather than a fake answer. Right now, though, the app is down: the gateway can't reach your agent service and /health shows the database as down, so please restart your Fly agent and check the Atlas connection. Once it's back, update DESIGN.md to describe your actual Fly deployment rather than a laptop setup, and replace your failing trajectory with a run that really failed (for example, one with an invalid search key), plus notes on what it taught you.

> **André Savoia — 2026-09-24 14:18Z**
> Hi Jayita, the app is back up. /health is ok, including the Atlas connection. I updated DESIGN.md to describe the Fly deployment (maven-lumina-andresavoia in gru: public gateway, agent on localhost in the same machine, worker in that container, Atlas M0). I also replaced the failing trajectory with req_badkey-092842: an invalid Tavily key made web_search return ok: false with search provider 401, the run terminated error, and the stream closed with 502 instead of an invented answer.

## [8] Raj Mani — Thu Sep 17 2026 22:19 ET
App: https://lumina-rmani.vercel.app · Github: https://github.com/rmatx/lumina (public, main) · Eval: https://lumina-rmani.vercel.app/eval

> **Jayita Chatterjee — 2026-09-23 16:34Z**
> Raj, this is exceptionally clean work. Every gate passes, your protected folders are untouched, and your /health even reports a daily spend cap. The fail-loud handling is thoughtfully engineered: holding back the start of the stream until retrieval succeeds is exactly how you get an honest 502 instead of an apology inside a 200. Your note that a vague sub-question produced vague sources, so the planner prompt matters more than the fan-out, is the kind of lesson that only comes from reading trajectories carefully. The next step is to put that into practice: tighten the planner so every sub-question is specific enough to retrieve well. Also add your demo video to the report.

> **Raj Mani — 2026-09-24 03:31Z**
> Thanks Jayita appreciate the feedback. I will complete it this weekend.

## [9] Andrii Solod — Fri Sep 18 2026 06:02 ET
https://lumina-six-tan.vercel.app · https://lumina-six-tan.vercel.app/evals · Quick post mortem notes (image attached), the detailed document will be shared in slack.

> **Jayita Chatterjee — 2026-09-23 16:32Z**
> Andrii, this is excellent work. Every automated check passes with perfect grounding and recall, and your trajectory notes show real understanding. Tightening the wall-clock cap on purpose to show an honest cap ending, and explaining why the thrash rule misreads parallel fetches, are exactly the kind of insight this assignment rewards. Your post-mortem on working with a coding agent is thoughtful too, especially "no independent review ever ran". The main thing to work on is cold-start speed: your first text lands right at 2.5 seconds with warm caches but over 5 seconds cold, so optimise for the cold path. Also add Haiku to /health, run the full gates so they show on /evals, and add your demo video.

## [10] Hua Zhang — Fri Sep 18 2026 12:01 ET
Production URL https://lumina-red-nine.vercel.app/ · Evaluation and video https://lumina-red-nine.vercel.app/evals

> **Jayita Chatterjee — 2026-09-23 16:30Z**
> Hua, this is a strong submission. Every gate passes, document recall is perfect, the worker runs as its own process, and uploads don't slow search down. Your trajectory notes are honest and in your own voice, like admitting your first loop didn't stop on a Tavily failure and explaining how reading the trace changed that. The gap is DESIGN.md: your Components and Responsibilities sections are only a sentence or two each. Name every piece (the worker, MongoDB, the cache, the run logs) and say what each one is not allowed to do.

## [11] Roshan Prakash Patil — Fri Sep 18 2026 12:26 ET
Submission URL: https://lumina-orcin-seven.vercel.app · Evaluation page: https://lumina-orcin-seven.vercel.app/evals · Demo video: https://www.loom.com/share/582b3b069c4245bb96726b76747791da · attachment "LUMINA Report.pdf" (470 KB).
Long post: what it does; what he built (gateway with X-User-Id/zod/rate limit/SSE/502; agent with depth-filtered toolbelt, declared termination, web_search + fetch_page reading full pages, two-tier search cache plus page and query-embedding caches, explicit save_memory and semantic recall_memory, Spaces with a separate jobs worker, hybrid retrieval vector + BM25 with RRF and tenant filters, deep search behind a daily cap, one run log per answer; deployment: droplet behind nginx with Let's Encrypt, three systemd units, agent bound to localhost, UI on Vercel, Atlas M0). Measured: TTFT p95 2.1 s · answer p95 3.4 s · 202 accept p95 246 ms · search during ingest 0.71x · recall@5 1.00 · cache hit 97.5% · grounding 131/131 · error rate 0 · plan p95 3.0 s · 3.3x sources · $0.04 deep, $0.002 quick. Known limitation: a fresh uncached question takes about 5 s to first token; one tool-thrash warning chosen over first-token time.

> **Jayita Chatterjee — 2026-09-23 16:26Z**
> Roshan, the engineering here is excellent. Every gate passes, grounding and recall are both perfect, and your self-hosted droplet with a localhost-only agent is a clean, secure deploy at a fraction of a cent per answer. I liked that when LUMINA couldn't find an answer, it said so without attaching fake citations. But "who is president of USA?" shouldn't fail. The pages it fetched returned menus and navigation instead of article text, so clean them with Readability or something similar before the model reads them. Fresh questions are also slow, at 7 seconds on quick and nearly 20 on deep. On the written side, both trajectory notes on /evals still say "TODO", so add your incident stories there. Remove the template comments from DESIGN.md and cut the demo to 90 seconds.

## [12] Kotesh Bandhamravuri — Fri Sep 18 2026 12:38 ET
https://lumina-two-khaki.vercel.app

> **Jayita Chatterjee — 2026-09-23 16:20Z**
> Kotesh, your deployment is set up correctly: the agent is private, every contract check passes, and quick answers are grounded in fetched pages. Your deep answers are also nicely structured and honest when research comes up short. The main issue is that your /evals page has no report yet, so there's nothing to grade. Please run /fde-lumina-eval --deploy-url https://lumina-gateway-koteshfde.fly.dev to publish it, along with your DESIGN.md, trajectory notes and demo video. On the product side, deep search only fetched pages for one of four sub-questions, so make sure each one actually reads its results. Also work on speed: it takes 5–18 seconds before the first word appears.

## [13] Silvio Leite — Fri Sep 18 2026 13:21 ET
Production URL: https://lumina-phi-tan.vercel.app/

> **Jayita Chatterjee — 2026-09-23 16:16Z**
> Hi Silvio, thanks for submitting! I tried to open your app, but the Vercel deployment is currently paused (503: DEPLOYMENT_PAUSED), so I couldn't review it or your /evals page. Could you resume the deployment when you get a chance? If it's easier, a short Loom walkthrough would be great too. I'd be glad to watch it and share feedback. Looking forward to seeing what you built!

> **Silvio Leite — 2026-09-23 23:03Z**
> Hi Jayita, Sorry! I had paused it too soon. Could you please try again? It's working again now ;)

## [14] Hoyin Wan — Fri Sep 18 2026 14:50 ET
App: https://hw-lumina-beta.vercel.app/ · Github: https://github.com/hoyinwan07/multi-agent-course/tree/main/modules/Module_1_Agent_Foundations_Harness_System_Design/Assignment_1_Lumina (forked the whole parent repo; offers to isolate) · Eval: https://hw-lumina-beta.vercel.app/evals
Disclosure: removed the `_comment` field from web/vercel.json because Vercel's schema validation rejected the deploy ("should NOT have additional property _comment"); the rewrite rule is unchanged. Notes: 6 failing metrics on first run, to address as fast follows. Learnings doc: https://docs.google.com/document/d/1EJqnYE8Apo__yH0vTmgdpluSwlPsfE07cut2scDKtw4/edit

> **Jayita Chatterjee — 2026-09-23 16:14Z**
> Hoyin, your debugging log is exceptional. You worked out why your scores went 75 → 66 → 75 instead of assuming regression, proved the first 75 was flattered by a warm cache, and backed every fix with a hypothesis and a measured result. Your two-phase design, where tools are off before the first token, makes ungrounded citations impossible rather than just unlikely. Clear out or move the old capped runs so the red line reflects your current code, and bring that same depth into your /evals trajectory notes, which are currently one line each. Speed is the remaining gap, with 8 seconds before the first word appears. And add your demo video. Consider submitting the warm-cache finding as a new rule for the bonus.

## [15] Elie — Fri Sep 18 2026 15:23 ET
1/ Attached infographic ("Agent Engineering Assignment, Cost Controls and Architecture") · 2/ Vercel: https://lumina-eli.vercel.app/ · 3/ Loom: https://www.loom.com/share/5ec9f8bc90504989830eed0acc5ba357 · 4/ Loom URL placed inside /evals/report.json

> **Kotesh Bandhamravuri — 2026-09-18 23:03Z** — Your diagram is very helpful. thank you
> **Elie — 2026-09-19 06:02Z** — Happy to hear, thank you! I always try to map the architecture of whatever's pre-written in Hamza & Co's assignments, they're always very useful and a learning for other use cases we might have.

> **Jayita Chatterjee — 2026-09-23 16:12Z**
> Elie, this is thoughtful, production-minded work. Separate spend caps on Anthropic, Tavily and OpenAI are exactly the habit a forward-deployed engineer needs, and your architecture infographic helped others in the cohort. Your failing trajectory tells a real story: SerpApi timeouts led you to a bounded timeout and a switch to Tavily, taking errors from 17% to zero. The main gaps are speed. Your plan takes 7.6 seconds against a 4-second target, so try a faster model for planning, and the first text takes 3.4 seconds. Uploads also sit just over the 300 ms limit. Finally show memory carrying into a new thread.

## [16] Swarnav S Pujari — Fri Sep 18 2026 22:20 ET
https://lumina-ssp-6462s-projects.vercel.app/

> **Jayita Chatterjee — 2026-09-23 16:08Z**
> Swarnav, this is outstanding work. Every gate passes, grounding and recall are both perfect, and deep search reads 6.5 times the sources of quick. Your DESIGN.md is concrete and honest about cost, including catching that the internal DNS name also resolves to the worker. The grounding self-check in fetch_page is a thoughtful addition. To polish: have your planner write sub-questions a person would ask rather than search keywords, be careful about falling back to Opus under load, since that can quietly multiply your cost, and add your demo video.

## [17] Yasemin Ceyhan — Sat Sep 19 2026 00:22 ET
App: https://lumina-capella35.vercel.app · Evals: https://lumina-capella35.vercel.app/evals · Automated 82/85, no red lines, recall@5 30/30, grounding 0.97. Missing: TTFT p95 (9.0 s vs 2.5 s) and deep plan p95 (4.9 s vs 4.0 s). No demo video. Stack: Sonnet 5 writes answers, Sonnet 5 at low effort runs the tool loop, Haiku 4.5 plans deep searches · Tavily · Atlas M0 (Oregon) hybrid retrieval · Fly.io (sjc) + Vercel. Lessons: hidden thinking tokens truncated deep answers (turning thinking off for answer-writing cut Deep p95 from ~66 s to ~48 s); moving Fly to sjc next to Atlas cut DB round trip from ~70 ms to ~24 ms; a shared tool-call budget pool replaced an even per-sub-question budget.

> **Jayita Chatterjee — 2026-09-23 16:05Z**
> Yasemin, your debugging is excellent. Finding that hidden thinking tokens were cutting deep answers short, moving Fly next to Atlas, and switching to a shared tool-call pool are exactly the investigations this assignment is about. Deep search shows it: my "red nike shoes" test came back well structured, with sensible sub-questions, tagged sources, and honesty about missing prices. Quick search is the weak spot. "Who is the president of USA?" never fetched a page, answered from snippets that didn't name anyone, and still attached citations. Always fetch before answering, and don't cite a non-answer. It also took about 9 seconds at p95 before the first word. Finally, add at least three trade-offs to DESIGN.md, put the lessons from your post into your trajectory notes, and add the demo video.

## [18] Juan S Mejia Santamaria — Sat Sep 19 2026 00:38 ET
https://lumina-jsm.vercel.app/

> **Jayita Chatterjee — 2026-09-23 16:02Z**
> Juan, this is excellent work. Every gate passes, grounding and recall are both perfect, the first text arrives in 1.3 seconds, and /health honestly names all three models. Your trajectory notes are among the best in the cohort: you criticise your own plan, trace where the cost goes, and notice cited sources that failed verification. That's exactly the habit this assignment is building. Small things to polish: fetch_page reuses Tavily's text rather than reading the actual page.

## [19] Neha Mansinghka — Sat Sep 19 2026 05:25 ET
Vercel UI: https://lumina-ui-theta.vercel.app/ · Evals: https://lumina-ui-theta.vercel.app/evals · Missing: no video; TTFT p95 for quick fails. Lessons: first time using a coding agent, spent a lot of time and money; model turn latency is unpredictable; cold Tavily search latency blew the TTFT SLA; SerpAPI was worse cold but excellent warm, stuck with Tavily.

> **Jayita Chatterjee — 2026-09-23 15:57Z**
> Neha, this is a strong build. Grounding is 0.98, document recall is perfect, the cache always hits on repeats, and the indexer runs as its own process. Your Components, Communication and Trade-offs sections are clear and specific. The biggest fix is fetch_page: it reuses Tavily's short excerpt instead of reading the actual page, so in my test "who is the president of USA?" came back as "the sources don't say" with citations attached. Fetch the real page, and don't cite sources for a non-answer. Also replace the placeholders in your report (the video URL and "Atlas <tier>"), put your State section back to answering the design question, and write trajectory notes about what each run taught you, not just what happened.

## [20] Shobhit Gupta — Sat Sep 19 2026 10:06 ET
Repo: https://github.com/shobhit26gupta/lumina · App: https://lumina-theta-black.vercel.app/ · Ten "key learnings" (UI presentation-only; gateway as edge bouncer holding zero keys; agent internal-only ReAct loop; OpenRouter as single provider; tools as typed functions with plan_research gated by tool list; RAG chunk ~800 chars + brute-force cosine with Atlas $vectorSearch declared but not wired; one MongoDB for everything; findOneAndUpdate job queue; zod contract as glue that breaks when it drifts; evals and observability, "measure the deployed system, don't assume it works").

> **Jayita Chatterjee — 2026-09-23 15:54Z**
> Shobhit, your reflections are genuinely thoughtful. "Capability gating at the tool-list level" and "measure the deployed system, don't assume it works" are exactly the right lessons, and memory and deep search work at a fraction of a cent per answer. The core issue is grounding. Asked "who is president of USA?", LUMINA answered Joe Biden, citing sources that name Donald Trump. The model answered from its own training data and fetched only one of the five pages it listed. Make the answer come only from fetched page text. Also, when a provider fails, end the run as an error with a 502 rather than "done". Finally, enforce the wall-clock cap, restore the five DESIGN.md headings so your full write-up shows on /evals, and add your demo video.

## [21] Hafeez Syed — Sat Sep 19 2026 10:15 ET
App: https://lumina-web-jet-gamma.vercel.app · Github: https://github.com/hafeez-syed/lumina

> **Jayita Chatterjee — 2026-09-23 15:50Z**
> Hafeez, your architecture is clean. The gateway address never reaches the browser, the agent is private, and your DESIGN.md with diagrams is excellent. Deep search needs the most work: for "give me red nike shoes" your planner wrote six questions for the user instead of searchable ones, then researched only one and found a single source. Fix the planner so every sub-question can be searched and gets researched. Beyond that, cut token use, stop the empty-URL fetch_page loop, move capped runs to runs/failing/, leave packages/contract untouched, and add your trajectory notes and demo video.

## [22] ANURAG — Sat Sep 19 2026 11:37 ET
https://lumina-anuraglahon16s-projects.vercel.app/ · /evals · https://github.com/anuraglahon16/lumina (repo blurb: "Only fetched pages are citable; budgets and citation validity are enforced by the harness, not requested in a prompt.")

> **Jayita Chatterjee — 2026-09-23 15:46Z**
> Anurag, your thinking is some of the sharpest in the cohort. Catching that your tool-call cap undercounted real calls, and fixing it so every call counts by design, is exactly the kind of work this course is about. Grounding at 1.0 and recall of 0.97 show the care. The problem is that your deployment isn't the system you designed. On Vercel everything runs in one function, so the provider keys sit on the public edge and uploads index inline instead of after a 202, which the spec treats as a fail. Deploy the gateway and agent as separate services (Fly.io works well), move capped runs to runs/failing/, bring the error rate under 1%, and add your demo video.

## [23] Julia Druck — Sat Sep 19 2026 14:24 ET
App: https://lumina-jdruck.vercel.app · Evals: /evals · Demo: https://youtu.be/UCJNeOrAgss · 82/85. Measured over 79 answers: first text ≈1.6 s; zero errors; 98% of citations grounded, none dangling; deep reads ≈6x the sources of quick; repeats served from cache. Missed one target: plan ≈5 s vs 4 s, left as measured rather than re-run. Hardest part: getting it to search rather than answer from what it knew; prompt instructions changed what it said, not what it did; narrowing the offered tools worked. Built with Claude Code, gpt-5.6-luna via OpenRouter, Exa, Atlas, Fly.io, Vercel.

> **Jayita Chatterjee — 2026-09-23 15:41Z**
> Julia, this is superb engineering. Quick answers cost less than a tenth of a cent, deep search reads six times the sources of quick, and your write-up is full of real measurements. One example: you noticed that the model rewrites the same search query differently each time, and built cache normalisation around it. In your submission message you explained that telling the model in the prompt to search changed what it said but not what it did, and that only limiting which tools it was given actually worked. That is exactly the insight this assignment is after. The gap is on your /evals page, where the trajectory notes were written by your coding agent ("no learner review claimed"). Rewrite them in your own words, the same way you wrote that message. Also trim the trade-offs to your strongest four, and update the run notes, which still say "no video supplied".

## [24] Sahar Yarmohammadtoosky — Sun Sep 20 2026 11:49 ET
Live app: https://lumina-woad-chi.vercel.app · Evals: /evals · Video: https://youtu.be/VYFzADuqQ2I · 85/100 automated rows; all 16 SLAs pass against production: TTFT p95 2.1 s, grounding 0.99, recall@5 1.0, deep 4 sub-questions in parallel at $0.11 per answer. Agent has no public IP.

> **Jayita Chatterjee — 2026-09-23 15:35Z**
> Sahar, this is excellent work. Citations are fully grounded, document recall is perfect, every SLA target is met, and deep search runs its sub-questions as parallel subagents. Your trajectory notes stand out most: you saw that the thrash rule mistakes parallel subagents for thrashing, and that a client hanging up looks just like a crash in the run log. Those are the kinds of insights this assignment hopes for. Two small things to tidy up: /health should name Haiku alongside Sonnet, since Haiku writes your quick answers, and new rule precedents should be proposed separately rather than written into the provided quality/rules.json.

## [25] Beat Hubmann — Mon Sep 21 2026 16:39 ET
https://fde-1-lumina.vercel.app/evals

> **Jayita Chatterjee — 2026-09-23 15:29Z**
> Beat, this is an outstanding submission. Every gate passes, and deep search reads five and a half times the sources of quick with sub-questions researched in parallel. Your design decisions rest on real measurements, and /health honestly names both models you use. Your failing trajectory is a real incident, not a staged one, and it shows the system failing loud exactly as intended. To go further, let the router make a real choice when a Space is selected instead of always searching documents, and expand your trajectory notes a little. You clearly learned a lot, so put more of it on the page.

## [26] Xiaoya Lai — Tue Sep 22 2026 19:36 ET
app: https://lumina-ui-tau.vercel.app/ · evals: /evals · "Thank you for providing this interesting project!"

> **Jayita Chatterjee — 2026-09-23 15:24Z**
> Jessie, this is a fast, clean build with perfect document recall, sub-two-second first text, and a filter that removes invalid citations as the answer streams. Your DESIGN.md is one of the clearest in the cohort. The biggest gaps are the parts only you can write: both trajectory notes still say "TODO", and your failing trajectory doesn't show what actually failed. Grounding is just under target because some answers, including your own successful deep run, are written from search snippets without fetching the page, so make sure every cited source is actually fetched. Also move the worker to its own machine so uploads stop slowing down search, and return 404 for an unknown space.

> **Xiaoya Lai — 2026-09-23 17:20Z**
> Thank you @Jayita Chatterjee for checking my submission out! I have updated the trajectory in the evals: https://lumina-ui-tau.vercel.app/evals. Please let me know if there's anything else I can improve!

## [27] Gabriel Gutierrez — Wed Sep 23 2026 16:53 ET
https://gabo-lumina.vercel.app (the app) · https://gabo-lumina.vercel.app/evals (the scores and demo embedded there) · "Great learning experience!"

(no reply yet; posted after Jayita's sweep)
