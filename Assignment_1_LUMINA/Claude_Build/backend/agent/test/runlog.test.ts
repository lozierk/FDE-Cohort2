import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Before the env module loads: the run log writer reads RUNS_DIR once, at import.
const RUNS = mkdtempSync(join(tmpdir(), 'lumina-runlog-'));
process.env.RUNS_DIR = RUNS;

const { RunLog } = await import('@lumina/contract');
const { closeDb } = await import('../src/db.js');
const { runLogDir, writeRunLog } = await import('../src/runlog.js');
type QuickLoopResult = import('../src/loop/quick.js').QuickLoopResult;

after(async () => {
  await closeDb();
});

/**
 * Quality rule A2 fails any run log under `runs/` that did not terminate `done`, and the
 * report builder promotes that to a red line. Rule P1 wants a failing trajectory to read, and
 * the eval looks for it under `runs/failing/`. A provider failure during the bench — the
 * error-rate gate allows one in a hundred — must therefore land in `runs/failing/` by
 * construction, not by someone moving the file afterwards.
 */
function result(over: Partial<QuickLoopResult>): QuickLoopResult {
  return {
    answerId: 'ans_test',
    answer: 'An answer [1].',
    sources: [],
    toolCalls: [{ name: 'web_search', ok: true, ms: 12 }],
    terminated: 'done',
    usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0.001,
    searchCached: false,
    ttftMs: 100,
    latencyMs: 500,
    model: 'fake-llm',
    ...over
  };
}

const write = (requestId: string, over: Partial<QuickLoopResult>) =>
  writeRunLog({
    requestId,
    userId: 'runlog-test',
    threadId: 'thr_runlog',
    query: 'where does this land?',
    route: '/threads/thr_runlog/ask',
    status: over.terminated === 'error' ? 502 : 200,
    depth: 'quick',
    result: result(over)
  });

test('runLogDir sends error runs to runs/failing and everything else to runs/', () => {
  assert.equal(runLogDir('error', '/r'), join('/r', 'failing'));
  assert.equal(runLogDir('done', '/r'), '/r');
  assert.equal(runLogDir('cap', '/r'), '/r', 'a capped run answered; if A2 flags it the budget is wrong and we want to see it');
});

test('a done run lands in runs/ in the RunLog shape', async () => {
  await write('req_runlog_done', { terminated: 'done' });
  const file = join(RUNS, 'req_runlog_done.json');
  assert.ok(existsSync(file), 'written under runs/');
  const parsed = RunLog.parse(JSON.parse(readFileSync(file, 'utf8')));
  assert.equal(parsed.terminated, 'done');
  assert.equal(parsed.depth, 'quick');
});

test('an error run lands in runs/failing/, never in runs/', async () => {
  await write('req_runlog_error', { terminated: 'error', error: 'llm provider failed: anthropic: 401', answer: '', ttftMs: 0 });
  const failing = join(RUNS, 'failing', 'req_runlog_error.json');
  assert.ok(existsSync(failing), 'written under runs/failing/');
  assert.ok(!existsSync(join(RUNS, 'req_runlog_error.json')), 'not under runs/, where rule A2 would fail it');
  const parsed = RunLog.parse(JSON.parse(readFileSync(failing, 'utf8')));
  assert.equal(parsed.terminated, 'error');
  // Nothing terminated other than done is left in runs/ itself.
  for (const f of readdirSync(RUNS).filter((f) => f.endsWith('.json'))) {
    const run = RunLog.parse(JSON.parse(readFileSync(join(RUNS, f), 'utf8')));
    assert.equal(run.terminated, 'done', `${f} would fail quality rule A2`);
  }
});
