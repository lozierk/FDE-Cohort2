import { randomUUID } from 'node:crypto';
import {
  COLLECTIONS,
  newId,
  type MemoryDoc,
  type MessageDoc,
  type RequestDoc,
  type RunDoc,
  type Source,
  type ThreadDoc,
  type DoneEvent
} from '@lumina/contract';
import { db } from '../db.js';
import { ensureSearchCacheIndex } from '../cache/search-cache.js';
import { log } from '../log.js';

/** Thin functions over the collections. No ODM: zod is the contract, the driver is enough. */

export const threads = async () => (await db()).collection<ThreadDoc>(COLLECTIONS.threads);
export const messages = async () => (await db()).collection<MessageDoc>(COLLECTIONS.messages);
export const memories = async () => (await db()).collection<MemoryDoc>(COLLECTIONS.memories);
export const requests = async () => (await db()).collection<RequestDoc>(COLLECTIONS.requests);
export const runs = async () => (await db()).collection<RunDoc>(COLLECTIONS.runs);

let indexesReady: Promise<void> | null = null;

/** Idempotent, and run once at startup so the first request does not pay for it. */
export async function ensureIndexes(): Promise<void> {
  if (!indexesReady) {
    indexesReady = (async () => {
      await (await threads()).createIndex({ userId: 1, createdAt: -1 });
      await (await messages()).createIndex({ threadId: 1, createdAt: 1 });
      await (await memories()).createIndex({ userId: 1 });
      await (await requests()).createIndex({ userId: 1, createdAt: -1 });
      await ensureSearchCacheIndex();
      log.info('indexes ensured');
    })();
  }
  return indexesReady;
}

// ---------------------------------------------------------------- threads & messages

export async function createThread(userId: string, title?: string): Promise<ThreadDoc> {
  const doc: ThreadDoc = {
    _id: newId('thr'),
    userId,
    title: title?.trim() || 'New thread',
    createdAt: new Date()
  };
  await (await threads()).insertOne(doc);
  return doc;
}

export async function listThreads(userId: string): Promise<ThreadDoc[]> {
  return (await threads()).find({ userId }).sort({ createdAt: -1 }).limit(100).toArray();
}

export async function getThread(userId: string, threadId: string): Promise<ThreadDoc | null> {
  return (await threads()).findOne({ _id: threadId, userId });
}

export async function listMessages(threadId: string, limit = 200): Promise<MessageDoc[]> {
  return (await messages()).find({ threadId }).sort({ createdAt: 1 }).limit(limit).toArray();
}

export async function appendMessage(input: {
  threadId: string;
  userId: string;
  role: 'user' | 'assistant';
  content: string;
  answerId?: string;
  sources?: Source[];
  done?: DoneEvent;
}): Promise<MessageDoc> {
  const doc: MessageDoc = {
    _id: randomUUID(),
    threadId: input.threadId,
    userId: input.userId,
    role: input.role,
    content: input.content,
    sources: input.sources ?? [],
    ...(input.answerId ? { answerId: input.answerId } : {}),
    ...(input.done ? { done: input.done } : {}),
    createdAt: new Date()
  };
  await (await messages()).insertOne(doc);
  return doc;
}

// ---------------------------------------------------------------- memories

export async function insertMemory(input: {
  userId: string;
  text: string;
  embedding: number[];
  sourceThread?: string;
}): Promise<MemoryDoc> {
  const doc: MemoryDoc = {
    _id: newId('mem'),
    userId: input.userId,
    text: input.text,
    embedding: input.embedding,
    ...(input.sourceThread ? { sourceThread: input.sourceThread } : {}),
    createdAt: new Date()
  };
  await (await memories()).insertOne(doc);
  return doc;
}

export async function listMemories(userId: string): Promise<MemoryDoc[]> {
  return (await memories()).find({ userId }).sort({ createdAt: -1 }).limit(500).toArray();
}

export async function deleteMemory(userId: string, id: string): Promise<boolean> {
  const res = await (await memories()).deleteOne({ _id: id, userId });
  return res.deletedCount === 1;
}

// ---------------------------------------------------------------- ledger

export async function insertRequest(doc: RequestDoc): Promise<void> {
  await (await requests()).insertOne(doc);
}

export async function insertRun(doc: RunDoc): Promise<void> {
  await (await runs()).insertOne(doc as RunDoc);
}
