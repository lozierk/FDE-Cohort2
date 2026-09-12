import { Router } from 'express';
import { ListMemoryResponse } from '@lumina/contract';
import { deleteMemory, listMemories } from '../store/index.js';
import { requireUser, sendError } from './context.js';

export const memoryRoutes = Router();

/** Nothing is remembered that this route does not show. That is the whole contract of memory. */
memoryRoutes.get('/memory', requireUser, async (req, res, next) => {
  try {
    const rows = await listMemories(req.userId!);
    res.json(
      ListMemoryResponse.parse({
        memories: rows.map((m) => ({
          id: m._id,
          text: m.text,
          ...(m.sourceThread ? { sourceThread: m.sourceThread } : {}),
          createdAt: new Date(m.createdAt).toISOString()
        }))
      })
    );
  } catch (err) {
    next(err);
  }
});

memoryRoutes.delete('/memory/:memoryId', requireUser, async (req, res, next) => {
  try {
    const id = req.params.memoryId ?? '';
    const removed = await deleteMemory(req.userId!, id);
    if (!removed) {
      sendError(res, 404, `no memory ${id}`);
      return;
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
