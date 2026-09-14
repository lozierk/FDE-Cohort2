import assert from 'node:assert/strict';
import test from 'node:test';
import pino from 'pino';
import {
  AskStreamEvent,
  DoneEvent,
  RunLog,
  SourcesEvent,
  TokenEvent,
  TraceEvent,
  unresolvedCitations
} from '@lumina/contract';
import { searchLru } from '../src/cache/search-cache.js';
import { doneEventFor, runQuickLoop, type QuickLoopInput } from '../src/loop/quick.js';
import { FakeEmbedder } from '../src/providers/fake-embeddings.js';
import { FakeLlm, type FakeTurn } from '../src/providers/fake-llm.js';
import { FakeSearch } from '../src/providers/fake-search.js';
import { runLogFor } from '../src/runlog.js';

const log = pino({ level: 'silent' });

interface Frame {
  event: string;
  data: unknown;
}

function harness(script: FakeTurn[] | undefined, over: Partial<QuickLoopInput> = {}) {
  const frames: Frame[] = [];
  const llm = new FakeLlm(script);
  const search = new FakeSearch();
  const input: QuickLoopInput = {
    query: 'What is Tavily?',
    mode: 'auto',
    userId: 'test-user',
    threadId: 'thr_test',
    requestId: 'req_test',
    history: [],
    providers: { llm, search, embedder: new FakeEmbedder() },
    caps: { maxToolCalls: 8, maxWallClockSec: 90 },
    searchCacheTtlSeconds: 60,
    emit: (event, data) => frames.push({ event, data }),
    log,
    ...over
  };
  return { frames, llm, search, input };
}

test('the stream is trace* → sources → token* → done and every frame parses against the contract', async () => {
  searchLru.clear();
  const { frames, input } = harness([
    { tool: 'web_search', input: { query: 'Tavily' } },
    { text: 'ready' },
    { text: 'Tavily returns extracted page text [1], which is what an answer is built from [2].' }
  ]);

  const result = await runQuickLoop(input);
  const done = doneEventFor(result);
  frames.push({ event: 'done', data: done });

  const order = frames.map((f) => f.event);
  assert.deepEqual(order.filter((e, i) => order.indexOf(e) === i), ['trace', 'sources', 'token', 'done'], 'first appearance order');
  assert.ok(order.indexOf('sources') < order.indexOf('token'), 'sources arrives before the first token');
  assert.equal(order.at(-1), 'done');

  for (const f of frames) AskStreamEvent.parse({ event: f.event, data: f.data });

  const trace = frames.filter((f) => f.event === 'trace').map((f) => TraceEvent.parse(f.data));
  assert.equal(trace.length, 1);
  assert.equal(trace[0]!.tool, 'web_search');
  assert.equal(trace[0]!.step, 1);
  assert.equal(trace[0]!.ok, true);

  const sources = SourcesEvent.parse(frames.find((f) => f.event === 'sources')!.data);
  assert.equal(sources.length, 2, 'the fake search returns two pages, both with text');

  const text = frames
    .filter((f) => f.event === 'token')
    .map((f) => TokenEvent.parse(f.data).text)
    .join('');
  assert.equal(text, result.answer);
  assert.deepEqual(unresolvedCitations(text, sources), [], 'every [n] resolves to a source');

  assert.equal(done.terminated, 'done');
  assert.equal(done.depth, 'quick');
  assert.ok(done.ttftMs > 0 && done.ttftMs <= done.latencyMs);
  assert.ok(done.costUsd > 0, 'three fake calls and one uncached search cost something');
});

test('the run log validates against the contract and carries the tool calls in order', async () => {
  searchLru.clear();
  const { input } = harness([
    { tool: 'web_search', input: { query: 'Tavily' } },
    { tool: 'fetch_page', input: { url: 'https://not-in-this-request.test' } },
    { text: 'ready' },
    { text: 'An answer [1].' }
  ]);
  const result = await runQuickLoop(input);
  const runLog = RunLog.parse(runLogFor({
    requestId: 'req_test',
    userId: 'test-user',
    threadId: 'thr_test',
    query: 'What is Tavily?',
    route: '/threads/:threadId/ask',
    status: 200,
    depth: 'quick',
    result
  }));

  assert.deepEqual(runLog.toolCalls.map((t) => t.name), ['web_search', 'fetch_page']);
  assert.equal(runLog.toolCalls[0]!.ok, true);
  assert.equal(runLog.toolCalls[1]!.ok, false);
  assert.match(runLog.toolCalls[1]!.error ?? '', /url not in this request's results/);
  assert.equal(runLog.depth, 'quick');
  assert.equal(runLog.terminated, 'done');
  assert.ok(runLog.tokens > 0 && runLog.wallClockSec >= 0 && runLog.costUsd > 0);
});

test('a failed tool is a visible trace step with ok:false and a non-empty error (rule A1)', async () => {
  searchLru.clear();
  const { frames, input } = harness([
    { tool: 'fetch_page', input: { url: 'https://nowhere.test/page' } },
    { text: 'Nothing was retrievable, so there is nothing to cite.' }
  ]);
  await runQuickLoop(input);
  const trace = frames.filter((f) => f.event === 'trace').map((f) => TraceEvent.parse(f.data));
  assert.equal(trace.length, 1);
  assert.equal(trace[0]!.ok, false);
  assert.ok((trace[0]!.error ?? '').trim().length > 0);
});

test('the tool-call cap stops the loop with terminated:"cap" and still answers', async () => {
  searchLru.clear();
  const script: FakeTurn[] = Array.from({ length: 10 }, (_, i) => ({
    tool: 'web_search',
    input: { query: `probe ${i}` }
  }));
  script.push({ text: 'A partial answer [1].' });
  const { frames, input } = harness(script, { caps: { maxToolCalls: 2, maxWallClockSec: 90 } });

  const result = await runQuickLoop(input);
  assert.equal(result.terminated, 'cap');
  assert.equal(result.toolCalls.length, 2, 'the cap is 2 and the loop ran exactly 2');
  assert.equal(frames.filter((f) => f.event === 'trace').length, 2);
  assert.ok(frames.some((f) => f.event === 'token'), 'a capped run still returns an honest partial answer');
  assert.equal(DoneEvent.parse(doneEventFor(result)).terminated, 'cap');
});

test('the wall-clock cap stops the loop with terminated:"cap"', async () => {
  searchLru.clear();
  let clock = 0;
  const script: FakeTurn[] = Array.from({ length: 10 }, () => ({ tool: 'web_search', input: { query: 'probe' } }));
  script.push({ text: 'partial [1]' });
  const { input } = harness(script, {
    caps: { maxToolCalls: 8, maxWallClockSec: 5 },
    now: () => {
      clock += 1200;
      return clock;
    }
  });
  const result = await runQuickLoop(input);
  assert.equal(result.terminated, 'cap');
  assert.ok(result.toolCalls.length < 8, 'it stopped on time, not on tool count');
});

test('a throwing provider ends the run with terminated:"error" and no answer', async () => {
  searchLru.clear();
  const { frames, input } = harness([{ throws: 'anthropic: 500 overloaded_error' }]);
  const result = await runQuickLoop(input);
  assert.equal(result.terminated, 'error');
  assert.match(result.error ?? '', /llm provider failed: anthropic: 500 overloaded_error/);
  assert.equal(result.answer, '', 'no plausible answer is invented');
  assert.equal(frames.filter((f) => f.event === 'token').length, 0);
  assert.equal(frames.filter((f) => f.event === 'done').length, 0);
});

test('a quick run refuses plan_research, and the refusal never appears as a trace step', async () => {
  searchLru.clear();
  const { frames, llm, input } = harness([
    { tool: 'plan_research', input: { question: 'What is Tavily?' } },
    { tool: 'web_search', input: { query: 'Tavily' } },
    { text: 'ready' },
    { text: 'An answer [1].' }
  ]);

  const result = await runQuickLoop(input);

  const traced = frames.filter((f) => f.event === 'trace').map((f) => TraceEvent.parse(f.data).tool);
  assert.ok(!traced.includes('plan_research' as never), 'a quick trace never names plan_research');
  assert.ok(!result.toolCalls.some((t) => (t.name as string) === 'plan_research'), 'nor does the run log');
  assert.deepEqual(traced, ['web_search'], 'the loop carried on with the tools it does offer');

  // The model was told, in the tool_result, why it did not get what it asked for.
  const refusal = llm.calls
    .flatMap((c) => c.messages)
    .flatMap((m) => m.content)
    .find((b) => b.type === 'tool_result' && b.is_error && b.content.includes('plan_research'));
  assert.ok(refusal, 'the refusal went back to the model as an is_error tool_result');
});

test('the default fake script searches once and then answers, citing only real sources', async () => {
  searchLru.clear();
  const { frames, input } = harness(undefined);
  const result = await runQuickLoop(input);
  const sources = SourcesEvent.parse(frames.find((f) => f.event === 'sources')!.data);
  assert.equal(result.terminated, 'done');
  assert.deepEqual(unresolvedCitations(result.answer, sources), []);
});

test('mode=web on an empty thread searches before the first LLM call, and mode=auto does not', async () => {
  searchLru.clear();
  const web = harness([{ text: 'ready' }, { text: 'An answer [1].' }], { mode: 'web' });
  await runQuickLoop(web.input);
  assert.equal(web.search.queries.length, 1, 'the loop issued the first search itself');
  assert.equal(TraceEvent.parse(web.frames[0]!.data).reason, 'mode=web: search first');

  searchLru.clear();
  const auto = harness([{ text: 'ready' }, { text: 'Nothing was retrieved.' }], { mode: 'auto' });
  await runQuickLoop(auto.input);
  assert.equal(auto.search.queries.length, 0, 'auto asks the model first');
});

test('mode=web on a fresh thread answers straight from the preflight when it returned two pages of text', async () => {
  searchLru.clear();
  // ONE scripted turn: the fake search returns two results with content, so the loop never
  // asks the model whether to search again; the single turn is the synthesis.
  const web = harness([{ text: 'From the preflight [1] and [2].' }], { mode: 'web' });
  const result = await runQuickLoop(web.input);
  assert.equal(result.terminated, 'done');
  assert.equal(web.search.queries.length, 1, 'the preflight search is the only retrieval');
  assert.equal(web.frames.filter((f) => f.event === 'trace').length, 1, 'the preflight is the only step');
  assert.equal(web.llm.calls.length, 1, 'no research turn: the one model call was the synthesis');
  assert.equal(web.llm.calls[0]?.tools?.length ?? 0, 0, 'the synthesis call offers no tools');
  assert.match(result.answer, /From the preflight \[1\] and \[2\]/);
  const sources = SourcesEvent.parse(web.frames.find((f) => f.event === 'sources')!.data);
  assert.equal(sources.length, 2);
  assert.deepEqual(unresolvedCitations(result.answer, sources), []);

  // A follow-up on the same thread keeps its research turn: no preflight, the model decides.
  searchLru.clear();
  const followUp = harness([{ text: 'ready' }, { text: 'Still [1].' }], {
    mode: 'web',
    history: [{ role: 'user', content: 'What is Tavily?' }, { role: 'assistant', content: 'A search API.' }]
  });
  await runQuickLoop(followUp.input);
  assert.equal(followUp.search.queries.length, 0, 'no preflight on a follow-up');
  assert.equal(followUp.llm.calls.length, 2, 'research turn, then synthesis');
});

test('mode=web keeps its research turn when the preflight found fewer than two pages of text', async () => {
  searchLru.clear();
  const web = harness([{ tool: 'fetch_page', input: { url: 'https://example.test/only/1' } }, { text: 'ready' }, { text: 'Thin [1].' }], {
    mode: 'web'
  });
  // One result with text, one without: under the threshold, so the model gets its turn.
  web.search.search = async (query: string) => {
    web.search.queries.push(query);
    return [
      { title: 'one', url: 'https://example.test/only/1', snippet: 's', content: `${query} is described here in enough prose to quote from.` },
      { title: 'two', url: 'https://example.test/only/2', snippet: 'no page text' }
    ];
  };
  await runQuickLoop(web.input);
  assert.equal(web.search.queries.length, 1, 'the preflight ran');
  assert.ok(web.llm.calls.length >= 2, 'a research turn ran before the synthesis');
  assert.ok(web.llm.calls[0]?.tools?.length, 'the first model call offered tools: it was a research turn');
});

test('empty retrieval produces an answer with no sources and no citations', async () => {
  searchLru.clear();
  const { frames, input } = harness([{ text: 'ready' }, { text: 'The sources do not answer this.' }]);
  const result = await runQuickLoop(input);
  const sources = SourcesEvent.parse(frames.find((f) => f.event === 'sources')!.data);
  assert.deepEqual(sources, []);
  assert.deepEqual(unresolvedCitations(result.answer, sources), []);
  assert.equal(result.searchCached, false, 'no search at all is not a cache hit');
});
