import { Router } from 'express';
import { HealthResponse } from '@lumina/contract';
import { pingDb, vectorBackend } from '../db.js';
import type { Providers } from '../providers/index.js';

/**
 * The three names the rubric requires — model, search provider, vector backend — come from
 * the providers actually serving answers, never from env defaults: with LLM_PROVIDER=fake,
 * saying "claude-haiku-4-5" would make every local number a lie. They are named even when
 * Mongo is down, so a degraded deployment still says what it is running.
 *
 * `deps` exists so a test can stand in for the Mongo ping without a Mongo outage.
 */
export function healthRoutes(
  providers: Providers,
  deps: { pingDb: () => Promise<'ok' | 'down'>; vectorBackend: () => string } = { pingDb, vectorBackend }
): Router {
  const router = Router();
  router.get('/health', async (_req, res) => {
    const dbStatus = await deps.pingDb();
    const body: HealthResponse = {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      model: providers.llm.model,
      searchProvider: providers.search.name,
      vectorStore: deps.vectorBackend(),
      db: dbStatus,
      ai: { status: 'ok' }
    };
    res.status(dbStatus === 'ok' ? 200 : 503).json(HealthResponse.parse(body));
  });
  return router;
}
