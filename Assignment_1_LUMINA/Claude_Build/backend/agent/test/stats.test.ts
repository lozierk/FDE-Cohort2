import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import type { FakeTurn } from '../src/providers/fake-llm.js';

// Set before anything imports env.ts, exactly as routes.test.ts does: run logs must not land
// in the graded runs/ folder, and MONGODB_URI stays empty so db.ts takes its in-memory
// fallback. DEEP_DAILY_CAP is deliberately NOT the default 5 — /stats has to report the
// configured cap, and a test against the default would pass on a hard-coded constant.
const RUNS = mkdtempSync(join(tmpdir(), 'lumina-stats-runs-'));
process.env.RUNS_DIR = RUNS;
process.env.MONGODB_URI = '';
process.env.LOG_LEVEL = 'silent';
process.env.DEEP_DAILY_CAP = '4';

const { default: express } = await import('express');
const { StatsResponse } = await import('@lumina/contract');
const { askRoutes } = await import('../src/routes/ask.js');
const { threadRoutes } = await import('../src/routes/threads.js');
const { statsRoutes } = await import('../src/routes/stats.js');
const { requestId } = await import('../src/routes/context.js');
const { closeDb } = await import('../src/db.js');
const { ensureIndexes } = await import('../src/store/index.js');
const { env } = await import('../src/env.js');
const { FakeEmbedder } = await import('../src/providers/fake-embeddings.js');
const { FakeLlm } = await import('../src/providers/fake-llm.js');
const { FakeSearch } = await import('../src/providers/fake-search.js');
const { searchLru } = await import('../src/cache/search-cache.js');

type Providers = Parameters<typeof askRoutes>[0];

let server: ReturnType<ReturnType<typeof express>['listen']>;
let base = '';
/** Reassigned per test; askRoutes reads `.llm` off this object on every request. */
const providers = { llm: new FakeLlm(), search: new FakeSearch(), embedder: new FakeEmbedder() };

/** One FakeLlm per REQUEST, so a script is consumed turn by turn across the loop's calls. */
const useScript = (turns?: FakeTurn[]) => {
  providers.llm = new FakeLlm(turns);
};

before(async () => {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use(threadRoutes);
  app.use(statsRoutes);
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

/** Every body is parsed against the contract: /stats is what the bench cross-checks itself on. */
async function stats(userId: string) {
  const res = await fetch(`${base}/stats`, { headers: { 'x-user-id': userId } });
  assert.equal(res.status, 200);
  return StatsResponse.parse(await res.json());
}

/**
 * A fresh user id per test. /stats is computed over every row this user ever wrote, not over
 * today's, so a shared id would make each test's numbers depend on the order the file ran in
 * — and on whatever another test file left in the same collection.
 */
const userFor = (label: string): string => `stats-${Date.now()}-${label}`;

// ---------------------------------------------------------------- the tests

test('a user who has never asked anything gets zeros, not missing fields or a NaN rate', async () => {
  const body = await stats(userFor('new'));

  assert.equal(body.requests, 0);
  assert.equal(body.answers, 0);
  // 0/0 is the one that matters: a hit rate computed without a guard is NaN, and NaN does not
  // survive StatsResponse.parse — the dashboard would get a 500 on a brand-new account.
  assert.equal(body.searchCacheHitRatePct, 0);
  assert.equal(body.ttftP95Ms, 0, 'a percentile of nothing is 0, not undefined');
});

test('two asks of the same question are two answers and a 50% search-cache hit rate', async () => {
  searchLru.clear();
  const userId = userFor('pair');
  const query = 'What does hybrid retrieval fix on a support corpus?';

  // Two NEW threads, so both asks preflight the identical query on an empty history: the
  // first search is cold, the second is the same string and must come back from the LRU.
  for (let i = 0; i < 2; i++) {
    useScript(undefined);
    const res = await post(`/threads/${await newThread(userId)}/ask`, { query, mode: 'web' }, userId);
    assert.equal(res.status, 200, `ask ${i + 1}`);
    await res.text();
  }

  const body = await stats(userId);
  assert.equal(body.answers, 2, 'counted off the requests ledger, not an in-process counter');
  // The rate is read from each answer's own `done.searchCached` — the same field the bench
  // reads off the stream — so the two measurements cannot drift apart.
  assert.equal(body.searchCacheHitRatePct, 50, 'one cold search, one served from the cache');
  assert.ok(Number.isFinite(body.ttftP95Ms), 'ttftP95Ms is a number, not a string or null');
  assert.ok(body.ttftP95Ms >= 0);
});

test('costUsdToday is a real number and deepDailyCap is the configured cap, not a constant', async () => {
  searchLru.clear();
  const userId = userFor('cost');
  useScript(undefined);
  const res = await post(`/threads/${await newThread(userId)}/ask`, { query: 'What is a run log?', mode: 'web' }, userId);
  assert.equal(res.status, 200);
  await res.text();

  const body = await stats(userId);
  assert.ok(Number.isFinite(body.costUsdToday) && body.costUsdToday >= 0, 'never NaN and never negative');
  assert.ok(body.costUsdToday > 0, 'an uncached search plus a model call cost something');
  assert.equal(body.deepToday, 0, 'every ask here was quick');

  // The cap is what a client renders next to "deep searches left today". Reporting a default
  // while the gate enforces something else is worse than not reporting it at all.
  assert.equal(body.deepDailyCap, env.deepDailyCap);
  assert.equal(body.deepDailyCap, 4, 'DEEP_DAILY_CAP=4 was set for this file before env.ts was imported');
});
