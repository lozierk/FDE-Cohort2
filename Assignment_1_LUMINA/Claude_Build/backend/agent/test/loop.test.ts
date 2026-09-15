import './mongo-fallback.js';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
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
import { llmCostUsd } from '../src/config/model.js';
import { doneEventFor, runQuickLoop, type QuickLoopInput } from '../src/loop/quick.js';
import { FakeEmbedder } from '../src/providers/fake-embeddings.js';
import { FakeLlm, type FakeTurn } from '../src/providers/fake-llm.js';
import { FakeSearch } from '../src/providers/fake-search.js';
import { runLogFor } from '../src/runlog.js';
import { closeDb } from '../src/db.js';

// The recall step opens the in-memory Mongo; close it or the test process never exits.
after(async () => closeDb());

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
  assert.equal(trace.length, 2, 'the memory recall the loop always makes, then the one scripted search');
  assert.equal(trace[0]!.tool, 'recall_memory');
  assert.equal(trace[1]!.tool, 'web_search');
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

  assert.deepEqual(runLog.toolCalls.map((t) => t.name), ['recall_memory', 'web_search', 'fetch_page']);
  assert.equal(runLog.toolCalls[0]!.ok, true);
  assert.equal(runLog.toolCalls[1]!.ok, true);
  assert.equal(runLog.toolCalls[2]!.ok, false);
  assert.match(runLog.toolCalls[2]!.error ?? '', /url not in this request's results/);
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
  assert.equal(trace.length, 2, 'recall, then the failed fetch');
  assert.equal(trace[1]!.tool, 'fetch_page');
  assert.equal(trace[1]!.ok, false);
  assert.ok((trace[1]!.error ?? '').trim().length > 0);
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
  assert.deepEqual(traced, ['recall_memory', 'web_search'], 'the loop carried on with the tools it does offer');

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
  assert.equal(TraceEvent.parse(web.frames[0]!.data).tool, 'recall_memory', 'memory is always the first step');
  assert.equal(TraceEvent.parse(web.frames[1]!.data).reason, 'mode=web: search first');

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
  assert.equal(web.frames.filter((f) => f.event === 'trace').length, 2, 'recall, then the preflight search: no other step');
  assert.equal(web.llm.calls.length, 1, 'no research turn: the one model call was the synthesis');
  assert.equal(web.llm.calls[0]?.tools?.length ?? 0, 0, 'the synthesis call offers no tools');
  assert.match(result.answer, /From the preflight \[1\] and \[2\]/);
  const sources = SourcesEvent.parse(web.frames.find((f) => f.event === 'sources')!.data);
  assert.equal(sources.length, 2);
  assert.deepEqual(unresolvedCitations(result.answer, sources), []);

  // A follow-up that leans on the thread keeps its research turn: no preflight, the model
  // reads the history and decides.
  searchLru.clear();
  const history = [{ role: 'user' as const, content: 'What is Tavily?' }, { role: 'assistant' as const, content: 'A search API.' }];
  const followUp = harness([{ text: 'ready' }, { text: 'Still [1].' }], {
    mode: 'web',
    query: 'And what does it cost?',
    history
  });
  await runQuickLoop(followUp.input);
  assert.equal(followUp.search.queries.length, 0, 'no preflight on a follow-up');
  assert.equal(followUp.llm.calls.length, 2, 'research turn, then synthesis');

  // A question that stands on its own gets the fresh-thread treatment even mid-thread: the
  // bench sends 40 such questions down one thread, and a model turn on each is the p95.
  searchLru.clear();
  const standalone = harness([{ text: 'From the preflight [1] and [2].' }], {
    mode: 'web',
    query: 'What is a TTL index in MongoDB?',
    history
  });
  const mid = await runQuickLoop(standalone.input);
  assert.equal(mid.terminated, 'done');
  assert.deepEqual(standalone.search.queries, ['What is a TTL index in MongoDB?'], 'the preflight searched the user\'s words');
  assert.equal(standalone.llm.calls.length, 1, 'no research turn: the one model call was the synthesis');
});

test('mode=web keeps its research turn when the preflight found fewer than two pages of text', async () => {
  searchLru.clear();
  const web = harness([{ tool: 'fetch_page', input: { url: 'https://example.test/only/1' } }, { text: 'ready' }, { text: 'Thin [1].' }], {
    mode: 'web'
  });
  // One result with text, one without: under the threshold. The loop tries to read the
  // second page itself; here nothing listens on that port, so the fetch is a visible failed
  // step and the model gets its turn.
  web.search.search = async (query: string) => {
    web.search.queries.push(query);
    return [
      { title: 'one', url: 'https://example.test/only/1', snippet: 's', content: `${query} is described here in enough prose to quote from.` },
      { title: 'two', url: 'http://127.0.0.1:1/only/2', snippet: 'no page text' }
    ];
  };
  await runQuickLoop(web.input);
  assert.equal(web.search.queries.length, 1, 'the preflight ran');
  const steps = web.frames.filter((f) => f.event === 'trace').map((f) => TraceEvent.parse(f.data));
  assert.deepEqual(steps.slice(0, 3).map((s) => `${s.tool}:${s.ok}`), ['recall_memory:true', 'web_search:true', 'fetch_page:false'], 'the loop tried the unread page itself before spending a model turn');
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

// ---------------------------------------------------------------- LLM_MODEL_SYNTHESIS

/**
 * A separate synthesis model (LLM_MODEL_SYNTHESIS) means one run can spend at two rates: the
 * research calls at the research model's rate, the answer at the synthesis model's. These pin
 * that `result.model` names the model that wrote the answer, and that `costUsd` is the sum of
 * each call priced at ITS OWN model — never the whole run priced at whichever model happened
 * to be `providers.llm`.
 */

test('a distinct synthesisLlm: result.model is the synthesis model, and costUsd sums each call at its own rate', async () => {
  searchLru.clear();
  // mode=auto, empty history, no Space: no preflight runs, so the research phase is exactly
  // one model call (a text turn with no tool ends the loop immediately) before synthesis.
  const research = new FakeLlm([{ text: 'ready' }], 'fake:claude-haiku-4-5');
  const synthesis = new FakeLlm([{ text: 'Tavily is a search API with no citations needed here.' }], 'fake:claude-sonnet-5');
  const frames: Frame[] = [];
  const input: QuickLoopInput = {
    query: 'What is Tavily?',
    mode: 'auto',
    userId: 'test-user',
    threadId: 'thr_test',
    requestId: 'req_test',
    history: [],
    providers: { llm: research, search: new FakeSearch(), embedder: new FakeEmbedder(), synthesisLlm: synthesis },
    caps: { maxToolCalls: 8, maxWallClockSec: 90 },
    searchCacheTtlSeconds: 60,
    emit: (event, data) => frames.push({ event, data }),
    log
  };

  const result = await runQuickLoop(input);

  assert.equal(research.calls.length, 1, 'one research turn — a text reply with no tool ends the loop');
  assert.equal(synthesis.calls.length, 1, 'one synthesis turn');
  assert.equal(result.model, 'fake:claude-sonnet-5', 'the model named is the one that wrote the answer');

  // FakeLlm yields usage input:100/output:50 per call regardless of script — exact arithmetic.
  const perCall = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };
  const expected = llmCostUsd(perCall, 'claude-haiku-4-5') + llmCostUsd(perCall, 'claude-sonnet-5');
  assert.ok(Math.abs(result.costUsd - expected) < 1e-9, `costUsd ${result.costUsd} vs expected ${expected}`);
});

test('with no synthesisLlm, costUsd is unchanged from the single-model arithmetic (regression)', async () => {
  searchLru.clear();
  const llm = new FakeLlm([{ text: 'ready' }, { text: 'Answer with no citations needed here.' }], 'fake:claude-haiku-4-5');
  const frames: Frame[] = [];
  const input: QuickLoopInput = {
    query: 'What is Tavily?',
    mode: 'auto',
    userId: 'test-user',
    threadId: 'thr_test',
    requestId: 'req_test',
    history: [],
    providers: { llm, search: new FakeSearch(), embedder: new FakeEmbedder() },
    caps: { maxToolCalls: 8, maxWallClockSec: 90 },
    searchCacheTtlSeconds: 60,
    emit: (event, data) => frames.push({ event, data }),
    log
  };

  const result = await runQuickLoop(input);

  assert.equal(llm.calls.length, 2, 'one research turn, one synthesis turn, both on the same model');
  assert.equal(result.model, 'fake:claude-haiku-4-5');

  const perCall = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };
  const expected = llmCostUsd(perCall, 'claude-haiku-4-5') * 2;
  assert.ok(Math.abs(result.costUsd - expected) < 1e-9, `costUsd ${result.costUsd} vs expected ${expected}`);
});

test('a memory request keeps its model turn, saves, and a later thread recalls it before the first token', async () => {
  searchLru.clear();
  const pref = 'Always answer in British English and keep answers under 100 words.';
  // No preflight search for an instruction: the first model call is a research turn that
  // offers save_memory, and the scripted model uses it.
  const save = harness(
    [{ tool: 'save_memory', input: { text: pref } }, { text: 'ready' }, { text: 'Noted: British English, under 100 words.' }],
    { mode: 'web', userId: 'mem-user', query: `Remember this preference for all future answers: ${pref}` }
  );
  const saved = await runQuickLoop(save.input);
  assert.equal(saved.terminated, 'done');
  assert.equal(save.search.queries.length, 0, 'an instruction about the user is not searched');
  assert.ok(save.llm.calls[0]?.tools?.some((t) => t.name === 'save_memory'), 'the research turn offered save_memory');
  const tools = save.frames.filter((f) => f.event === 'trace').map((f) => TraceEvent.parse(f.data));
  assert.deepEqual(tools.map((t) => t.tool), ['recall_memory', 'save_memory']);
  assert.ok(tools.every((t) => t.ok), 'both steps succeeded');

  // A NEW thread, same user, a plain question: the loop recalls first, on its own, and the
  // synthesis is told what it knows — no model turn spent to ask for it.
  searchLru.clear();
  const later = harness([{ text: 'Lisbon [1] and [2].' }], {
    mode: 'web',
    userId: 'mem-user',
    threadId: 'thr_later',
    query: 'What is the capital of Portugal?'
  });
  await runQuickLoop(later.input);
  const steps = later.frames.filter((f) => f.event === 'trace').map((f) => TraceEvent.parse(f.data));
  assert.equal(steps[0]?.tool, 'recall_memory');
  assert.equal(steps[0]?.ok, true);
  assert.equal(later.llm.calls.length, 1, 'still the fast path: the one model call is the synthesis');
  assert.match(later.llm.calls[0]!.system, /British English/, 'the recalled preference reached the synthesis prompt');
});

test('mode=web reads an unextracted result itself when the search left it one page short, and still skips the model turn', async () => {
  searchLru.clear();
  const { createServer } = await import('node:http');
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body><article><p>Reciprocal rank fusion combines two ranked lists by summing one over k plus rank for every document that appears in either list, which is why it needs no score calibration between the lists.</p></article></body></html>');
  });
  server.listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as { port: number }).port;

  try {
    const web = harness([{ text: 'From the search [1] and the page the loop read [2].' }], { mode: 'web', query: 'How does reciprocal rank fusion combine two ranked lists?' });
    web.search.search = async (query: string) => {
      web.search.queries.push(query);
      return [
        { title: 'one', url: 'https://example.test/only/1', snippet: 's', content: `${query} is described here in enough prose to quote from, at a length that survives the passage chooser.` },
        { title: 'two', url: `http://127.0.0.1:${port}/rrf`, snippet: 'no page text' }
      ];
    };
    const result = await runQuickLoop(web.input);
    assert.equal(result.terminated, 'done');
    const steps = web.frames.filter((f) => f.event === 'trace').map((f) => TraceEvent.parse(f.data));
    assert.deepEqual(steps.map((s) => `${s.tool}:${s.ok}`), ['recall_memory:true', 'web_search:true', 'fetch_page:true']);
    assert.match(steps[2]?.reason ?? '', /extracted text for 1 page/);
    assert.equal(web.llm.calls.length, 1, 'the fetch met the threshold: the one model call is the synthesis');
    const sources = SourcesEvent.parse(web.frames.find((f) => f.event === 'sources')!.data);
    assert.equal(sources.length, 2, 'both pages are citable now');
  } finally {
    server.close();
  }
});
