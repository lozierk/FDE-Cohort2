import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import test, { after, before } from 'node:test';
import type { FakeTurn } from '../src/providers/fake-llm.js';

// Set before anything imports env.ts: run logs must not land in the graded runs/ folder, and
// MONGODB_URI stays empty so db.ts takes its documented in-memory fallback.
const RUNS = mkdtempSync(join(tmpdir(), 'lumina-runs-'));
process.env.RUNS_DIR = RUNS;
process.env.MONGODB_URI = '';
process.env.LOG_LEVEL = 'silent';

const { default: express } = await import('express');
const { AskStreamEvent, ErrorBody, RunLog } = await import('@lumina/contract');
const { askRoutes } = await import('../src/routes/ask.js');
const { threadRoutes } = await import('../src/routes/threads.js');
const { memoryRoutes } = await import('../src/routes/memory.js');
const { requestId } = await import('../src/routes/context.js');
const { closeDb } = await import('../src/db.js');
const { ensureIndexes } = await import('../src/store/index.js');
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
  app.use(memoryRoutes);
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

const post = (path: string, body: unknown, headers: Record<string, string> = { 'x-user-id': 'dev' }) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function newThread(): Promise<string> {
  const res = await post('/threads', {});
  const body = (await res.json()) as { threadId: string };
  return body.threadId;
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

test('every route refuses a request with no x-user-id', async () => {
  for (const [method, path] of [['POST', '/threads'], ['GET', '/threads'], ['GET', '/memory']] as const) {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
    assert.equal(res.status, 401, `${method} ${path}`);
    const body = ErrorBody.parse(await res.json());
    assert.match(body.error, /x-user-id/);
    assert.ok(body.requestId, 'the 401 names the request id so it is greppable');
  }
});

test('a thread round-trips and a follow-up sees the earlier messages', async () => {
  searchLru.clear();
  useScript(undefined);
  const threadId = await newThread();

  const stream = await post(`/threads/${threadId}/ask`, { query: 'What is Tavily?', mode: 'web' });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
  const frames = parseSse(await stream.text());
  for (const f of frames) AskStreamEvent.parse(f);
  assert.equal(frames.at(-1)?.event, 'done');

  const read = await fetch(`${base}/threads/${threadId}`, { headers: { 'x-user-id': 'dev' } });
  const body = (await read.json()) as { messages: { role: string; content: string; sources?: unknown[] }[] };
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0]!.role, 'user');
  assert.equal(body.messages[1]!.role, 'assistant');
  assert.ok((body.messages[1]!.sources ?? []).length > 0, 'the answer kept its sources');

  // Another user cannot read it. Same 404 as a thread that does not exist.
  const other = await fetch(`${base}/threads/${threadId}`, { headers: { 'x-user-id': 'someone-else' } });
  assert.equal(other.status, 404);
});

test('the run log lands on disk in the RunLog shape', async () => {
  searchLru.clear();
  useScript(undefined);
  const threadId = await newThread();
  await post(`/threads/${threadId}/ask`, { query: 'What is a run log?', mode: 'web' });

  const files = readdirSync(RUNS).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0, 'a run log was written');
  for (const f of files) {
    const parsed = RunLog.parse(JSON.parse(readFileSync(join(RUNS, f), 'utf8')));
    assert.equal(parsed.depth, 'quick');
    assert.equal(parsed.terminated, 'done');
  }
});

test('a provider that throws on the first model call ends with an error frame that never carries a key', async () => {
  // The loop's memory recall is always the first frame, so the status line is spent before
  // any model call and a provider failure surfaces as the stream's error event (status 502
  // inside it), not as a 502 response. The ErrorBody path remains for failures before that.
  searchLru.clear();
  useScript([{ throws: 'anthropic: 401 authentication_error' }]);
  const threadId = await newThread();
  const res = await post(`/threads/${threadId}/ask`, { query: 'anything', mode: 'auto' });
  assert.equal(res.status, 200, 'the recall trace was already streamed');
  const frames = parseSse(await res.text());
  assert.equal(frames[0]?.event, 'trace');
  assert.equal((frames[0]!.data as { tool: string }).tool, 'recall_memory');
  const last = frames.at(-1)!;
  assert.equal(last.event, 'error');
  const err = last.data as { status: number; error: string };
  assert.equal(err.status, 502);
  assert.match(err.error, /llm provider failed/);
  assert.ok(!/api[_-]?key|sk-ant/i.test(err.error), 'the error never carries a key');
  assert.ok(!frames.some((f) => f.event === 'token' || f.event === 'done'), 'no answer, no success');
});

test('a provider that throws mid-stream ends with an error frame, not a plausible answer', async () => {
  searchLru.clear();
  useScript([{ tool: 'web_search', input: { query: 'Tavily' } }, { throws: 'anthropic: 500 overloaded_error' }]);
  const threadId = await newThread();
  const res = await post(`/threads/${threadId}/ask`, { query: 'anything', mode: 'auto' });
  assert.equal(res.status, 200, 'the status line was already spent on the first frame');
  const frames = parseSse(await res.text());
  for (const f of frames) AskStreamEvent.parse(f);
  assert.equal(frames.at(-1)?.event, 'error');
  assert.deepEqual((frames.at(-1)!.data as { status: number }).status, 502);
  assert.ok(!frames.some((f) => f.event === 'token'), 'no answer text was streamed');
  assert.ok(!frames.some((f) => f.event === 'done'), 'no done event claims success');
});

// Deep search landed in week 2 part B, so the old "501 not built yet" assertion is gone. What
// it was really protecting is this: the server answers at the depth it was asked for and
// never upgrades a request on its own, because deep costs several times as much.
test('the server never upgrades a request to deep on its own', async () => {
  searchLru.clear();
  useScript(undefined);
  const threadId = await newThread();
  const res = await post(`/threads/${threadId}/ask`, { query: 'What is Tavily?', mode: 'web' });
  const frames = parseSse(await res.text());
  const done = frames.find((f) => f.event === 'done')!.data as { depth: string; subQuestions?: number };
  assert.equal(done.depth, 'quick', 'no depth in the body means quick');
  assert.ok(!frames.some((f) => f.event === 'plan'), 'a quick run streams no plan');
  assert.ok(!frames.some((f) => f.event === 'trace' && (f.data as { tool: string }).tool === 'plan_research'));
});

test('save_memory writes a row GET /memory shows and DELETE /memory removes', async () => {
  searchLru.clear();
  useScript([
    { tool: 'save_memory', input: { text: 'Kurt prefers answers that lead with the decision.' } },
    { text: 'ready' },
    { text: 'Noted.' }
  ]);
  const threadId = await newThread();
  await post(`/threads/${threadId}/ask`, { query: 'Remember how I like answers', mode: 'auto' });

  const list = await fetch(`${base}/memory`, { headers: { 'x-user-id': 'dev' } });
  const { memories } = (await list.json()) as { memories: { id: string; text: string }[] };
  const saved = memories.find((m) => m.text.includes('lead with the decision'));
  assert.ok(saved, 'GET /memory shows what save_memory wrote');

  const del = await fetch(`${base}/memory/${saved!.id}`, { method: 'DELETE', headers: { 'x-user-id': 'dev' } });
  assert.equal(del.status, 204);
  const after2 = await fetch(`${base}/memory`, { headers: { 'x-user-id': 'dev' } });
  const { memories: left } = (await after2.json()) as { memories: { id: string }[] };
  assert.ok(!left.some((m) => m.id === saved!.id), 'the effect disappears');

  const missing = await fetch(`${base}/memory/mem_nope`, { method: 'DELETE', headers: { 'x-user-id': 'dev' } });
  assert.equal(missing.status, 404);
});

test('recall_memory finds what save_memory wrote, across threads', async () => {
  searchLru.clear();
  useScript([{ tool: 'save_memory', input: { text: 'Kurt works in enterprise digital health.' } }, { text: 'ready' }, { text: 'ok' }]);
  await post(`/threads/${await newThread()}/ask`, { query: 'remember this', mode: 'auto' });

  useScript([{ tool: 'recall_memory', input: { query: 'Kurt works in enterprise digital health.' } }, { text: 'ready' }, { text: 'ok' }]);
  const res = await post(`/threads/${await newThread()}/ask`, { query: 'what do you know about me', mode: 'auto' });
  const frames = parseSse(await res.text());
  const recall = frames.find((f) => f.event === 'trace' && (f.data as { tool: string }).tool === 'recall_memory');
  assert.ok(recall, 'the trace shows the recall');
  assert.equal((recall!.data as { ok: boolean }).ok, true);
});
