import assert from 'node:assert/strict';
import { test } from 'node:test';
import { looksLikeMemoryRequest, looksStandalone } from '../src/loop/standalone.js';

// The 20 distinct web queries the bench sends down one thread (benchmark/queries.json).
// Every one must preflight, or the bench's p95 lands on a research turn.
const BENCH_WEB = [
  'What are the GPAI obligations in the EU AI Act?',
  'How does reciprocal rank fusion combine two ranked lists?',
  'What is the difference between BM25 and dense vector retrieval?',
  'What is MongoDB Atlas Vector Search and what are its index limits?',
  'How do Server-Sent Events differ from WebSockets?',
  'What is a read-your-write consistency problem in search indexes?',
  'What does the Tavily extract endpoint return?',
  'How does SerpApi price its search requests?',
  'What is prompt caching and when does it save money?',
  'What is the p95 latency a user tolerates before a page feels broken?',
  'How large is a text-embedding-3-small vector?',
  'What is GridFS and when should you use it instead of a bucket?',
  'What is a TTL index in MongoDB?',
  'How does pptxgenjs render a slide deck?',
  'What does the OpenAI gpt-image-1 model cost per image?',
  'What is the agentic loop in an LLM application?',
  'Why do proxies buffer Server-Sent Events?',
  'What is chunking and why does chunk size matter for retrieval?',
  'What is a page locator in a document citation?',
  'How do you measure citation grounding without an LLM judge?'
];

test('every bench web query stands on its own, pronouns in the middle included', () => {
  for (const q of BENCH_WEB) assert.equal(looksStandalone(q), true, q);
});

test('a follow-up that leans on the thread is not standalone', () => {
  const contextual = [
    'Why?',
    'Tell me more',
    'And GridFS?',
    'And what does it cost?',
    'What about its pricing?',
    'How about the index limits?',
    'So which one should I use?',
    'How does it compare to BM25?',
    'What are its limits?',
    'Can you expand on that?',
    'Is that the same as the previous one?',
    'Now do the same for WebSockets'
  ];
  for (const q of contextual) assert.equal(looksStandalone(q), false, q);
});

test('punctuation and case do not change the verdict', () => {
  assert.equal(looksStandalone('  WHAT is a TTL index in MongoDB?!  '), true);
  assert.equal(looksStandalone('...and its limits?'), false);
});

test('an instruction about the user is a memory request, a question about the world is not', () => {
  // The bench's own wording, then the shapes a person would use.
  for (const q of [
    'Remember this preference for all future answers: Always answer in British English and keep answers under 100 words.',
    'Please remember that I work in digital health.',
    'From now on, answer in bullet points.',
    'Keep in mind I am on the US East Coast.',
    'Forget what I said about my timezone.',
    'My name is Kurt.',
    'I prefer short answers.'
  ]) assert.equal(looksLikeMemoryRequest(q), true, q);

  for (const q of BENCH_WEB) assert.equal(looksLikeMemoryRequest(q), false, q);
  assert.equal(looksLikeMemoryRequest('How does a TTL index remember when to expire a document?'), true, 'a false positive we accept: it costs one model turn, not a wrong answer');
});
