import { Router } from 'express';
import {
  CreateThreadBody,
  CreateThreadResponse,
  GetThreadResponse,
  ListThreadsResponse,
  type ThreadMessage
} from '@lumina/contract';
import { createThread, getThread, listMessages, listThreads } from '../store/index.js';
import { requireUser, sendError } from './context.js';

export const threadRoutes = Router();

threadRoutes.post('/threads', requireUser, async (req, res, next) => {
  try {
    const parsed = CreateThreadBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(res, 400, parsed.error.issues[0]?.message ?? 'invalid body');
      return;
    }
    const thread = await createThread(req.userId!, parsed.data.title);
    res.status(200).json(CreateThreadResponse.parse({ threadId: thread._id }));
  } catch (err) {
    next(err);
  }
});

threadRoutes.get('/threads', requireUser, async (req, res, next) => {
  try {
    const rows = await listThreads(req.userId!);
    res.json(
      ListThreadsResponse.parse({
        threads: rows.map((t) => ({
          threadId: t._id,
          title: t.title,
          createdAt: new Date(t.createdAt).toISOString()
        }))
      })
    );
  } catch (err) {
    next(err);
  }
});

threadRoutes.get('/threads/:threadId', requireUser, async (req, res, next) => {
  try {
    const threadId = req.params.threadId ?? '';
    const thread = await getThread(req.userId!, threadId);
    // Not this user's thread and a thread that does not exist are the same 404 on purpose:
    // a 403 would confirm the id exists to someone who should not know that.
    if (!thread) {
      sendError(res, 404, `no thread ${threadId}`);
      return;
    }
    const rows = await listMessages(threadId);
    const messages: ThreadMessage[] = rows.map((m) => ({
      role: m.role,
      content: m.content,
      sources: m.sources ?? [],
      ...(m.answerId ? { answerId: m.answerId } : {}),
      ...(m.done ? { done: m.done } : {}),
      createdAt: new Date(m.createdAt).toISOString()
    }));
    const body = GetThreadResponse.parse({ threadId: thread._id, title: thread.title, messages });
    /**
     * SPEC §7 shows `subQuestions` on an assistant message, but the contract's `ThreadMessage`
     * does not declare it and zod strips what it does not declare. `packages/contract` is
     * read-only, so the plan is validated as part of the stored `MessageDoc` and then put back
     * on the wire here. Without it a deep answer loses its plan the moment the stream ends.
     */
    res.json({
      ...body,
      messages: body.messages.map((m, i) =>
        rows[i]?.subQuestions?.length ? { ...m, subQuestions: rows[i]!.subQuestions } : m
      )
    });
  } catch (err) {
    next(err);
  }
});
