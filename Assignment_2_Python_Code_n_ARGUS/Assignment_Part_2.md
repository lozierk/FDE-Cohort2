✍️

# Implement Semantic Search to Moment Search

Assignment Details on Maven Site: https://maven.com/boring-bot/ai-system-design/cohort-2/syllabus/modules/ba1ac3/wdj0mk3ssvs

## Objective

In this assignment, you will explore the concept of Moment RAG by reviewing an existing codebase, understanding its architecture, and implementing a comparable retrieval-augmented generation pipeline using a YouTube video transcript.

You will first build a baseline RAG system using simple semantic search, then implement a Moment RAG-style architecture and compare the two approaches.



------



## Task Description

You are required to select any YouTube video of your choice, extract its transcript, and use it as the knowledge source for a RAG system.

Your work should be completed in two stages:



### Part 1: Baseline Semantic Search RAG

Build a simple RAG pipeline using semantic search.

Your system should:

1. Extract or obtain the transcript from a YouTube video.
2. Split the transcript into meaningful chunks.
3. Generate embeddings for the transcript chunks.
4. Store the embeddings in a vector database or similarity search index.
5. Accept user queries and retrieve the most relevant transcript chunks.
6. Generate an answer using the retrieved context.



### Part 2: Moment RAG Implementation

Review the provided Moment RAG codebase and understand its architecture.

Then, implement your own version of the Moment RAG approach using the same YouTube transcript.

Your implementation should focus on:

1. Identifying meaningful “moments” within the video transcript.
2. Structuring transcript segments around those moments.
3. Improving retrieval by using moment-level context instead of only fixed-size chunks.
4. Comparing Moment RAG retrieval results with the baseline semantic search RAG.
5. Explaining how Moment RAG changes or improves the quality of answers.



------



## Required Deliverables

Submit one of the following:



### Option 1: Brief Presentation

A short slide deck (similar to Assignment 1) that includes:

1. The YouTube video selected and why you chose it.
2. A summary of your understanding of the Moment RAG codebase.
3. Your baseline semantic search RAG implementation.
4. Your Moment RAG-style implementation.
5. Comparison between the two approaches.
6. Key findings, limitations, and possible improvements.



### Option 2: Loom Video

A short Loom video walkthrough that includes:

1. Explanation of the selected video and transcript.
2. Demo of the baseline semantic search RAG.
3. Demo of the Moment RAG implementation.
4. Explanation of the architecture and design choices.
5. Comparison of outputs from both systems.
6. Final findings and reflections.



##  

------



## Expected Outcome

By the end of this assignment, you should be able to:

1. Understand how standard semantic-search-based RAG works.
2. Explain the limitations of simple transcript chunking.
3. Understand the Moment RAG architecture.
4. Implement a Moment RAG-style retrieval pipeline.
5. Compare retrieval quality between chunk-based and moment-based approaches.
6. Present your technical findings clearly.





IMPORTANT NOTE - In Hamza's FDE Cohort 1 class we implemented the Moment Search as an assignment.  I have not reviewed this "Assignment_Part_2" versus the work we did in the FDE Cohort 1 Class and the Moment Search assignment.  Please evaluate if our prior work has any relevance to this new project.
Prior work is located in my folders: 

~/Users/kurtlozier/Learning/Hamza_Cohort_01_Forward_Deployed_Engineering_Bootcamp/Claude_Project 01_Chrome_Extension_Beats_Google_Translate/multi-agent-course/FDE/Assignment_3_Moment_Search

and

~/Users/kurtlozier/Learning/Hamza_Cohort_01_Forward_Deployed_Engineering_Bootcamp/Claude_Project 01_Chrome_Extension_Beats_Google_Translate/multi-agent-course/FDE/Assignment_3_Moment_Search_Scaled

**First submission from a classmate to review and benchmark our progress against:**

**Classmate: MUTHUKUMAR SELVARASU**

Maven Submission Site: https://maven.com/boring-bot/ai-system-design/cohort-2/channel?channelId=ed115403-ec79-4ba8-af6a-50f1ee241388

##### MUTHUKUMAR SELVARASU

4:48AM

Implement Semantic Search to Moment Search

 Muthukumar Selvarasu, FDE Platform Engineer

Repo: https://github.com/Muthukumar-Selvarasu/agentic-semantic-search

Presentation (five slides): [github.com/Muthukumar-Selvarasu/agen…earch-to-Moment-Search.pptx](https://github.com/Muthukumar-Selvarasu/agentic-semantic-search/blob/main/Semantic-Search-to-Moment-Search.pptx)

Live test recording (python [app.py](http://app.py/) on the Stanford 2005 transcript): [github.com/Muthukumar-Selvarasu/agen…rch/blob/main/live-test.mp4](https://github.com/Muthukumar-Selvarasu/agentic-semantic-search/blob/main/live-test.mp4)

The deck covers the video choice, the baseline chunk index, Moment RAG, the side-by-side results, and the findings. The video is the live run: transcript download, moment inventory, both questions, and the scorecard.

