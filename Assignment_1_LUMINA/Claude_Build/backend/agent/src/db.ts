import { MongoClient, type Db } from 'mongodb';
import { env } from './env.js';
import { log } from './log.js';

let client: MongoClient | null = null;
let connecting: Promise<Db> | null = null;
/** Kept so the process can shut the in-memory server down; typed loosely to avoid a hard import. */
let memoryServer: { stop(): Promise<boolean> } | null = null;
let resolvedUri = '';

/**
 * No Atlas exists until 2026-09-12, and the whole build has to be exercisable today. So when
 * MONGODB_URI is empty outside production we start ONE `mongodb-memory-server` per process
 * and use its URI. It is a dev fallback and it says so, loudly, once: an in-memory Mongo has
 * no Atlas Vector Search, which is why /health reports `mongo-cosine-scan` in that mode.
 */
async function resolveUri(): Promise<string> {
  if (env.mongoUri) return env.mongoUri;
  if (env.nodeEnv === 'production') {
    throw new Error('MONGODB_URI is not set and NODE_ENV=production — refusing the in-memory fallback');
  }
  if (resolvedUri) return resolvedUri;
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const server = await MongoMemoryServer.create();
  memoryServer = server;
  resolvedUri = server.getUri();
  log.warn(
    { vectorStore: 'mongo-cosine-scan' },
    'MONGODB_URI is empty — started an in-memory MongoDB for this process. Data is lost on exit and there is no Atlas Vector Search.'
  );
  return resolvedUri;
}

/** One client per process. The driver pools connections; do not open one per request. */
export async function db(): Promise<Db> {
  if (client) return client.db(env.mongoDb);
  if (!connecting) {
    connecting = (async () => {
      const uri = await resolveUri();
      const c = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
      await c.connect();
      client = c;
      return c.db(env.mongoDb);
    })();
  }
  return connecting;
}

/**
 * The URI actually in use, once the in-memory fallback has resolved one.
 *
 * The forked worker needs it: with MONGODB_URI empty, parent and child would each start their
 * OWN in-memory mongod and the child would poll an empty `jobs` collection forever. Handing it
 * the parent's URI is what makes a keyless local run work end to end.
 */
export async function mongoUriInUse(): Promise<string> {
  await db();
  return env.mongoUri || resolvedUri;
}

export async function pingDb(): Promise<'ok' | 'down'> {
  try {
    await (await db()).command({ ping: 1 });
    return 'ok';
  } catch {
    return 'down';
  }
}

/**
 * The vector backend actually in force. An in-memory or self-hosted mongod has no
 * `$vectorSearch`, so claiming `atlas-vector-search` on /health would make a recall number
 * incomparable. Honesty is cheap here.
 */
export function vectorBackend(): 'atlas-vector-search' | 'mongo-cosine-scan' {
  if (!env.mongoUri) return 'mongo-cosine-scan';
  return env.vectorBackend;
}

export async function closeDb(): Promise<void> {
  await client?.close();
  client = null;
  connecting = null;
  await memoryServer?.stop();
  memoryServer = null;
  resolvedUri = '';
}
