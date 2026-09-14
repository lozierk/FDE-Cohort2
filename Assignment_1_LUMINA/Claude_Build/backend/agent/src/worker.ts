/**
 * The jobs worker. ONE OS PROCESS, forked by `index.ts` at boot when `WORKER=child`
 * (DESIGN.md trade-off 3) and runnable on its own with `npm run worker`.
 *
 * Why a process and not a function call on the request path: the bench measures search p95
 * while a 60-page PDF is ingesting and fails the SLA above 1.3× idle. Parsing a PDF is
 * CPU-bound and synchronous inside pdfjs; on the server's event loop it would stall the
 * thread streaming somebody's answer. The `jobs` collection is the only interface between the
 * two, which is also why moving the worker to its own Fly app later changes nothing here.
 *
 * The claim has to be atomic, or two workers do the same job:
 *
 *   const job = await jobs.findOneAndUpdate(
 *     { status: 'pending' },
 *     { $set: { status: 'running', claimedAt: new Date(), workerId }, $inc: { attempts: 1 } },
 *     { sort: { createdAt: 1 }, returnDocument: 'after' }
 *   );
 *
 * It lives in `store/index.ts` as `claimJob` so it is one function with one test rather than a
 * pipeline written twice. A worker killed mid-job leaves the row `running` with a stale
 * `claimedAt`; `sweepStaleJobs` returns it to `pending`; `indexDocument` does not re-run
 * finished stages.
 *
 * index_document → GridFS read → parse (pdfjs, page-aware) → chunk → embed → upsert →
 *                  READ-YOUR-WRITE PROBE → status: 'indexed'
 *
 * Deep search does NOT run here: a user watching a deep search wants to see it working over
 * the same SSE channel, not poll a job id.
 */
import { hostname } from 'node:os';
import pino from 'pino';
import { closeDb, vectorBackend } from './db.js';
import { env, secrets } from './env.js';
import { WORKER_HEARTBEAT_MS } from './config/rag.js';
import { indexDocument } from './ingest/index-document.js';
import { makeProviders } from './providers/index.js';
import {
  claimJob,
  ensureIndexes,
  finishJob,
  sweepStaleJobs,
  touchJob,
  updateDocumentStatus
} from './store/index.js';

const log = pino({ level: env.logLevel }).child({ component: 'worker' });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let stopping = false;

export async function main(): Promise<void> {
  const workerId = `${hostname()}:${process.pid}`;
  // Only the embedder is used here, but makeProviders is what fails loud at boot on a missing
  // key — and a worker that starts fine and discovers OPENAI_API_KEY is empty on the first
  // upload has turned a config error into a stuck `pending` row.
  const providers = makeProviders(env, secrets);

  log.info(
    {
      workerId,
      pollMs: env.workerPollMs,
      leaseSec: env.workerLeaseSec,
      maxAttempts: env.workerMaxAttempts,
      embedder: providers.embedder.model,
      vectorStore: vectorBackend(),
      embedBatch: env.embedBatch,
      chunkChars: env.chunkChars
    },
    'jobs worker up'
  );

  await ensureIndexes();

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log.info({ signal }, 'worker stopping');
      stopping = true;
    });
  }

  while (!stopping) {
    const swept = await sweepStaleJobs(env.workerLeaseSec);
    for (const id of swept) {
      log.warn({ jobId: id, leaseSec: env.workerLeaseSec }, 'swept a stale running job back to pending');
    }

    const job = await claimJob(workerId);
    if (!job) {
      await sleep(env.workerPollMs);
      continue;
    }

    await runJob(job, providers.embedder);
    // A claimed job means there may be more; poll again at once rather than sitting out the
    // interval while an upload waits.
  }

  await closeDb();
}

type Claimed = Awaited<ReturnType<typeof claimJob>> & object;

async function runJob(job: Claimed, embedder: Parameters<typeof indexDocument>[0]['embedder']): Promise<void> {
  const docId = String(job.payload.docId ?? '');
  const spaceId = String(job.payload.spaceId ?? '');
  const jobLog = log.child({ jobId: job._id, docId, spaceId, attempt: job.attempts });

  if (job.attempts > env.workerMaxAttempts) {
    // Give up loudly and put the reason where a user can see it. A job that retries forever is
    // a bill with no ceiling, and a document stuck on `pending` with no error is a mystery.
    const error = `gave up after ${job.attempts - 1} attempts: ${job.error ?? 'no error recorded'}`;
    await finishJob(job._id, 'failed', error);
    if (docId) await updateDocumentStatus(docId, { status: 'failed', pct: 100, error });
    jobLog.error({ err: error }, 'job exhausted its attempts');
    return;
  }

  if (!docId || !spaceId) {
    const error = `job payload is missing docId or spaceId: ${JSON.stringify(job.payload)}`;
    await finishJob(job._id, 'failed', error);
    jobLog.error({ err: error }, 'unusable job payload');
    return;
  }

  // A 60-page PDF can outlive the lease. The heartbeat is what stops the sweeper from taking a
  // job away from a worker that is still doing it.
  const heartbeat = setInterval(() => {
    void touchJob(job._id).catch((err: Error) =>
      jobLog.warn({ err: err.message }, 'failed to refresh the job lease')
    );
  }, WORKER_HEARTBEAT_MS);
  heartbeat.unref();

  const started = Date.now();
  try {
    const result = await indexDocument({ docId, spaceId, userId: job.userId, embedder, log: jobLog });
    await finishJob(job._id, 'done');
    jobLog.info({ ...result, totalMs: Date.now() - started }, 'indexed a document');
  } catch (err) {
    const message = (err as Error).message;
    const attemptsLeft = env.workerMaxAttempts - job.attempts;
    if (attemptsLeft > 0) {
      // Back to `pending` with the error recorded, so the next claim knows what went wrong
      // last time and the log says why this is being retried.
      await finishJob(job._id, 'pending', message);
      jobLog.error({ err: message, attemptsLeft }, 'job failed — returning it to pending for a retry');
    } else {
      const error = `gave up after ${job.attempts} attempts: ${message}`;
      await finishJob(job._id, 'failed', error);
      await updateDocumentStatus(docId, { status: 'failed', pct: 100, error });
      jobLog.error({ err: error }, 'job failed for the last time — document marked failed');
    }
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Only run the loop when this file IS the entry point. Tests import `claimJob`/`sweepStaleJobs`
 * and `indexDocument` directly; a module that starts polling Mongo on import would make that
 * impossible.
 */
const isEntry = process.argv[1] !== undefined && /worker\.(ts|js|mts|mjs)$/.test(process.argv[1]);
if (isEntry) {
  main().catch((err: Error) => {
    log.error({ err: err.message }, 'jobs worker died');
    process.exit(1);
  });
}
