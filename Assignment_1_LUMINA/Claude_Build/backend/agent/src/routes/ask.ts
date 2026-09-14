import { Router, type Request, type Response } from 'express';
import { AskBody, DoneEvent, StreamErrorEvent } from '@lumina/contract';
import { env } from '../env.js';
import { log } from '../log.js';
import { doneEventFor, runQuickLoop } from '../loop/quick.js';
import type { Providers } from '../providers/index.js';
import { writeRunLog } from '../runlog.js';
import { SseStream } from '../sse.js';
import { appendMessage, getSpace, getThread, listDocuments, listMessages } from '../store/index.js';
import { requireUser, sendError } from './context.js';

export function askRoutes(providers: Providers): Router {
  const router = Router();

  // Express 4 does not catch a rejected promise from an async handler: it becomes an unhandled
  // rejection and the request hangs. Every async route needs this wrapper or a try/catch.
  router.post('/threads/:threadId/ask', requireUser, (req, res, next) => {
    handleAsk(req, res).catch(next);
  });

  async function handleAsk(req: Request, res: Response): Promise<void> {
    const userId = req.userId!;
    const requestId = req.requestId!;
    const threadId = req.params.threadId ?? '';

    const parsed = AskBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(res, 400, parsed.error.issues[0]?.message ?? 'invalid body');
      return;
    }
    const { query, mode, depth, spaceId } = parsed.data;

    // Depth is opted into, never drifted into — and this week the deep gear is not built, so
    // it says so rather than quietly serving a quick answer under a deep label.
    if (depth === 'deep') {
      sendError(res, 501, 'deep search not built yet');
      return;
    }

    const thread = await getThread(userId, threadId);
    if (!thread) {
      sendError(res, 404, `no thread ${threadId}`);
      return;
    }

    // An unknown Space, or one belonging to someone else, is a 404 BEFORE any streaming starts.
    // Once the first SSE frame is out the status line is spent, and the caller would get a
    // 200 carrying an answer about nothing.
    let space: { name: string; documents: string[] } | undefined;
    if (spaceId) {
      const row = await getSpace(userId, spaceId);
      if (!row) {
        sendError(res, 404, `no space ${spaceId}`);
        return;
      }
      // Filenames go into the research prompt so `auto` knows what the Space can answer.
      const docs = await listDocuments(spaceId);
      space = { name: row.name, documents: docs.map((d) => d.title) };
    }

    const prior = await listMessages(threadId);
    const history = prior.map((m) => ({ role: m.role, content: m.content }));
    await appendMessage({ threadId, userId, role: 'user', content: query });

    const stream = new SseStream(res);
    const abort = new AbortController();
    // A user who closed the tab should not keep a provider call alive on our bill.
    res.on('close', () => abort.abort());

    const result = await runQuickLoop({
      query,
      mode,
      userId,
      threadId,
      requestId,
      ...(spaceId ? { spaceId } : {}),
      ...(space ? { space } : {}),
      history,
      providers,
      caps: { maxToolCalls: env.maxToolCalls, maxWallClockSec: env.maxWallClockSec },
      searchCacheTtlSeconds: env.searchCacheTtlSeconds,
      emit: (event, data) => stream.send(event, data),
      log: log.child({ requestId, userId, threadId }),
      signal: abort.signal
    });

    if (result.terminated === 'error') {
      const message = result.error ?? 'provider failure';
      const status = 502;
      // Before headers: a 502 with an ErrorBody, which is what a JSON client can act on.
      // After headers: an `error` frame, because the status line is already spent.
      if (stream.headersOut) {
        stream.send('error', StreamErrorEvent.parse({ status, error: message }));
        stream.end();
      } else {
        sendError(res, status, message);
      }
      await writeRunLog({ requestId, userId, threadId, query, route: '/threads/:threadId/ask', status, depth: 'quick', result });
      return;
    }

    // `done` goes out first so the client's clock stops at the answer, not at the database.
    // But the connection stays open until the ledger is written: the bench cross-checks
    // /stats against the answers it just watched, and a stats call that lands between the
    // last frame and the last insert would otherwise undercount. A persistence failure is
    // logged loudly; it cannot change a status line that is already spent.
    const done: DoneEvent = doneEventFor(result);
    stream.send('done', done);
    try {
      await appendMessage({
        threadId,
        userId,
        role: 'assistant',
        content: result.answer,
        answerId: result.answerId,
        sources: result.sources,
        done
      });
      await writeRunLog({ requestId, userId, threadId, query, route: '/threads/:threadId/ask', status: 200, depth: 'quick', result });
    } catch (err) {
      log.error({ err: (err as Error).message, requestId }, 'answer streamed but persistence failed');
    } finally {
      stream.end();
    }
  }

  return router;
}
