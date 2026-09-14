import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';

process.env.RUNS_DIR = mkdtempSync(join(tmpdir(), 'lumina-runs-'));
process.env.MONGODB_URI = '';
process.env.LOG_LEVEL = 'silent';
process.env.LLM_PROVIDER = 'fake';
process.env.WORKER = 'none';

const store = await import('../src/store/index.js');
const { closeDb } = await import('../src/db.js');

before(async () => {
  await store.ensureIndexes();
});

after(async () => {
  await closeDb();
});

async function clearJobs(): Promise<void> {
  await (await store.jobs()).deleteMany({});
}

test('two workers racing for one job: exactly one claims it, and it is claimed exactly once', async () => {
  await clearJobs();
  const job = await store.insertJob({ kind: 'index_document', userId: 'dev', payload: { docId: 'doc_a', spaceId: 'spc_a' } });

  // Both call the same atomic findOneAndUpdate. Whichever loses sees no pending row at all —
  // not the same row twice, which is the bug an unguarded find-then-update would have.
  const [first, second] = await Promise.all([store.claimJob('worker-1'), store.claimJob('worker-2')]);
  const claims = [first, second].filter((c) => c !== null);
  assert.equal(claims.length, 1, 'one claim, not two');
  assert.equal(claims[0]!._id, job._id);
  assert.equal(claims[0]!.status, 'running');
  assert.equal(claims[0]!.attempts, 1, 'the claim is what increments attempts');
  assert.ok(claims[0]!.workerId, 'and it records which worker holds it');

  const row = await store.getJob(job._id);
  assert.equal(row!.attempts, 1, 'the loser did not also increment attempts');
});

test('jobs are claimed oldest first, so a queue is a queue', async () => {
  await clearJobs();
  const older = await store.insertJob({ kind: 'index_document', userId: 'dev', payload: { docId: 'doc_1', spaceId: 's' } });
  // insertJob stamps createdAt at insert time; nudge the second one forward so the ordering is
  // unambiguous rather than dependent on millisecond resolution.
  const newer = await store.insertJob({ kind: 'index_document', userId: 'dev', payload: { docId: 'doc_2', spaceId: 's' } });
  await (await store.jobs()).updateOne({ _id: newer._id }, { $set: { createdAt: new Date(Date.now() + 60_000) } });

  assert.equal((await store.claimJob('w'))!._id, older._id);
  assert.equal((await store.claimJob('w'))!._id, newer._id);
  assert.equal(await store.claimJob('w'), null, 'and then there is nothing to claim');
});

test('a stale running row goes back to pending; a fresh one is left alone', async () => {
  await clearJobs();
  const stale = await store.insertJob({ kind: 'index_document', userId: 'dev', payload: { docId: 'doc_s', spaceId: 's' } });
  const live = await store.insertJob({ kind: 'index_document', userId: 'dev', payload: { docId: 'doc_l', spaceId: 's' } });
  await store.claimJob('crashed-worker');
  await store.claimJob('busy-worker');

  // A worker killed mid-job leaves exactly this: `running` with a claimedAt nobody refreshed.
  await (await store.jobs()).updateOne(
    { _id: stale._id },
    { $set: { claimedAt: new Date(Date.now() - 300_000) } }
  );

  const swept = await store.sweepStaleJobs(120);
  assert.deepEqual(swept, [stale._id], 'only the stale one is swept');

  const staleRow = await store.getJob(stale._id);
  assert.equal(staleRow!.status, 'pending');
  assert.equal(staleRow!.claimedAt, undefined, 'the lease is released, not left to look current');
  assert.equal(staleRow!.workerId, undefined);
  assert.equal(staleRow!.attempts, 1, 'the attempt it already spent is not forgotten');

  assert.equal((await store.getJob(live._id))!.status, 'running', 'the busy worker keeps its job');

  // And the swept job is claimable again — by anyone.
  const reclaimed = await store.claimJob('fresh-worker');
  assert.equal(reclaimed!._id, stale._id);
  assert.equal(reclaimed!.attempts, 2);
});

test('touchJob refreshes the lease so a slow job is not swept out from under itself', async () => {
  await clearJobs();
  const job = await store.insertJob({ kind: 'index_document', userId: 'dev', payload: { docId: 'doc_t', spaceId: 's' } });
  await store.claimJob('slow-worker');
  await (await store.jobs()).updateOne({ _id: job._id }, { $set: { claimedAt: new Date(Date.now() - 300_000) } });

  await store.touchJob(job._id);
  assert.deepEqual(await store.sweepStaleJobs(120), [], 'a heartbeat within the lease keeps the job');
  assert.equal((await store.getJob(job._id))!.status, 'running');
});

test('finishJob records done, failed with a reason, and pending-with-an-error for a retry', async () => {
  await clearJobs();
  const a = await store.insertJob({ kind: 'index_document', userId: 'dev', payload: { docId: 'doc_a', spaceId: 's' } });
  await store.finishJob(a._id, 'done');
  assert.equal((await store.getJob(a._id))!.status, 'done');

  const b = await store.insertJob({ kind: 'index_document', userId: 'dev', payload: { docId: 'doc_b', spaceId: 's' } });
  await store.claimJob('w');
  await store.finishJob(b._id, 'failed', 'gave up after 3 attempts: pdfjs threw');
  const failed = await store.getJob(b._id);
  assert.equal(failed!.status, 'failed');
  assert.match(failed!.error ?? '', /gave up after 3 attempts/, 'a failed job always says why');

  const c = await store.insertJob({ kind: 'index_document', userId: 'dev', payload: { docId: 'doc_c', spaceId: 's' } });
  await store.claimJob('w');
  await store.finishJob(c._id, 'pending', 'transient embedder timeout');
  const retry = await store.getJob(c._id);
  assert.equal(retry!.status, 'pending');
  assert.equal(retry!.claimedAt, undefined, 'a retry releases the lease');
  assert.match(retry!.error ?? '', /transient/, 'and carries last time\'s reason into the next claim');
});
