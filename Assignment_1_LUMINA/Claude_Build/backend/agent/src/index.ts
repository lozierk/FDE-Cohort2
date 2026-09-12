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
import { mkdirSync } from 'node:fs';
import { HealthResponse, ROUTES } from '@lumina/contract';
import { env, secrets } from './env.js';
import { pingDb, vectorBackend } from './db.js';
import { log } from './log.js';
import { makeProviders } from './providers/index.js';
import { ensureIndexes } from './store/index.js';
import { askRoutes } from './routes/ask.js';
import { memoryRoutes } from './routes/memory.js';
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

app.get('/health', async (_req, res) => {
  const dbStatus = await pingDb();
  const body: HealthResponse = {
    status: dbStatus === 'ok' ? 'ok' : 'degraded',
    // The model and provider actually serving answers, not the env defaults: with
    // LLM_PROVIDER=fake, saying "claude-haiku-4-5" would make every local number a lie.
    model: providers.llm.model,
    searchProvider: providers.search.name,
    vectorStore: vectorBackend(),
    db: dbStatus,
    ai: { status: 'ok' }
  };
  res.status(dbStatus === 'ok' ? 200 : 503).json(body);
});

// ---------------------------------------------------------------- what is built (Week 1)

app.use(threadRoutes);
app.use(askRoutes(providers));
app.use(memoryRoutes);
app.use(statsRoutes);

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

app.listen(env.port, () => {
  log.info(
    {
      port: env.port,
      llmProvider: providers.llm.name,
      model: providers.llm.model,
      searchProvider: providers.search.name,
      embedder: providers.embedder.model,
      vectorStore: vectorBackend(),
      caps: {
        quick: { toolCalls: env.maxToolCalls, wallClockSec: env.maxWallClockSec },
        deep: { toolCalls: env.maxToolCallsDeep, wallClockSec: env.maxWallClockSecDeep, dailyCap: env.deepDailyCap }
      }
    },
    'agent up — quick loop, threads, memory and stats are live; spaces and deep search are still 501'
  );
  // Warm the connection and the indexes so the first question does not pay for them, and so a
  // Mongo that is unreachable shows up in the log at boot rather than in a user's answer.
  ensureIndexes().catch((err: Error) => log.error({ err: err.message }, 'index setup failed'));
});
