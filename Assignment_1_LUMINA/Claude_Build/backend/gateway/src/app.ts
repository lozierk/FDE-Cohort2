/**
 * LUMINA gateway — the software backend.
 *
 * What this builds (backend/gateway/, see docs/week1-build-spec.md "Gateway"):
 *   1. X-User-Id enforcement           → 401 without it, on every route but /health
 *   2. zod validation from @lumina/contract → 400 on a bad body, with the zod message
 *   3. a per-user rate limit           → 429
 *   4. the proxy to the agent service, and SSE pass-through for /threads/:id/ask
 *   5. 502 for any upstream failure    → never a 2xx when the agent threw
 *
 * The browser talks ONLY to this service. No provider key is ever read here.
 *
 * Split out of index.ts (which used to build and .listen() in one file) so tests can
 * import `app` and .listen(0) it themselves against a stub agent, without the real
 * process's listen() firing.
 */
import express from 'express';
import cors from 'cors';
import { pinoHttp } from 'pino-http';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import {
  AskBody,
  CreateSpaceBody,
  CreateThreadBody,
  HealthResponse,
  REQUEST_HEADER,
  ROUTES,
  USER_HEADER
} from '@lumina/contract';
import type { ZodType } from 'zod';
import { env } from './env.js';
import { sseHeaders } from './sse.js';

export const log = pino({ level: env.logLevel });
export const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: env.corsOrigins, credentials: false, exposedHeaders: [REQUEST_HEADER] }));

// One request id, reused if the caller sent one, generated if not, forwarded to the agent
// service and logged by both. This is what makes one request greppable end to end.
app.use((req, res, next) => {
  const id = (req.header(REQUEST_HEADER) ?? `req_${randomUUID().slice(0, 12)}`).trim();
  res.locals.requestId = id;
  res.setHeader(REQUEST_HEADER, id);
  next();
});

app.use(
  pinoHttp({
    logger: log,
    genReqId: (_req, res) => String(res.locals.requestId),
    customProps: (req, res) => ({
      requestId: res.locals.requestId,
      userId: req.header(USER_HEADER) ?? null
    }),
    // The ask route is a stream; one line when it closes is the useful line.
    autoLogging: true
  })
);

// ---------------------------------------------------------------- helpers

function errorBody(res: express.Response, error: string, status: number, resetsAt?: string) {
  return {
    error,
    status,
    requestId: String(res.locals.requestId),
    ...(resetsAt ? { resetsAt } : {})
  };
}

/** Route paths that do not require X-User-Id, straight from the contract's route table. */
const noAuthPaths = new Set<string>(ROUTES.filter((r) => !r.auth).map((r) => r.path));

// ---------------------------------------------------------------- 1. X-User-Id

app.use((req, res, next) => {
  if (noAuthPaths.has(req.path)) return next();
  const userId = req.header(USER_HEADER);
  if (!userId || !userId.trim()) {
    res.status(401).json(errorBody(res, `missing required header ${USER_HEADER}`, 401));
    return;
  }
  next();
});

// ---------------------------------------------------------------- 3. per-user rate limit

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const key = req.header(USER_HEADER) ?? 'anonymous';
  const now = Date.now();
  let bucket = rateLimitBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > env.rateLimitPerMinute) {
    res
      .status(429)
      .json(errorBody(res, 'rate limit exceeded', 429, new Date(bucket.resetAt).toISOString()));
    return;
  }
  next();
});

// JSON everywhere except the multipart upload route, which its handler owns.
app.use((req, res, next) =>
  req.path.endsWith('/documents') && req.method === 'POST'
    ? next()
    : express.json({ limit: '1mb' })(req, res, next)
);

// ---------------------------------------------------------------- 2. zod validation

/** Parses req.body with `schema` (applying its defaults), or answers 400 with the first issue. */
function validateBody(schema: ZodType) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? 'invalid request body';
      res.status(400).json(errorBody(res, message, 400));
      return;
    }
    req.body = result.data;
    next();
  };
}

// ---------------------------------------------------------------- 4/6. proxy (JSON routes)

/** Forward the current request to the agent service and mirror its status + JSON body. */
async function proxyJson(
  req: express.Request,
  res: express.Response,
  opts: { timeoutMs?: number } = {}
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const hasBody = req.method !== 'GET' && req.method !== 'DELETE';
  let upstream: Response;
  try {
    upstream = await fetch(`${env.agentUrl}${req.originalUrl}`, {
      method: req.method,
      headers: {
        'content-type': 'application/json',
        [USER_HEADER]: req.header(USER_HEADER) ?? '',
        [REQUEST_HEADER]: String(res.locals.requestId)
      },
      body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    res.status(502).json(errorBody(res, `agent unreachable: ${(err as Error).message}`, 502));
    return;
  }

  // 204 has no body by definition — DELETE /memory/:id answers that way — and mirroring it
  // as a "non-JSON body" 502 is how the first full bench lost every memory gate to a delete
  // that had in fact succeeded.
  if (upstream.status === 204) {
    res.status(204).end();
    return;
  }
  let json: unknown;
  try {
    json = await upstream.json();
  } catch {
    res.status(502).json(errorBody(res, 'agent returned a non-JSON body', 502));
    return;
  }
  res.status(upstream.status).json(json as Record<string, unknown>);
}

// ---------------------------------------------------------------- /health (provided)

app.get('/health', async (_req, res) => {
  let ai: { status: 'ok' | 'down' } & Record<string, unknown> = { status: 'down' };
  try {
    const upstream = await fetch(`${env.agentUrl}/health`, { signal: AbortSignal.timeout(3000) });
    const body = (await upstream.json()) as Record<string, unknown>;
    ai = { ...body, status: upstream.ok ? 'ok' : 'down' };
  } catch (err) {
    // Health tells the truth about a dead dependency. It never pretends.
    ai = { status: 'down', error: (err as Error).message };
  }

  const body: HealthResponse = {
    status: ai.status === 'ok' ? 'ok' : 'degraded',
    model: String(ai.model ?? 'unset'),
    searchProvider: (ai.searchProvider as HealthResponse['searchProvider']) ?? 'tavily',
    vectorStore: (ai.vectorStore as HealthResponse['vectorStore']) ?? 'atlas-vector-search',
    db: (ai.db as HealthResponse['db']) ?? 'down',
    ai
  };
  res.status(ai.status === 'ok' ? 200 : 503).json(body);
});

// ---------------------------------------------------------------- 7. GET /evals/report.json

app.get('/evals/report.json', async (req, res) => {
  const reportPath = resolve(process.cwd(), '../../reports/latest.json');
  if (existsSync(reportPath)) {
    try {
      const raw = await readFile(reportPath, 'utf8');
      res.status(200).type('application/json').send(raw);
    } catch (err) {
      res.status(502).json(errorBody(res, `failed to read report: ${(err as Error).message}`, 502));
    }
    return;
  }
  await proxyJson(req, res);
});

// ---------------------------------------------------------------- threads

app.post('/threads', validateBody(CreateThreadBody), (req, res) => proxyJson(req, res));
app.get('/threads', (req, res) => proxyJson(req, res));
app.get('/threads/:threadId', (req, res) => proxyJson(req, res));

// ---------------------------------------------------------------- 5. POST /threads/:id/ask (SSE)

app.post('/threads/:threadId/ask', validateBody(AskBody), async (req, res) => {
  const timeoutMs = (env.maxWallClockSecDeep + 10) * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // `req`'s own 'close' fires as soon as the (small, already-buffered) request body has
  // been fully read — well before the response is done — so it is not a client-disconnect
  // signal. `res`'s 'close' fires when the underlying connection actually closes; it only
  // means "the client went away before we were finished" when we have not called
  // res.end() ourselves yet (writableEnded is false).
  const onResClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onResClose);
  const cleanup = () => {
    clearTimeout(timer);
    res.off('close', onResClose);
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${env.agentUrl}${req.originalUrl}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [USER_HEADER]: req.header(USER_HEADER) ?? '',
        [REQUEST_HEADER]: String(res.locals.requestId)
      },
      body: JSON.stringify(req.body ?? {}),
      signal: controller.signal
    });
  } catch (err) {
    cleanup();
    res.status(502).json(errorBody(res, `agent unreachable: ${(err as Error).message}`, 502));
    return;
  }

  // Upstream answered before it started streaming (e.g. 404/429/502 from the agent): pass
  // its status and JSON body through untouched. Only a 2xx starts the SSE stream.
  if (!upstream.ok) {
    cleanup();
    let body: unknown;
    try {
      body = await upstream.json();
    } catch {
      body = errorBody(res, `agent responded ${upstream.status}`, upstream.status);
    }
    res.status(upstream.status).json(body as Record<string, unknown>);
    return;
  }

  sseHeaders(res);

  if (!upstream.body) {
    cleanup();
    res.end();
    return;
  }

  // Pipe raw bytes through, chunk by chunk, with no parsing: the frame order the agent
  // wrote (plan → trace → sources → token → done, or error) is exactly the order the
  // client receives, because nothing here reorders or buffers a whole response.
  const nodeStream = Readable.fromWeb(upstream.body as WebReadableStream<Uint8Array>);
  nodeStream.on('data', (chunk: Buffer) => {
    res.write(chunk);
    // @ts-expect-error `flush` exists when a compression middleware is present; harmless otherwise.
    if (typeof res.flush === 'function') res.flush();
  });
  nodeStream.on('end', () => {
    cleanup();
    res.end();
  });
  nodeStream.on('error', () => {
    cleanup();
    res.end();
  });
});

// ---------------------------------------------------------------- memory

app.get('/memory', (req, res) => proxyJson(req, res));
app.delete('/memory/:memoryId', (req, res) => proxyJson(req, res));

// ---------------------------------------------------------------- spaces & documents

app.post('/spaces', validateBody(CreateSpaceBody), (req, res) => proxyJson(req, res));
app.get('/spaces', (req, res) => proxyJson(req, res));
app.get('/spaces/:spaceId/documents', (req, res) => proxyJson(req, res));

// POST /spaces/:id/documents: stream the raw (multipart) request body through untouched.
// express.json() was never applied to this path (see the conditional above), so `req`
// itself is still the untouched incoming stream.
app.post('/spaces/:spaceId/documents', async (req, res) => {
  const timeoutMs = 60_000; // not specified for uploads; generous vs. the 15s JSON timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // See the /ask route: `res`'s 'close' (not `req`'s) is the real client-disconnect signal.
  const onResClose = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', onResClose);
  const cleanup = () => {
    clearTimeout(timer);
    res.off('close', onResClose);
  };

  const headers: Record<string, string> = {
    [USER_HEADER]: req.header(USER_HEADER) ?? '',
    [REQUEST_HEADER]: String(res.locals.requestId)
  };
  const contentType = req.header('content-type');
  if (contentType) headers['content-type'] = contentType;
  const contentLength = req.header('content-length');
  if (contentLength) headers['content-length'] = contentLength;

  try {
    const upstream = await fetch(`${env.agentUrl}${req.originalUrl}`, {
      method: 'POST',
      headers,
      body: Readable.toWeb(req) as unknown as ReadableStream,
      // Node's fetch requires an explicit opt-in to stream a request body.
      duplex: 'half',
      signal: controller.signal
    } as RequestInit & { duplex: 'half' });
    cleanup();

    let json: unknown;
    try {
      json = await upstream.json();
    } catch {
      res.status(502).json(errorBody(res, 'agent returned a non-JSON body', 502));
      return;
    }
    res.status(upstream.status).json(json as Record<string, unknown>);
  } catch (err) {
    cleanup();
    res.status(502).json(errorBody(res, `agent unreachable: ${(err as Error).message}`, 502));
  }
});

// ---------------------------------------------------------------- /stats

app.get('/stats', (req, res) => proxyJson(req, res));

// ---------------------------------------------------------------- static UI

// In production the gateway serves the built UI, so / and /evals come from one origin.
if (existsSync(env.webDist)) {
  app.use(express.static(env.webDist));
  app.get(/^(?!\/(health|stats|threads|memory|spaces|artifacts|evals)).*/, (_req, res) => {
    res.sendFile(`${env.webDist}/index.html`);
  });
}

app.use((req, res) => {
  res.status(404).json({ error: `no route ${req.method} ${req.path}`, status: 404 });
});

// A thrown error is a 502 with a log line, never a 200 with a plausible body (rule A1).
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error({ err, requestId: res.locals.requestId }, 'gateway error');
  res.status(502).json({ error: err.message, status: 502, requestId: String(res.locals.requestId) });
});
