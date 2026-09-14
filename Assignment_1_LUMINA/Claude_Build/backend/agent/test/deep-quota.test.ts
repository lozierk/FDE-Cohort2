import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';

// Set before anything imports env.ts, exactly as deep.test.ts does: run logs must not land in
// the graded runs/ folder, MONGODB_URI stays empty so db.ts takes its in-memory fallback, and
// DEEP_DAILY_CAP is read once at boot. The cap here is only wide enough that nothing in this
// file trips it — the cap itself is deep.test.ts's subject; the LEDGER is this file's.
const RUNS = mkdtempSync(join(tmpdir(), 'lumina-deep-quota-runs-'));
process.env.RUNS_DIR = RUNS;
process.env.MONGODB_URI = '';
process.env.LOG_LEVEL = 'silent';
process.env.DEEP_DAILY_CAP = '3';

const { default: express } = await import('express');
const { ErrorBody } = await import('@lumina/contract');
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

type LlmEvent = import('../src/providers/llm.js').LlmEvent;
type LlmProvider = import('../src/providers/llm.js').LlmProvider;
type LlmRequest = import('../src/providers/llm.js').LlmRequest;
type Providers = Parameters<typeof askRoutes>[0];

const THREE = [
  { question: 'Where does BM25 fail on a support corpus?', reason: 'lexical mismatch is the known weakness' },
  { question: 'Where does dense retrieval fail on a support corpus?', reason: 'rare identifiers are the known weakness' },
  { question: 'What does hybrid retrieval actually fix?', reason: 'the claim the question turns on' }
];

/**
 * A planner whose provider dies. It decides which call it is on the same way DeepFake does —
 * by reading the request it was handed, never by knowing the loop's phases — and the planner
 * is the only call that is ever offered `plan_research`.
 *
 * This is NOT the same failure as a planner that returns too few sub-questions (deep.test.ts
 * covers that one). An invalid plan is an answer the loop can argue with, and it retries once.
 * A thrown provider is no answer at all.
 */
class PlannerExplodes implements LlmProvider {
  readonly name = 'fake';
  readonly model = 'fake-llm';
  planCalls = 0;

  async *complete(req: LlmRequest): AsyncIterable<LlmEvent> {
    if (req.tools?.some((t) => t.name === 'plan_research')) {
      this.planCalls += 1;
      throw new Error('planner exploded');
    }
    yield { type: 'usage', input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };
    yield { type: 'text', text: 'a deep run whose planner threw never reaches this turn' };
    yield { type: 'stop', reason: 'end_turn' };
  }
}

/**
 * The success path, kept to the minimum this file needs: plan, then say ready at once on
 * every research turn (each sub-question's preflight has already retrieved its pages), then
 * answer. The fan-out itself is deep.test.ts's subject.
 */
class PlansThenAnswers implements LlmProvider {
  readonly name = 'fake';
  readonly model = 'fake-llm';
  planCalls = 0;

  async *complete(req: LlmRequest): AsyncIterable<LlmEvent> {
    yield { type: 'usage', input: 100, output: 50, cacheRead: 0, cacheWrite: 0 };

    if (req.tools?.some((t) => t.name === 'plan_research')) {
      this.planCalls += 1;
      yield {
        type: 'tool_use',
        id: `toolu_plan_${this.planCalls}`,
        name: 'plan_research',
        input: { subQuestions: THREE, reason: 'split by axis' }
      };
      yield { type: 'stop', reason: 'tool_use' };
      return;
    }

    if (req.tools?.length) {
      yield { type: 'text', text: 'ready' };
      yield { type: 'stop', reason: 'end_turn' };
      return;
    }

    yield { type: 'text', text: 'A direct answer [1]. Detail from the second page [2].' };
    yield { type: 'stop', reason: 'end_turn' };
  }
}

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

/** A fresh id per test: the ledger is keyed by user and UTC day, so ids cannot be shared. */
const userFor = (label: string): string => `deep-quota-${Date.now()}-${label}`;

// ---------------------------------------------------------------- the tests

test('a planner whose provider throws is a 502 with no plan frame, and the credit comes back', async () => {
  searchLru.clear();
  const userId = userFor('throw');
  const exploding = new PlannerExplodes();
  providers.llm = exploding as unknown as typeof providers.llm;

  const res = await askDeep(userId, 'Compare BM25 and dense retrieval for support.');

  assert.equal(res.status, 502, 'the planner died before any frame, so the status line is still ours');
  // A JSON body is the proof that nothing was streamed: once a `plan` frame is out the
  // response is text/event-stream and the failure can only be an error frame.
  const contentType = res.headers.get('content-type') ?? '';
  assert.ok(!contentType.includes('text/event-stream'), `expected a JSON error body, got ${contentType}`);
  const body = ErrorBody.parse(await res.json());
  assert.match(body.error, /llm provider failed: planner exploded/);
  assert.ok(!/api[_-]?key|sk-ant/i.test(body.error), 'the error never carries a key');

  // One call, not two. The retry exists for a plan the loop can argue with; a provider that
  // threw has said nothing to argue with, and a second call just doubles the first paint.
  assert.equal(exploding.planCalls, 1);

  // The gate is a RESERVATION taken before the planner runs. Charging a fifth of someone's
  // day for a provider hiccup that retrieved nothing is theft, so it has to come back.
  assert.equal(await deepUsedToday(userId), 0, 'nothing was retrieved, so the reserved credit was refunded');
});

test('a deep ask that finishes keeps its credit: deepUsedToday is 1 afterwards', async () => {
  searchLru.clear();
  const userId = userFor('spend');
  providers.llm = new PlansThenAnswers() as unknown as typeof providers.llm;
  assert.equal(await deepUsedToday(userId), 0, 'a fresh id, so the ledger starts empty');

  const res = await askDeep(userId, 'Compare BM25 and dense retrieval for support.');
  assert.equal(res.status, 200);

  const frames = parseSse(await res.text());
  assert.ok(frames.some((f) => f.event === 'plan'), 'the plan was streamed, so retrieval really happened');
  assert.equal(frames.at(-1)?.event, 'done');
  assert.equal((frames.at(-1)!.data as { depth: string }).depth, 'deep');

  // The refund is narrow on purpose: only a planner failure gives a credit back. A deep run
  // that answered has spent the provider calls the cap exists to bound.
  assert.equal(await deepUsedToday(userId), 1);
});
