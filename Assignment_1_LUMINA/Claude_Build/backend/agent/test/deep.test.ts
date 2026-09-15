import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import pino from 'pino';

// Set before anything imports env.ts, exactly as routes.test.ts does: run logs must not land
// in the graded runs/ folder, MONGODB_URI stays empty so db.ts takes its in-memory fallback,
// and DEEP_DAILY_CAP is read once at boot — so a cap test has to set it here or not at all.
const RUNS = mkdtempSync(join(tmpdir(), 'lumina-deep-runs-'));
process.env.RUNS_DIR = RUNS;
process.env.MONGODB_URI = '';
process.env.LOG_LEVEL = 'silent';
process.env.DEEP_DAILY_CAP = '2';

const { default: express } = await import('express');
const { AskStreamEvent, ErrorBody, PlanEvent, RunLog, SourcesEvent, TraceEvent } = await import('@lumina/contract');
const { askRoutes } = await import('../src/routes/ask.js');
const { threadRoutes } = await import('../src/routes/threads.js');
const { requestId } = await import('../src/routes/context.js');
const { closeDb } = await import('../src/db.js');
const { ensureIndexes } = await import('../src/store/index.js');
const { deepUsedToday } = await import('../src/store/deep-quota.js');
const { FakeEmbedder } = await import('../src/providers/fake-embeddings.js');
const { FakeLlm } = await import('../src/providers/fake-llm.js');
const { FakeSearch } = await import('../src/providers/fake-search.js');
const { searchLru } = await import('../src/cache/search-cache.js');
const { runDeepLoop } = await import('../src/loop/deep.js');
const { env } = await import('../src/env.js');

type LlmEvent = import('../src/providers/llm.js').LlmEvent;
type LlmProvider = import('../src/providers/llm.js').LlmProvider;
type LlmRequest = import('../src/providers/llm.js').LlmRequest;
type Providers = Parameters<typeof askRoutes>[0];

const log = pino({ level: 'silent' });
const RETRIEVAL = new Set(['web_search', 'fetch_page', 'search_documents']);

/**
 * A scripted model for the deep loop, which a linear `FakeTurn[]` cannot serve: the fan-out
 * runs DEEP_CONCURRENCY sub-questions at once, so the order the turns are requested in is not
 * the order they were written in.
 *
 * It decides the same way `FakeLlm.improvise` does — by reading the conversation it was
 * handed, never by knowing the loop's phases:
 *   tools include plan_research  → the plan (the loop forced this call)
 *   tools, and few tool_results  → ask for another web_search
 *   tools, enough tool_results   → "ready"
 *   no tools at all              → the answer
 */
class DeepFake implements LlmProvider {
  readonly name = 'fake';
  readonly model = 'fake-llm';
  readonly calls: LlmRequest[] = [];
  planCalls = 0;

  constructor(
    private readonly opts: {
      subQuestions: { question: string; reason: string }[];
      /** Retrieval calls one sub-question makes before saying ready; preflight included. */
      searchesPerSub?: number;
      answer?: string;
      /** Force the same query from every sub-question, so two of them find one url. */
      sameQueryForAll?: boolean;
      /** Throw on every research turn for this sub-question (`sub2`): the mid-fan-out failure path. */
      throwOnSub?: string;
    }
  ) {}

  async *complete(req: LlmRequest): AsyncIterable<LlmEvent> {
    this.calls.push(req);
    yield { type: 'usage', input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };

    if (req.tools?.some((t) => t.name === 'plan_research')) {
      this.planCalls += 1;
      yield {
        type: 'tool_use',
        id: `toolu_plan_${this.planCalls}`,
        name: 'plan_research',
        input: { subQuestions: this.opts.subQuestions, reason: 'split by axis' }
      };
      yield { type: 'stop', reason: 'tool_use' };
      return;
    }

    if (req.tools?.length) {
      if (this.opts.throwOnSub && subQuestionOf(req) === this.opts.throwOnSub) {
        throw new Error(`provider down for ${this.opts.throwOnSub}`);
      }
      const done = req.messages.flatMap((m) => m.content).filter((b) => b.type === 'tool_result').length;
      const want = this.opts.searchesPerSub ?? 2;
      if (done < want) {
        const sub = subQuestionOf(req);
        yield {
          type: 'tool_use',
          id: `toolu_search_${this.calls.length}`,
          name: 'web_search',
          input: { query: this.opts.sameQueryForAll ? 'one shared query' : `${sub} probe ${done}` }
        };
        yield { type: 'stop', reason: 'tool_use' };
        return;
      }
      for (const piece of chunks('ready')) yield { type: 'text', text: piece };
      yield { type: 'stop', reason: 'end_turn' };
      return;
    }

    const answer = this.opts.answer ?? 'A direct answer [1]. Detail from the second page [2].';
    for (const piece of chunks(answer)) yield { type: 'text', text: piece };
    yield { type: 'stop', reason: 'end_turn' };
  }
}

/** Which sub-question this research turn is for, read off the opener the loop wrote. */
function subQuestionOf(req: LlmRequest): string {
  for (const m of req.messages) {
    for (const b of m.content) {
      if (b.type !== 'text') continue;
      const m2 = b.text.match(/^Sub-question (\d+) of/m);
      if (m2) return `sub${m2[1]}`;
    }
  }
  return 'sub0';
}

function chunks(text: string, size = 24): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

const SIX_MORE = [
  { question: 'How does hybrid retrieval fuse the two rankings?', reason: 'the mechanism' },
  { question: 'What do published benchmarks show for hybrid on support data?', reason: 'evidence' },
  { question: 'Where does hybrid retrieval still fail?', reason: 'the honest limit' }
];
const THREE = [
  { question: 'Where does BM25 fail on a support corpus?', reason: 'lexical mismatch is the known weakness' },
  { question: 'Where does dense retrieval fail on a support corpus?', reason: 'rare identifiers are the known weakness' },
  { question: 'What does hybrid retrieval actually fix?', reason: 'the claim the question turns on' }
];

// ---------------------------------------------------------------- the http harness

let server: ReturnType<ReturnType<typeof express>['listen']>;
let base = '';
const providers = { llm: new FakeLlm(), search: new FakeSearch(), embedder: new FakeEmbedder() };

before(async () => {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use(threadRoutes);
  app.use(askRoutes(providers as unknown as Providers));
  await ensureIndexes();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  await closeDb();
});

const post = (path: string, body: unknown, userId: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify(body)
  });

async function newThread(userId: string): Promise<string> {
  const res = await post('/threads', {}, userId);
  return ((await res.json()) as { threadId: string }).threadId;
}

function parseSse(text: string): { event: string; data: unknown }[] {
  return text
    .split('\n\n')
    .filter((f) => f.trim())
    .map((frame) => {
      const event = frame.match(/^event: (.+)$/m)?.[1] ?? 'message';
      const data = JSON.parse(frame.replace(/^event: .+$/m, '').replace(/^data: /m, '').trim());
      return { event, data };
    });
}

async function askDeep(userId: string, query: string): Promise<Response> {
  const threadId = await newThread(userId);
  return post(`/threads/${threadId}/ask`, { query, mode: 'web', depth: 'deep' }, userId);
}

// ---------------------------------------------------------------- the tests

test('the plan frame precedes every retrieval trace, and the stream order is the contract\'s', async () => {
  searchLru.clear();
  providers.llm = new DeepFake({ subQuestions: THREE }) as unknown as typeof providers.llm;
  const res = await askDeep('deep-order', 'Compare BM25 and dense retrieval for support.');
  assert.equal(res.status, 200);

  const frames = parseSse(await res.text());
  for (const f of frames) AskStreamEvent.parse(f);

  const order = frames.map((f) => f.event);
  const firstAppearance = order.filter((e, i) => order.indexOf(e) === i);
  assert.deepEqual(firstAppearance, ['trace', 'plan', 'sources', 'token', 'done'], 'trace(plan_research) → plan → … ');

  const traces = frames.filter((f) => f.event === 'trace').map((f) => TraceEvent.parse(f.data));
  assert.equal(traces[0]!.tool, 'plan_research', 'the planner is the first step');
  assert.equal(traces[0]!.subQuestion, undefined, 'the planner serves the whole question, not one sub-question');

  const planIdx = order.indexOf('plan');
  const firstRetrieval = frames.findIndex((f) => f.event === 'trace' && RETRIEVAL.has((f.data as { tool: string }).tool));
  assert.ok(planIdx < firstRetrieval, 'a plan streamed after the fetches is a rationalisation');
  assert.ok(order.indexOf('sources') < order.indexOf('token'), 'chips render while the text arrives');
  assert.equal(order.at(-1), 'done');

  const plan = PlanEvent.parse(frames.find((f) => f.event === 'plan')!.data);
  assert.equal(plan.subQuestions.length, 3);
  assert.deepEqual(plan.subQuestions.map((s) => s.i), [1, 2, 3], 'numbered from 1, contiguous');
});

test('every retrieval step and every source carries its subQuestion, and the trace steps are contiguous', async () => {
  searchLru.clear();
  providers.llm = new DeepFake({ subQuestions: THREE }) as unknown as typeof providers.llm;
  const res = await askDeep('deep-attr', 'Compare BM25 and dense retrieval for support.');
  const frames = parseSse(await res.text());

  const traces = frames.filter((f) => f.event === 'trace').map((f) => TraceEvent.parse(f.data));
  const retrieval = traces.filter((t) => RETRIEVAL.has(t.tool));
  assert.ok(retrieval.length > 0, 'the fan-out actually retrieved something');
  for (const t of retrieval) {
    assert.ok(Number.isInteger(t.subQuestion), `step ${t.step} (${t.tool}) is tagged`);
    assert.ok(t.subQuestion! >= 1 && t.subQuestion! <= 3);
  }
  assert.deepEqual(traces.map((t) => t.step), traces.map((_, i) => i + 1), 'one shared step counter, no gaps');

  const sources = SourcesEvent.parse(frames.find((f) => f.event === 'sources')!.data);
  assert.ok(sources.length > 0);
  for (const s of sources) assert.ok(Number.isInteger(s.subQuestion), `source [${s.n}] is tagged`);
  assert.deepEqual(sources.map((s) => s.n), sources.map((_, i) => i + 1), 'one citation numbering, contiguous from 1');
  assert.equal(new Set(sources.map((s) => s.url)).size, sources.length, 'deduped by url');

  // All three sub-questions contributed, which is what "deeper" means before it means anything else.
  assert.deepEqual([...new Set(sources.map((s) => s.subQuestion))].sort(), [1, 2, 3]);
});

test('done says depth deep with the plan size, the run log says deep, and GET /threads keeps the plan', async () => {
  searchLru.clear();
  providers.llm = new DeepFake({ subQuestions: THREE }) as unknown as typeof providers.llm;
  const userId = 'deep-done';
  const threadId = await newThread(userId);
  const res = await post(`/threads/${threadId}/ask`, { query: 'Compare the two.', mode: 'web', depth: 'deep' }, userId);
  const frames = parseSse(await res.text());

  const done = frames.find((f) => f.event === 'done')!.data as {
    depth: string;
    subQuestions: number;
    terminated: string;
    costUsd: number;
  };
  assert.equal(done.depth, 'deep');
  assert.equal(done.subQuestions, 3);
  assert.equal(done.terminated, 'done');
  assert.ok(done.costUsd > 0);

  const requestIdHeader = res.headers.get('x-request-id')!;
  const file = readdirSync(RUNS).find((f) => f === `${requestIdHeader}.json`);
  assert.ok(file, 'the run log for this request landed on disk');
  const runLog = RunLog.parse(JSON.parse(readFileSync(join(RUNS, file!), 'utf8')));
  assert.equal(runLog.depth, 'deep', 'a legitimately expensive run is distinguishable from a runaway quick one');
  assert.ok(runLog.toolCalls.some((t) => t.name === 'plan_research'));

  const read = await fetch(`${base}/threads/${threadId}`, { headers: { 'x-user-id': userId } });
  const body = (await read.json()) as {
    messages: { role: string; subQuestions?: { i: number; question: string }[] }[];
  };
  const assistant = body.messages.find((m) => m.role === 'assistant')!;
  assert.equal(assistant.subQuestions?.length, 3, 'the plan survives the stream');
  assert.equal(assistant.subQuestions![0]!.question, THREE[0]!.question);
});

test('a planner that will not produce enough sub-questions is a 502 with no plan frame, and the credit comes back', async () => {
  searchLru.clear();
  const userId = 'deep-refund';
  const twoOnly = new DeepFake({ subQuestions: THREE.slice(0, 2) });
  providers.llm = twoOnly as unknown as typeof providers.llm;

  const res = await askDeep(userId, 'Compare the two.');
  assert.equal(res.status, 502, 'no frame was out yet, so the status line is still ours');
  const body = ErrorBody.parse(await res.json());
  assert.match(body.error, /plan_research returned an invalid plan/);
  assert.equal(twoOnly.planCalls, 2, 'exactly one retry: the plan is deep search\'s first paint');
  assert.equal(await deepUsedToday(userId), 0, 'no retrieval happened, so no credit was spent');

  // And the refund is real: the very next deep ask on the same user still goes through.
  providers.llm = new DeepFake({ subQuestions: THREE }) as unknown as typeof providers.llm;
  const ok = await askDeep(userId, 'Compare the two, properly this time.');
  assert.equal(ok.status, 200);
  assert.ok(parseSse(await ok.text()).some((f) => f.event === 'plan'));
  assert.equal(await deepUsedToday(userId), 1);
});

test('the (cap+1)th deep ask is a 429 carrying resetsAt, and the cap is per user', async () => {
  searchLru.clear();
  providers.llm = new DeepFake({ subQuestions: THREE }) as unknown as typeof providers.llm;
  const userId = 'deep-cap';
  assert.equal(env.deepDailyCap, 2, 'the test env set a small cap before env.ts was imported');

  for (let i = 0; i < env.deepDailyCap; i++) {
    const res = await askDeep(userId, `cap probe ${i}`);
    assert.equal(res.status, 200, `ask ${i + 1} of ${env.deepDailyCap} is inside the cap`);
    await res.text();
  }

  const over = await askDeep(userId, 'one too many');
  assert.equal(over.status, 429);
  const body = ErrorBody.parse(await over.json());
  assert.match(body.error, /deep search daily cap/);
  assert.ok(body.resetsAt, 'a 429 with no resetsAt tells a client to stop and never to start again');
  assert.ok(new Date(body.resetsAt!).getTime() > Date.now(), 'and it is in the future');
  assert.equal(new Date(body.resetsAt!).toISOString().slice(11), '00:00:00.000Z', 'the next UTC midnight');

  // Someone else's day is untouched, and a quick ask is never capped.
  const other = await askDeep('deep-cap-other', 'a different user');
  assert.equal(other.status, 200);
  await other.text();

  const threadId = await newThread(userId);
  providers.llm = new FakeLlm() as unknown as typeof providers.llm;
  const quick = await post(`/threads/${threadId}/ask`, { query: 'quick is free', mode: 'web' }, userId);
  assert.equal(quick.status, 200, 'the deep cap does not cap the cheap gear');
  await quick.text();
});

test('a quick ask that reaches for plan_research is refused, and stays a quick answer', async () => {
  searchLru.clear();
  providers.llm = new FakeLlm([
    { tool: 'plan_research', input: { question: 'escalate me' } },
    { tool: 'web_search', input: { query: 'Tavily' } },
    { text: 'ready' },
    { text: 'An answer [1].' }
  ]) as unknown as typeof providers.llm;

  const threadId = await newThread('deep-escalation');
  const res = await post(`/threads/${threadId}/ask`, { query: 'What is Tavily?', mode: 'auto' }, 'deep-escalation');
  const frames = parseSse(await res.text());

  const tools = frames.filter((f) => f.event === 'trace').map((f) => (f.data as { tool: string }).tool);
  assert.ok(!tools.includes('plan_research'), 'a refusal is not an escalation and is not traced as one');
  assert.deepEqual(tools, ['recall_memory', 'web_search']);
  assert.ok(!frames.some((f) => f.event === 'plan'));
  assert.equal((frames.find((f) => f.event === 'done')!.data as { depth: string }).depth, 'quick');
});

// ---------------------------------------------------------------- the loop, without the route

/** The deep loop on its own, so a test can set concurrency and the per-sub budget directly. */
function runLoop(
  llm: LlmProvider,
  over: Partial<Parameters<typeof runDeepLoop>[0]> = {}
): { frames: { event: string; data: unknown }[]; result: ReturnType<typeof runDeepLoop> } {
  const frames: { event: string; data: unknown }[] = [];
  const result = runDeepLoop({
    query: 'Compare BM25 and dense retrieval for a support corpus.',
    mode: 'web',
    userId: 'loop-user',
    threadId: 'thr_loop',
    requestId: 'req_loop',
    history: [],
    providers: { llm, search: new FakeSearch(), embedder: new FakeEmbedder() },
    caps: { maxToolCalls: 24, maxWallClockSec: 240 },
    searchCacheTtlSeconds: 60,
    deep: { subQuestionsMin: 3, subQuestionsMax: 6, concurrency: 3, subToolCalls: 4, passagesPerSub: 4, passageLimit: 20 },
    emit: (event, data) => frames.push({ event, data }),
    log,
    ...over
  });
  return { frames, result };
}

test('a url two sub-questions both find appears once, credited to the one that got there first', async () => {
  searchLru.clear();
  // Concurrency 1 so "first" is a fact and not a race: sub-question 1 runs to completion
  // before sub-question 2 starts, and both search for the identical string.
  const { result } = runLoop(
    new DeepFake({ subQuestions: THREE, sameQueryForAll: true, searchesPerSub: 2 }) as unknown as LlmProvider,
    { deep: { subQuestionsMin: 3, subQuestionsMax: 6, concurrency: 1, subToolCalls: 4, passagesPerSub: 4, passageLimit: 20 } }
  );
  const r = await result;

  assert.equal(r.terminated, 'done');
  // Each sub-question preflights its own text (three distinct pairs of pages) and then runs
  // one identical query, which lands on a pair all three of them find.
  assert.equal(r.toolCalls.filter((t) => t.name === 'web_search').length, 6, '3 preflights + 3 model searches');
  assert.equal(new Set(r.sources.map((s) => s.url)).size, r.sources.length, 'deduped by url');

  const shared = r.sources.filter((s) => s.url?.includes('one-shared-query'));
  assert.equal(shared.length, 2, 'the shared query returns two pages, and each appears exactly once');
  for (const s of shared) assert.equal(s.subQuestion, 1, 'first appearance wins; it is never reassigned');
  assert.equal(r.sources.length, 8, 'six from the preflights, two shared — merged into one list');
  assert.deepEqual(r.sources.map((s) => s.n), r.sources.map((_, i) => i + 1), 'one numbering, contiguous from 1');
});

test('a six-question plan that spends every call still ends done, inside the shared cap', async () => {
  searchLru.clear();
  // Six sub-questions at the configured four calls each, plus the plan step, is 25 for a cap
  // of 24. The per-sub budget is derived from the plan size, so the run finishes on its own
  // terms — `terminated: 'done'` — rather than tripping a cap on work that completed. The
  // quality checker fails any run that did not end `done`, so this is graded, not cosmetic.
  const { frames, result } = runLoop(
    new DeepFake({ subQuestions: [...THREE, ...SIX_MORE], searchesPerSub: 999 }) as unknown as LlmProvider
  );
  const r = await result;

  assert.equal(r.terminated, 'done');
  assert.equal(r.subQuestions.length, 6);
  assert.equal(r.toolCalls.length, 1 + 6 * 3, 'the plan step plus three calls for each of six sub-questions');
  assert.ok(frames.filter((f) => f.event === 'trace').length <= 24);
  const researched = new Set(
    frames
      .filter((f) => f.event === 'trace')
      .map((f) => (f.data as { subQuestion?: number }).subQuestion)
      .filter((n): n is number => typeof n === 'number')
  );
  assert.equal(researched.size, 6, 'every sub-question was researched');
});

test('the shared wall clock stops a runaway fan-out and still answers', async () => {
  searchLru.clear();
  // A clock that jumps 40 s per reading reaches the 240 s envelope inside the fan-out. The
  // model never says ready on its own, so only the shared cap can end the research.
  let t = 0;
  const { frames, result } = runLoop(
    new DeepFake({ subQuestions: THREE, searchesPerSub: 999 }) as unknown as LlmProvider,
    { now: () => (t += 40_000) }
  );
  const r = await result;

  assert.equal(r.terminated, 'cap');
  assert.ok(r.toolCalls.length < 24, 'the clock bound, not the call count');
  assert.ok(frames.some((f) => f.event === 'token'), 'a capped run still returns an honest partial answer');
  assert.ok(r.answer.length > 0);
});

test('the planner call is forced to plan_research with the plan token budget', async () => {
  searchLru.clear();
  const fake = new DeepFake({ subQuestions: THREE });
  await runLoop(fake as unknown as LlmProvider).result;
  const first = fake.calls[0]!;
  assert.equal(first.toolChoice?.name, 'plan_research', 'the loop forces the tool; no prompt is trusted to');
  assert.deepEqual(first.tools?.map((tool) => tool.name), ['plan_research']);
  assert.equal(first.maxTokens, 1024);
});

test('a provider failure in one sub-question ends the run, and the other sub-questions stop', async () => {
  searchLru.clear();
  // Sub-question 2 throws on its first research turn while 1 and 3 are mid-flight. The run
  // must end `error` and go quiet: no frame after the failure, no model call after it.
  const fake = new DeepFake({ subQuestions: THREE, searchesPerSub: 3, throwOnSub: 'sub2' });
  const { frames, result } = runLoop(fake as unknown as LlmProvider);
  const r = await result;

  assert.equal(r.terminated, 'error');
  assert.match(r.error ?? '', /provider down for sub2/);
  assert.ok(!frames.some((f) => f.event === 'token'), 'nothing was synthesised');
  assert.ok(frames.some((f) => f.event === 'plan'), 'the plan was out before the failure');

  const framesAtReturn = frames.length;
  const callsAtReturn = fake.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(frames.length, framesAtReturn, 'no frame after the run reported its failure');
  assert.equal(fake.calls.length, callsAtReturn, 'no model call after the run reported its failure');
});

test('over HTTP, a mid-fan-out failure is an error frame, and the credit stays spent', async () => {
  searchLru.clear();
  const userId = 'deep-midflight';
  providers.llm = new DeepFake({ subQuestions: THREE, searchesPerSub: 2, throwOnSub: 'sub2' }) as unknown as typeof providers.llm;

  const res = await askDeep(userId, 'Compare the two.');
  assert.equal(res.status, 200, 'the plan frame was out, so the status line was spent');
  const frames = parseSse(await res.text());
  assert.equal(frames.at(-1)?.event, 'error', 'the error frame is the last thing on the stream');
  assert.ok(frames.some((f) => f.event === 'plan'));
  assert.ok(!frames.some((f) => f.event === 'done'));
  assert.equal(await deepUsedToday(userId), 1, 'retrieval happened, so the credit is not refunded');
});
