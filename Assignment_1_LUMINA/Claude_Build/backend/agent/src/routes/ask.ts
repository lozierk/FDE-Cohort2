import { Router, type Request, type Response } from 'express';
import { AskBody, DoneEvent, StreamErrorEvent, type SubQuestion } from '@lumina/contract';
import { env } from '../env.js';
import { log } from '../log.js';
import { runDeepLoop, type DeepLoopResult } from '../loop/deep.js';
import { doneEventFor, runQuickLoop, type QuickLoopResult } from '../loop/quick.js';
import type { Providers } from '../providers/index.js';
import { writeRunLog } from '../runlog.js';
import { SseStream } from '../sse.js';
import { refundDeep, reserveDeep } from '../store/deep-quota.js';
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

    /**
     * The spend gate. It comes after both 404s (thread and Space) so a request that can only
     * fail cannot burn a credit — and before everything else, because the point of a cap is
     * that it is cheaper than the thing it caps.
     *
     * Reserved, not counted: `$inc` and compare is what makes two concurrent asks on the last
     * credit safe. It is given back only if the planner fails before any retrieval.
     */
    if (depth === 'deep') {
      const reservation = await reserveDeep(userId, env.deepDailyCap);
      if (!reservation.ok) {
        // A 429 with no `resetsAt` tells a client to stop and gives it no way to know when to
        // start again. The contract asks for both, and so does the bench.
        sendError(res, 429, `deep search daily cap of ${env.deepDailyCap} reached`, {
          resetsAt: reservation.resetsAt
        });
        return;
      }
    }


    const prior = await listMessages(threadId);
    const history = prior.map((m) => ({ role: m.role, content: m.content }));
    await appendMessage({ threadId, userId, role: 'user', content: query });

    const stream = new SseStream(res);
    const abort = new AbortController();
    // A user who closed the tab should not keep a provider call alive on our bill.
    res.on('close', () => abort.abort());

    const common = {
      query,
      mode,
      userId,
      threadId,
      requestId,
      ...(spaceId ? { spaceId } : {}),
      ...(space ? { space } : {}),
      history,
      providers,
      searchCacheTtlSeconds: env.searchCacheTtlSeconds,
      log: log.child({ requestId, userId, threadId }),
      signal: abort.signal
    };

    // Two gears, two envelopes. Deep gets the wider one because it is doing more, not because
    // it is allowed to sprawl — and it is the only path that can spend a daily credit.
    let result: QuickLoopResult;
    let plan: SubQuestion[] = [];
    /** Only a planner failure gives the credit back; see the refund below. */
    let refundable = false;

    if (depth === 'deep') {
      const deep: DeepLoopResult = await runDeepLoop({
        ...common,
        caps: { maxToolCalls: env.maxToolCallsDeep, maxWallClockSec: env.maxWallClockSecDeep },
        deep: {
          subQuestionsMin: env.deepSubQuestionsMin,
          subQuestionsMax: env.deepSubQuestionsMax,
          concurrency: env.deepConcurrency,
          subToolCalls: env.deepSubToolCalls,
          passagesPerSub: env.deepPassagesPerSub,
          passageLimit: env.deepPassageLimit
        },
        emit: (event, data) => stream.send(event, data)
      });
      result = deep;
      plan = deep.subQuestions;
      refundable = deep.failedBeforeRetrieval === true;
    } else {
      result = await runQuickLoop({
        ...common,
        caps: { maxToolCalls: env.maxToolCalls, maxWallClockSec: env.maxWallClockSec },
        emit: (event, data) => stream.send(event, data)
      });
    }

    if (result.terminated === 'error') {
      const message = result.error ?? 'provider failure';
      const status = 502;
      /**
       * The credit is refunded only when the run died in the PLANNER, before any retrieval:
       * nothing was spent on the user's behalf, so charging them a fifth of their day for a
       * provider hiccup would be theft. An error after the plan frame keeps the credit —
       * searches and fetches really did happen.
       */
      if (refundable) await refundDeep(userId);
      // Before headers: a 502 with an ErrorBody, which is what a JSON client can act on.
      // After headers: an `error` frame, because the status line is already spent.
      if (stream.headersOut) {
        stream.send('error', StreamErrorEvent.parse({ status, error: message }));
        stream.end();
      } else {
        sendError(res, status, message);
      }
      await writeRunLog({ requestId, userId, threadId, query, route: '/threads/:threadId/ask', status, depth, result });
      return;
    }

    // `done` goes out first so the client's clock stops at the answer, not at the database.
    // But the connection stays open until the ledger is written: the bench cross-checks
    // /stats against the answers it just watched, and a stats call that lands between the
    // last frame and the last insert would otherwise undercount. A persistence failure is
    // logged loudly; it cannot change a status line that is already spent.
    const done: DoneEvent = doneEventFor(result, depth, plan.length);
    stream.send('done', done);
    try {
      await appendMessage({
        threadId,
        userId,
        role: 'assistant',
        content: result.answer,
        answerId: result.answerId,
        sources: result.sources,
        done,
        ...(plan.length ? { subQuestions: plan } : {})
      });
      await writeRunLog({ requestId, userId, threadId, query, route: '/threads/:threadId/ask', status: 200, depth, result });
    } catch (err) {
      log.error({ err: (err as Error).message, requestId }, 'answer streamed but persistence failed');
    } finally {
      stream.end();
    }
  }

  return router;
}
