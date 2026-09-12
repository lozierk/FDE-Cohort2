import { createHash } from 'node:crypto';
import type { Collection } from 'mongodb';
import { COLLECTIONS, type SearchCacheDoc } from '@lumina/contract';
import { db } from '../db.js';
import { log } from '../log.js';
import type { SearchProvider, SearchResult } from '../providers/search.js';
import { Lru } from './lru.js';

/** lowercase, trim, collapse whitespace, strip trailing punctuation. */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\s.,;:!?'")\]]+$/g, '')
    .trim();
}

export function cacheKey(query: string, provider: string): string {
  return createHash('sha256').update(`${normalizeQuery(query)}|${provider}`).digest('hex');
}

const BYPASS_WORDS = ['today', 'latest', 'now', 'current'];

/**
 * A cached answer to "what is the latest X" is a wrong answer with a good p95. These queries
 * skip both tiers, and a bypassed search counts as uncached in `done.searchCached`.
 */
export function bypassesCache(query: string, now = new Date()): boolean {
  const q = ` ${normalizeQuery(query)} `;
  if (BYPASS_WORDS.some((w) => q.includes(` ${w} `))) return true;
  const thisYear = now.getUTCFullYear();
  for (const m of q.matchAll(/\b(\d{4})\b/g)) {
    if (Number(m[1]) >= thisYear) return true;
  }
  return false;
}

export interface CachedSearch {
  results: SearchResult[];
  /** false when the query bypassed the cache or neither tier held it. */
  hit: boolean;
  tier: 'lru' | 'mongo' | 'provider' | 'bypass';
}

const lru = new Lru<SearchResult[]>(500);
/** Exported for tests; the process only ever needs the one. */
export const searchLru = lru;

let ttlIndexReady: Promise<void> | null = null;

/** Idempotent: creating the same TTL index twice is a no-op in Mongo. */
export async function ensureSearchCacheIndex(): Promise<void> {
  if (!ttlIndexReady) {
    ttlIndexReady = (async () => {
      const col = (await db()).collection(COLLECTIONS.searchCache);
      await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'searchCache_ttl' });
    })();
  }
  return ttlIndexReady;
}

export interface SearchCacheOptions {
  ttlSeconds: number;
  /** Injected so tests can run the cache without a Mongo. */
  collection?: () => Promise<Collection<SearchCacheDoc>>;
  now?: () => Date;
}

/**
 * Tier 1 in-process LRU, tier 2 the `searchCache` collection with a TTL index. A Mongo that is
 * down degrades the cache, never the answer: we log and go to the provider.
 */
export async function cachedSearch(
  provider: SearchProvider,
  query: string,
  opts: SearchCacheOptions,
  signal?: AbortSignal
): Promise<CachedSearch> {
  const now = opts.now ? opts.now() : new Date();
  const key = cacheKey(query, provider.name);
  const expiresAt = new Date(now.getTime() + opts.ttlSeconds * 1000);

  if (bypassesCache(query, now)) {
    return { results: await provider.search(query, signal), hit: false, tier: 'bypass' };
  }

  const fromLru = lru.get(key, now.getTime());
  if (fromLru) return { results: fromLru, hit: true, tier: 'lru' };

  // SearchCacheDoc.provider is the contract's enum — tavily or serpapi, with no value for the
  // local fake. Rather than write a row that lies about which provider produced it, the fake
  // uses tier 1 only. Tier 2 is covered by its own test with an injected collection.
  const persistable = provider.name !== 'fake';
  const collection = opts.collection ?? (async () => (await db()).collection<SearchCacheDoc>(COLLECTIONS.searchCache));
  const useMongo = persistable || opts.collection !== undefined;

  if (useMongo) {
    try {
      const row = await (await collection()).findOne({ _id: key });
      if (row && new Date(row.expiresAt).getTime() > now.getTime()) {
        const results = row.results as unknown as SearchResult[];
        lru.set(key, results, new Date(row.expiresAt).getTime());
        return { results, hit: true, tier: 'mongo' };
      }
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'searchCache read failed — going to the provider');
    }
  }

  const results = await provider.search(query, signal);
  lru.set(key, results, expiresAt.getTime());
  if (useMongo) {
    try {
      const doc: SearchCacheDoc = {
        _id: key,
        provider: provider.name === 'serpapi' ? 'serpapi' : 'tavily',
        query: normalizeQuery(query),
        results: results as unknown as Record<string, unknown>[],
        expiresAt,
        createdAt: now
      };
      await (await collection()).replaceOne({ _id: key }, doc, { upsert: true });
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'searchCache write failed — the answer is unaffected');
    }
  }
  return { results, hit: false, tier: 'provider' };
}
