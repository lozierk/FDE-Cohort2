# LUMINA — Maven submission (Assignment 1, FDE Cohort 02)

Submitted by Kurt Lozier on 2026-09-15 11:02 ET to the course home
(maven.com/boring-bot/ai-system-design, "Build a Perplexity Clone", posted to the project
channel). This is the exact text submitted, for the record.

---

LUMINA — a Perplexity-style search agent that searches the web, reads the real pages, and
streams back an answer with citations you can click. It has two gears: a fast quick mode, and a
deep mode that plans sub-questions before it researches. It also runs RAG over PDFs you upload,
with page-level citations, and it remembers your preferences across conversations.

Try it: https://lumina-claude.vercel.app

Scores and live trajectories: https://lumina-claude.vercel.app/evals

Code and write-up: https://github.com/lozierk/Claude_Build_Submission

A few things worth a look: it runs two models split by where the difference actually shows —
Haiku 4.5 for speed, Sonnet 5 only for the deep answer, chosen from a measured A/B. It scores
85/85 automated against the grader's own eval on the deployed app. And the /evals page lets you
replay a real deep-search run step by step. The write-up is honest about the one number I chose
to stand on rather than re-roll to green.

Kurt

---

Deadline Fri 2026-09-18. Video not included at submission (Kurt may add one by Friday).
