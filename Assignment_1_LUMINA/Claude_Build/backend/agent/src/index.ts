/**
 * LUMINA agent service — the AI backend. PROVIDED SKELETON: YOU BUILD THIS OUT.
 * This is where the real work is. Provider keys live only in this process.
 *
 * What is already here: the server, /health (Mongo ping + which model, provider and
 * vector backend are live), and a 501 for every other route.
 *
 * What you build (README Part 1, in this order — each step is testable with curl -N):
 *   1. the QUICK loop: plan → choose tool → observe → repeat → answer, with web_search
 *      and fetch_page, streaming trace → sources → token → done. sources BEFORE the
 *      first token. Disable compression on this route and flush after every event.
 *   2. the search cache: in-process LRU over the searchCache collection (TTL index),
 *      key = sha256(normalized query + provider). searchCached only when every hit.
 *   3. threads + messages, so a follow-up sees the thread.
 *   4. memory: save_memory / recall_memory over the memories vector index; GET /memory,
 *      DELETE /memory/:id.
 *   5. the run log: one runs/<requestId>.json per answer, in the RunLog shape from the
 *      contract. Ten lines. The gates read it, so it is not optional.
 *   6. spaces + the jobs worker: upload → GridFS → parse → chunk → embed → upsert →
 *      read-your-write probe → indexed.
 *   7. hybrid retrieval: $vectorSearch + $search fused with RRF, page locators.
 *   8. DEEP search (depth: "deep"): plan_research decomposes the question into 3–6
 *      sub-questions, you stream a `plan` event BEFORE retrieving anything, research each
 *      sub-question, then merge the results into ONE citation numbering and synthesise.
 *      Every trace step and every source carries the subQuestion it served. Deep runs
 *      under the wider caps (maxToolCallsDeep, maxWallClockSecDeep) and behind
 *      DEEP_DAILY_CAP → 429 {error, resetsAt}.
 *
 * Three rules to hold on to while you write it:
 *   - Fail loud. A provider exception ends the run with terminated:"error" and a 502.
 *     Never a try/catch that returns a plausible answer. (Live Translate served English
 *     for weeks because of exactly that catch.)
 *   - Grounded or nothing. A citation that does not resolve to something retrieved in
 *     THIS request is an automatic fail.
 *   - Depth is opted into, never drifted into. A quick search may not call plan_research,
 *     however much the model would like to. Deep costs several times more, and a product
 *     that escalates itself is a product with an unbounded bill.
 */
import express from 'express';
import { fork, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROUTES } from '@lumina/contract';
import { env, secrets } from './env.js';
import { closeDb, mongoUriInUse, vectorBackend } from './db.js';
import { log } from './log.js';
import { makeProviders } from './providers/index.js';
import { ensureIndexes } from './store/index.js';
import { askRoutes } from './routes/ask.js';
import { healthRoutes } from './routes/health.js';
import { memoryRoutes } from './routes/memory.js';
import { spaceRoutes } from './routes/spaces.js';
import { statsRoutes } from './routes/stats.js';
import { threadRoutes } from './routes/threads.js';
import { requestId, sendError } from './routes/context.js';

// Fail loud, at boot, naming the variable: a service that starts fine and only discovers a
// missing key on a user's first question has turned a config error into an outage.
const providers = makeProviders(env, secrets);

const app = express();

app.disable('x-powered-by');
app.use(requestId);
app.use((req, res, next) =>
  req.path.endsWith('/documents') && req.method === 'POST'
    ? next()
    : express.json({ limit: '1mb' })(req, res, next)
);

mkdirSync(env.runsDir, { recursive: true });

// ---------------------------------------------------------------- /health (implemented)

app.use(healthRoutes(providers));

// ---------------------------------------------------------------- what is built (Week 1)

app.use(threadRoutes);
app.use(askRoutes(providers));
app.use(memoryRoutes);
app.use(statsRoutes);
// Mounted BEFORE the 501 loop below: a registered handler wins, so the four /spaces routes
// leave the not-implemented list by being implemented rather than by a special case in it.
app.use(spaceRoutes);

// ---------------------------------------------------------------- everything else: 501

const notImplemented = (route: string) => (_req: express.Request, res: express.Response) => {
  res.status(501).json({ error: `not implemented yet: ${route}. Build it in backend/agent/src/.`, status: 501 });
};

for (const route of ROUTES) {
  if (route.path === '/health' || route.path === '/evals/report.json') continue;
  const method = route.method.toLowerCase() as 'get' | 'post' | 'delete';
  app[method](route.path, notImplemented(`${route.method} ${route.path}`));
}

app.use((req, res) => res.status(404).json({ error: `no route ${req.method} ${req.path}`, status: 404 }));

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error({ err: err.message, requestId: req.requestId }, 'agent error');
  if (res.headersSent) {
    res.end();
    return;
  }
  sendError(res, 502, err.message);
});

export { app };

// ---------------------------------------------------------------- the jobs worker child

/**
 * One OS process for the CPU-heavy work (DESIGN.md trade-off 3). `fork` rather than `spawn`
 * because tsx puts its loader in `process.execArgv`, so passing `execArgv: process.execArgv`
 * makes ONE code path work under both `npx tsx src/index.ts` and `node dist/index.js`.
 * Verified on Node 22.17.1: under tsx the child inherits
 * `--require .../tsx/dist/preflight.cjs --import .../tsx/dist/loader.mjs` and compiles
 * `worker.ts` itself; under plain node `execArgv` is empty and the sibling is `worker.js`.
 * No `spawn(process.execPath, ['--import', 'tsx', ...])` fallback was needed.
 *
 * The child's module is this file's sibling, with this file's own extension — that is what
 * keeps the dev and the built path from being two different pieces of wiring.
 */
const WORKER_RESTART_MIN_MS = 5_000;
const WORKER_RESTART_MAX_MS = 60_000;

let workerChild: ChildProcess | null = null;
let workerBackoffMs = WORKER_RESTART_MIN_MS;
let shuttingDown = false;

function workerModulePath(): string {
  const self = fileURLToPath(import.meta.url);
  return self.replace(/index\.(m?[jt]s)$/, 'worker.$1');
}

async function startWorkerChild(): Promise<void> {
  // Hand the child the URI the parent actually resolved, so an in-memory fallback is ONE
  // mongod shared by both processes rather than two that cannot see each other's jobs.
  const uri = await mongoUriInUse();
  const modulePath = workerModulePath();

  const child = fork(modulePath, [], {
    execArgv: process.execArgv,
    // VECTOR_BACKEND travels too: with the in-memory fallback the parent's `env.mongoUri` is
    // empty (→ mongo-cosine-scan) but the child's is the resolved URI, and without this the
    // child's probe would run $vectorSearch against a mongod that has none.
    env: { ...process.env, MONGODB_URI: uri, VECTOR_BACKEND: vectorBackend(), WORKER: 'none' }
  });
  workerChild = child;

  child.once('spawn', () => {
    log.info({ pid: child.pid, module: modulePath }, 'jobs worker child started');
    // Reset the backoff only once the child has STAYED up for a minute. Resetting on spawn
    // would make a child that dies at boot restart every 5 s forever.
    setTimeout(() => {
      if (workerChild === child) workerBackoffMs = WORKER_RESTART_MIN_MS;
    }, WORKER_RESTART_MAX_MS).unref();
  });

  child.on('exit', (code, signal) => {
    workerChild = null;
    if (shuttingDown) return;
    log.error({ code, signal, restartInMs: workerBackoffMs }, 'jobs worker child exited — restarting');
    const wait = workerBackoffMs;
    workerBackoffMs = Math.min(WORKER_RESTART_MAX_MS, workerBackoffMs * 2);
    setTimeout(() => {
      void startWorkerChild().catch((err: Error) =>
        log.error({ err: err.message }, 'failed to restart the jobs worker child')
      );
    }, wait).unref();
  });

  child.on('error', (err) => log.error({ err: err.message }, 'jobs worker child error'));
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Stop accepting, let in-flight answers finish, give the child a moment to release its
    // job lease cleanly, then close the pool. A hard cap so a stuck stream cannot hold the
    // process open forever.
    server.close();
    const child = workerChild;
    child?.kill(signal);
    const finish = () => {
      closeDb()
        .catch(() => undefined)
        .finally(() => process.exit(0));
    };
    if (child) child.once('exit', finish);
    else finish();
    setTimeout(finish, 3_000).unref();
  });
}

const server = app.listen(env.port, () => {
  log.info(
    {
      port: env.port,
      llmProvider: providers.llm.name,
      model: providers.llm.model,
      searchProvider: providers.search.name,
      embedder: providers.embedder.model,
      vectorStore: vectorBackend(),
      worker: env.worker,
      caps: {
        quick: { toolCalls: env.maxToolCalls, wallClockSec: env.maxWallClockSec },
        deep: { toolCalls: env.maxToolCallsDeep, wallClockSec: env.maxWallClockSecDeep, dailyCap: env.deepDailyCap }
      },
      rag: { topK: env.ragTopK, candidates: env.ragCandidates, rrfK: env.ragRrfK, chunkChars: env.chunkChars }
    },
    'agent up — quick loop, threads, memory, stats, spaces and RAG are live; deep search is still 501'
  );
  // Warm the connection and the indexes so the first question does not pay for them, and so a
  // Mongo that is unreachable shows up in the log at boot rather than in a user's answer.
  ensureIndexes().catch((err: Error) => log.error({ err: err.message }, 'index setup failed'));

  if (env.worker === 'child') {
    void startWorkerChild().catch((err: Error) =>
      log.error({ err: err.message }, 'failed to start the jobs worker child')
    );
  } else {
    log.warn({ worker: env.worker }, 'WORKER=none — uploads will stay pending unless `npm run worker` is running');
  }
});
