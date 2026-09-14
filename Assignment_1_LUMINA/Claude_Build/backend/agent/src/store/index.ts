import { randomUUID } from 'node:crypto';
import {
  COLLECTIONS,
  newId,
  type ChunkDoc,
  type DocStatus,
  type DocumentDoc,
  type JobDoc,
  type MemoryDoc,
  type MessageDoc,
  type RequestDoc,
  type RunDoc,
  type SpaceDoc,
  type Source,
  type ThreadDoc,
  type DoneEvent,
  type SubQuestion
} from '@lumina/contract';
import { db } from '../db.js';
import { ensureDeepQuotaIndex } from './deep-quota.js';
import { ensureGridFsIndexes } from './gridfs.js';
import { ensureSearchCacheIndex } from '../cache/search-cache.js';
import { log } from '../log.js';

/** Thin functions over the collections. No ODM: zod is the contract, the driver is enough. */

export const threads = async () => (await db()).collection<ThreadDoc>(COLLECTIONS.threads);
export const messages = async () => (await db()).collection<MessageDoc>(COLLECTIONS.messages);
export const memories = async () => (await db()).collection<MemoryDoc>(COLLECTIONS.memories);
export const requests = async () => (await db()).collection<RequestDoc>(COLLECTIONS.requests);
export const runs = async () => (await db()).collection<RunDoc>(COLLECTIONS.runs);
export const spaces = async () => (await db()).collection<SpaceDoc>(COLLECTIONS.spaces);
export const documents = async () => (await db()).collection<DocumentDoc>(COLLECTIONS.documents);
export const chunks = async () => (await db()).collection<ChunkDoc>(COLLECTIONS.chunks);
export const jobs = async () => (await db()).collection<JobDoc>(COLLECTIONS.jobs);

let indexesReady: Promise<void> | null = null;

/**
 * Idempotent, and run once at startup so the first request does not pay for it.
 *
 * The regular indexes mirror `scripts/indexes.json` exactly. Atlas already has them, but the
 * in-memory fallback does not, and a jobs claim that does a collection scan in a test and an
 * index seek in production is two different pieces of code wearing one name.
 */
export async function ensureIndexes(): Promise<void> {
  if (!indexesReady) {
    indexesReady = (async () => {
      await (await threads()).createIndex({ userId: 1, createdAt: -1 });
      await (await messages()).createIndex({ threadId: 1, createdAt: 1 });
      await (await memories()).createIndex({ userId: 1 });
      await (await requests()).createIndex({ userId: 1, createdAt: -1 });
      await (await spaces()).createIndex({ userId: 1 });
      await (await documents()).createIndex({ spaceId: 1 });
      await (await documents()).createIndex({ userId: 1, createdAt: -1 });
      await (await chunks()).createIndex({ docId: 1, ord: 1 });
      await (await chunks()).createIndex({ spaceId: 1 });
      await (await jobs()).createIndex({ status: 1, createdAt: 1 });
      await (await jobs()).createIndex({ status: 1, claimedAt: 1 });
      await ensureGridFsIndexes();
      await ensureSearchCacheIndex();
      // TTL on the deep-search quota rows: a spend gate that accumulates a row per user per
      // day forever is a gate with a storage leak attached.
      await ensureDeepQuotaIndex();
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
  /** The plan a deep answer ran, so the answer stays explainable after the stream is gone. */
  subQuestions?: SubQuestion[];
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
    ...(input.subQuestions?.length ? { subQuestions: input.subQuestions } : {}),
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

// ---------------------------------------------------------------- spaces

export async function createSpace(userId: string, name: string): Promise<SpaceDoc> {
  const doc: SpaceDoc = { _id: newId('spc'), userId, name: name.trim(), createdAt: new Date() };
  await (await spaces()).insertOne(doc);
  return doc;
}

export async function listSpaces(userId: string): Promise<SpaceDoc[]> {
  return (await spaces()).find({ userId }).sort({ createdAt: -1 }).limit(200).toArray();
}

/**
 * A space that does not exist and a space owned by someone else are the SAME miss: a 403
 * would confirm the id exists to a caller who has no business knowing that, and the ask
 * route leans on this being one lookup so an unknown spaceId is a 404 before any streaming.
 */
export async function getSpace(userId: string, spaceId: string): Promise<SpaceDoc | null> {
  return (await spaces()).findOne({ _id: spaceId, userId });
}

// ---------------------------------------------------------------- documents

export async function insertDocument(doc: DocumentDoc): Promise<void> {
  await (await documents()).insertOne(doc);
}

export async function getDocument(docId: string): Promise<DocumentDoc | null> {
  return (await documents()).findOne({ _id: docId });
}

/** Oldest first: the upload order is the order a user watches them index. */
export async function listDocuments(spaceId: string): Promise<DocumentDoc[]> {
  return (await documents()).find({ spaceId }).sort({ createdAt: 1 }).limit(500).toArray();
}

/**
 * Every stage transition goes through here, so `pct` and `status` can never disagree about
 * how far along a document is. `error` is `$unset` on a retry rather than left behind: a stale
 * error string on a document that has since indexed is worse than no error at all.
 */
export async function updateDocumentStatus(
  docId: string,
  patch: { status?: DocStatus; pct?: number; pages?: number; chunks?: number; error?: string | null }
): Promise<void> {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.pct !== undefined) set.pct = patch.pct;
  if (patch.pages !== undefined) set.pages = patch.pages;
  if (patch.chunks !== undefined) set.chunks = patch.chunks;
  if (patch.error === null) unset.error = '';
  else if (patch.error !== undefined) set.error = patch.error;

  await (await documents()).updateOne(
    { _id: docId },
    {
      ...(Object.keys(set).length ? { $set: set } : {}),
      ...(Object.keys(unset).length ? { $unset: unset } : {})
    }
  );
}

// ---------------------------------------------------------------- chunks

/**
 * Upsert by the deterministic `_id` (`${docId}:${ord}`), so a job retried after a crash
 * rewrites the chunks it already wrote instead of doubling them. That determinism is the
 * whole reason the id is not a uuid.
 */
export async function upsertChunks(docs: ChunkDoc[]): Promise<number> {
  if (!docs.length) return 0;
  const res = await (await chunks()).bulkWrite(
    docs.map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } })),
    { ordered: false }
  );
  return res.upsertedCount + res.modifiedCount + res.matchedCount;
}

/** The ids already written for this document, so a resumed job does not re-embed finished work. */
export async function existingChunkIds(docId: string): Promise<Set<string>> {
  const rows = await (await chunks())
    .find({ docId }, { projection: { _id: 1 } })
    .toArray();
  return new Set(rows.map((r) => r._id));
}

export async function countChunks(docId: string): Promise<number> {
  return (await chunks()).countDocuments({ docId });
}

// ---------------------------------------------------------------- jobs

export async function insertJob(input: {
  kind: 'index_document';
  userId: string;
  payload: Record<string, unknown>;
}): Promise<JobDoc> {
  const doc: JobDoc = {
    _id: randomUUID(),
    kind: input.kind,
    status: 'pending',
    payload: input.payload,
    userId: input.userId,
    attempts: 0,
    createdAt: new Date()
  };
  await (await jobs()).insertOne(doc);
  return doc;
}

/**
 * The atomic claim from `worker.ts`'s own header comment. One `findOneAndUpdate` is what makes
 * two workers safe: whoever loses the race sees no `pending` row, not the same row twice.
 * Oldest first, so a queue is a queue.
 */
export async function claimJob(workerId: string): Promise<JobDoc | null> {
  const res = await (await jobs()).findOneAndUpdate(
    { status: 'pending' },
    { $set: { status: 'running', claimedAt: new Date(), workerId }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, returnDocument: 'after' }
  );
  return res ?? null;
}

/**
 * A worker killed mid-job leaves `running` with a stale `claimedAt`. Nothing else can tell
 * that apart from a job in progress, which is why the lease exists and why a live job
 * refreshes `claimedAt` while it works. Returns the ids swept so the caller can log each.
 */
export async function sweepStaleJobs(leaseSec: number, now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - leaseSec * 1000);
  const stale = await (await jobs())
    .find({ status: 'running', claimedAt: { $lt: cutoff } }, { projection: { _id: 1 } })
    .toArray();
  if (!stale.length) return [];
  const ids = stale.map((j) => j._id);
  await (await jobs()).updateMany(
    { _id: { $in: ids } },
    { $set: { status: 'pending' }, $unset: { claimedAt: '', workerId: '' } }
  );
  return ids;
}

export async function touchJob(jobId: string): Promise<void> {
  await (await jobs()).updateOne({ _id: jobId }, { $set: { claimedAt: new Date() } });
}

export async function finishJob(
  jobId: string,
  status: 'pending' | 'done' | 'failed',
  error?: string
): Promise<void> {
  await (await jobs()).updateOne(
    { _id: jobId },
    {
      $set: { status, ...(error ? { error } : {}) },
      ...(status === 'pending' ? { $unset: { claimedAt: '', workerId: '' } } : {})
    }
  );
}

export async function getJob(jobId: string): Promise<JobDoc | null> {
  return (await jobs()).findOne({ _id: jobId });
}

// ---------------------------------------------------------------- ledger

export async function insertRequest(doc: RequestDoc): Promise<void> {
  await (await requests()).insertOne(doc);
}

export async function insertRun(doc: RunDoc): Promise<void> {
  await (await runs()).insertOne(doc as RunDoc);
}
