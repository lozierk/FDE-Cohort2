# LUMINA demo video — first pass, modelled on the A3 sub-agent walkthrough

Written 2026-09-24 ≈ 10:50 ET by Claude for Kurt. Source for the model: `A3_walkthrough_final.mp4`
(Google Drive, 5.4 MB, 1:51.8, 1920×1080 at 30 fps), read by sampling a frame every three seconds
and measuring silences with ffmpeg. No transcription tool is installed on this machine, so the
narration below is what the burned-in captions showed; a few words between samples may be missing.
Jayita's constraint for the LUMINA demo: 90 seconds or less, URL inside `report.json`.

## What the A3 video does (as observed)

**Format.** One 16:9 1080p master. Kurt's voice (clone) narrates; no talking-head render. A static
circular illustrated portrait from the brand-assets repo sits bottom-right on every frame, over
the content. Phrase captions, three to five words, white with a dark outline, lower third, always
on. A 1.6 s silent lead-in before the first word (the kit's 1.4 s constant, near enough).

**Structure, from the silences at 53.8 s, 90.3 s and 103.8 s (four spoken sections and a tail):**

| Time | Section | Visual | What is said (from captions) |
|---|---|---|---|
| 0:00–0:14 | Title card | Slate-blue card. Title "Module 3: auth-boundary-auditor", subtitle "What you'll see in the next minute", footer "Kurt Lozier · Agentic AI for Product Managers, Cohort 3". Two bullets build in as they are spoken. | "…wrote the script. Module 3 asked us to build a specialized subagent for our… or a skill. In the next minute, you'll see it run, a script check its verdict, …" |
| 0:14–0:54 | The run | Full-frame macOS Terminal recording, sped up. The `cd`, the `READ_ONLY` allowlist, the `claude -p "Use the auth-boundary-auditor subagent…" --allowedTools "$READ_ONLY"` line, then the subagent's tool calls scrolling (Bash git ls-files, Glob, Read of every route), "auditor working … 1:50", then the report with "Summary for the caller: PASS WITH EXCEPTIONS". | "…auth boundary auditor for Viome Meals. It asks one thing: can any code reach the LLM, the database, a secret, or … check? Here it runs headless, sped up to cover some long blank screens with the terminal running. It reads every entry … one-line verdict. A small script recomputes that verdict. It exits 0." |
| 0:54–1:30 | Run four and the design choice | Terminal: `npm run audit:auth:verdict`, "PASS verdict matches"; then `grep -n "Verdict" run4_planted_violations.md` → `**FAIL**`, the V2 finding (POST unguarded, GET guarded, still calls the LLM); then `sed -n '1,10p' .claude/agents/auth-boundary-auditor.md` showing the front matter (model claude-sonnet-5, tools Read/Grep/Glob/Bash, read-only), a grep proving no "conversation" in the agent file, then the exceptions file. | "The verdict holds. This is run four. I planted three violations in a repo copy. It caught all three. Watch this route. GET is guarded, POST is not, and it still calls the LLM. My Assignment 2 red team predicted this exact bug. The key choice: … build conversation. It gets the rules and the repo, nothing else. A checker … starts to share it. Mine can't. Next, …" |
| 1:30–1:44 | Recap card | Same card style, subtitle "A Claude Code subagent for Viome Meals". Five bullets build in as spoken: read-only, reports never fixes · runs headless, fixed report, one-line verdict · a script recomputes the verdict, so the rule is code, not judgment · run four: three planted, three caught · it never sees the build conversation. | "recap: One subagent, read-only. It reports and never fixes. Runs headless. Fixed report, one-line verdict. A script recomputes the verdict, so the rule is code, not judgment. Run four: three planted violations, three caught. It never sees the build conversation. That's the auditor." |
| 1:44–1:49 | Close | Recap card held. | "One question, one report, one verdict, and a checker that can't fix what it finds. Thanks for watching. Every run …" |
| 1:49–1:52 | Tail | Card held, silent. | |

**Why it works as a model for us.** No HeyGen quota, no avatar look to approve, no lip sync to
check: the portrait is a badge, the screen is the content, the voice carries it. Three recipe
shapes cover the whole video: a title/recap card with a bullet build, a full-frame screen
recording (sped up where the machine is thinking), and captions throughout. The narration says
what the viewer is looking at and why it matters, one claim per sentence, every claim visible on
screen.

**Two differences from the kit's locked style, noted not judged.** Captions are outlined text
rather than the dark rounded pill, and the stitches between sections are about 0.8–0.9 s of
silence rather than the 0.15 + 0.35 s constants. Both read fine at this length.

## LUMINA first pass: same shape, 88 seconds

Same three recipes, same badge, same card style with our title and footer. Screen recordings come
from the live app at lumina-claude.vercel.app; Playwright can drive and record them headlessly, or
QuickTime by hand. Deep search takes 40–70 s live, so that section is sped up exactly the way the
A3 terminal beat was, with the plan frame shown at real speed.

| # | Time | Section | Visual | Draft narration (≈ 220 words, trim to taste) |
|---|---|---|---|---|
| 0 | 0:00–0:10 | Title card, bullet build | "Assignment 1: LUMINA" · "What you'll see in the next ninety seconds" · footer "Kurt Lozier · Forward Deployed Engineering Bootcamp, Cohort 2". Bullets: cited answers from real pages · deep search that plans first · memory across threads · the grader's eval, 85 of 85 | "LUMINA is my Perplexity-style search agent. In the next ninety seconds you'll see a cited answer, a deep search that plans before it reads, memory that crosses threads, and the grader's own eval at 85 of 85." |
| 1 | 0:10–0:25 | Quick ask | Browser: type the question, the trace opens with recall_memory then web_search, sources appear, the answer streams. Click a citation; the page opens. | "Ask a question. The agent first recalls what it knows about you, then searches, and streams an answer where every bracket is a real page it read. Click one and you land on the text it quoted." |
| 2 | 0:25–0:50 | Deep ask | Switch to Deep. Plan frame paints (real speed). Sub-questions fan out (sped up). Final answer with one merged numbering, "What is still unknown" at the end. | "Switch to deep. The plan paints first, before any retrieval: sub-questions, each with a reason. They run three at a time against one shared source registry, so the citations merge into a single numbering. Haiku does the research. Sonnet writes only this final answer, a split I chose from a measured comparison." |
| 3 | 0:50–1:05 | Memory | Thread A: "Remember this preference for all future answers: …". New thread, a question the preference changes; the answer honours it. Flash /memory. | "Tell it a preference. Open a new thread and ask again: the answer honours it, because recalling memory is the loop's own first step, not something the model has to remember to do." |
| 4 | 1:05–1:20 | /evals | The gates table, all green, 85/85; scroll to the 45 ms row and its note; open the deep-run replay and step it twice. | "This is the grader's eval, run against the deployed app: every gate green, 85 of 85. One number missed by 45 milliseconds on the first run, and I kept that run on the page instead of rerunning until it went green. And any real deep run replays step by step." |
| 5 | 1:20–1:28 | Recap card, bullet build | Bullets: cited answers from pages it read · deep search plans first, then merges · memory crosses threads · measured on the grader's path, not my own | "Recap: cited answers from pages it read. Deep search plans first. Memory crosses threads. Measured on the grader's path, not my own. Thanks for watching." |

**Facts the script asserts, each checkable on screen:** every citation resolves to a fetched page
(report: grounding 0.985, 0 dangling); deep concurrency 3 and one registry (DESIGN.md); Haiku
research, Sonnet deep answer (`/health`); memory recall is the loop's first step (trace step 1 on
every quick run); 85/85 and the 45 ms miss (served report, run 1 kept as `reports/*.deployed-1.json`).

**Build order, kit gates kept:** script approved → voice test (2 s, then section 0) → full audio
→ Playwright captures of sections 1–4 → one section built as the style sample (section 0, the
card recipe) → remaining sections → assemble → rough cut → finalize → `VIDEO=<url>` on the report
rebuild → gateway deploy. Host on YouTube unlisted or Loom; the report carries the URL.

**Open for Kurt.** Whether to keep the badge or go badge-free for the screen sections; whether the
memory section earns its 15 s or folds into the quick ask; the exact question for the deep ask
(something with a real "unknown" so the honesty line shows).
