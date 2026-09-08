
Build a Perplexity Clone
Project Due Fri. Sep 18

Assignment 1: LUMINA
LUMINA is a streaming, citation-grounded AI research agent that can search the web, read uploaded documents, remember information across sessions, and perform Deep Search for complex questions.

**CRITICAL BUILD INSTRUCTIONS FROM KURT**
In this first assignment of Hamza's second Cohort of his FDE class I want to explore each assignment with both a Claude build using the Orchestration ladder we've established and and Codex build using Astra 6.  This will be my (Kurt's) way of developing a better understanding the differences between the Claude and Codex in their current releases.

I will expect a github repo for Assignment 1 with 2 distinct builds under it, unless you both (Claude and Codex) decide that 2 distince repos are required.

**YOUR VERY FIRST TASK - AGREE AND CREATE A MESSAGE BOARD**
In addition I expect you both (Claude and Codex) to communicate with each other by setting up a message board in the /Users/kurtlozier/Learning/Hamza_Cohort_02_Forward_Deployed_Engineering_Bootcamp/Assignment_1_LUMINA/ folder.  Keep track with timestamps and when a message was both written, received and how it was acted on.  If additional information is required to be communicated, place it on the message board.  For any messages that need my attention preface them with "ATTN: KURT" and I will reply when I'm able.  If you want to use WhatsApp or some other tool to message me to get my attention and received a reply back quicker propose a solution both of you can use.

Tools and services: if there are any external tools you require e.g. Supabase, Mem0, Vercel, Fly.io etc, propose your requirements and recommendations.  You both must decide on the external tools and then I will provide you with the accounts, API Keys etc for your usage

Most importantly, work well together to achieve better solutions.  I don't need both solutions to be identical, you can have differences in how you achieve the goal, however it is important for each of you (Claude and Codex) to support each other

For Claude, I suggest when it's time to actually build you first use the /spec-wargaming skill.  I also expect you (Claude) to share this skill with Codex.  The skill contains a "Red Teaming" section which you each will hand to the other to perform and then provide the results back to the other.  Keep these results in the base folder with appropriate file names and communicate via the message board when your "Red Teaming" project is complete for the other to read and incorporate the results.

The build folders are below the current working folder of /Users/kurtlozier/Learning/Hamza_Cohort_02_Forward_Deployed_Engineering_Bootcamp/Assignment_1_LUMINA/
../Claude_Build/
../Codex_Build/

Below is copied from the assignment page for the class, you can also have access to it via the Chrome Extension, Headless Chrome or any other webpage reading tools you have at your disposal.

You build two Express services:



Gateway: CORS, validation, user/request IDs, rate limiting, logging, SSE forwarding, UI serving.

Agent Service: agent loop, LLM/tool calls, web search, page fetching, memory, RAG, Deep Search, background jobs, run logs.



Core requirements:

Tool-using agent loop with visible traces.

Web search followed by actual page fetching.

SSE streaming with sources before answer tokens.

Citations must be grounded in retrieved evidence.

Quick mode has hard execution limits and must report capped runs honestly.

Thread memory + long-term memory, with memories visible and deletable.

Async document upload, parsing, chunking, embedding, and indexing.

RAG with page-level citations.

Deep Search plans sub-questions, researches them, gathers broader evidence, and merges citations.

Quick and Deep must stay separate.

Log latency, cost, tokens, tool calls, errors, cache behavior, and termination reason.

Keep secrets only in environment variables.



Recommended order:

Week 1: agent loop → search/fetch → SSE/citations → cache → threads → memory → run logs.

Week 2: document RAG → async indexing → Deep Search → gateway → deployment → evaluation.



Link : https://github.com/hamzafarooq/multi-agent-course/tree/main/modules/Module_1_Agent_Foundations_Harness_System_Design/Assignment_1_Lumina

https://maven.com/boring-bot/advanced-llm/2026-03/syllabus/modules/6aedc9/c50pmoaguo