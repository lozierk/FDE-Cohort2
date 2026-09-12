import assert from 'node:assert/strict';
import test from 'node:test';
import type { Collection } from 'mongodb';
import type { SearchCacheDoc } from '@lumina/contract';
import { bypassesCache, cacheKey, cachedSearch, normalizeQuery, searchLru } from '../src/cache/search-cache.js';
import { Lru } from '../src/cache/lru.js';
import { FakeSearch } from '../src/providers/fake-search.js';

test('normalizeQuery lowercases, trims, collapses whitespace and strips trailing punctuation', () => {
  assert.equal(normalizeQuery('  What   IS Tavily? '), 'what is tavily');
  assert.equal(normalizeQuery('MongoDB\n\tvector search.'), 'mongodb vector search');
  assert.equal(normalizeQuery('a b!!'), 'a b');
});

test('the cache key is a sha256 over (normalized query, provider) and separates providers', () => {
  const a = cacheKey('What IS Tavily?', 'tavily');
  const b = cacheKey('  what is   tavily  ', 'tavily');
  const c = cacheKey('what is tavily', 'serpapi');
  assert.equal(a, b, 'queries that normalize the same share a key');
  assert.notEqual(a, c, 'the provider is part of the key');
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('time-sensitive queries bypass both tiers', () => {
  const now = new Date('2026-09-11T00:00:00Z');
  for (const q of ['news today', 'latest release notes', 'what is happening now', 'current cpi', 'best model 2026', 'roadmap 2031']) {
    assert.equal(bypassesCache(q, now), true, `${q} should bypass`);
  }
  for (const q of ['what is tavily', 'history of mongodb', 'the 1999 paper', 'nowhere to be found', 'todays' ]) {
    assert.equal(bypassesCache(q, now), false, `${q} should not bypass`);
  }
});

test('a bypassed search never reports a hit even when the LRU holds the query', async () => {
  searchLru.clear();
  const provider = new FakeSearch();
  const first = await cachedSearch(provider, 'latest tavily release', { ttlSeconds: 60 });
  const second = await cachedSearch(provider, 'latest tavily release', { ttlSeconds: 60 });
  assert.equal(first.tier, 'bypass');
  assert.equal(second.tier, 'bypass');
  assert.equal(second.hit, false);
  assert.equal(provider.queries.length, 2, 'both calls reached the provider');
});

test('tier 1: the second identical query is served from the LRU', async () => {
  searchLru.clear();
  const provider = new FakeSearch();
  const miss = await cachedSearch(provider, 'What is Tavily?', { ttlSeconds: 60 });
  const hit = await cachedSearch(provider, 'what is   tavily', { ttlSeconds: 60 });
  assert.equal(miss.hit, false);
  assert.equal(hit.hit, true);
  assert.equal(hit.tier, 'lru');
  assert.equal(provider.queries.length, 1, 'the provider was only called once');
});

test('tier 2: a row in searchCache is a hit even with a cold LRU', async () => {
  searchLru.clear();
  const rows = new Map<string, SearchCacheDoc>();
  const collection = async () =>
    ({
      findOne: async ({ _id }: { _id: string }) => rows.get(_id) ?? null,
      replaceOne: async ({ _id }: { _id: string }, doc: SearchCacheDoc) => {
        rows.set(_id, doc);
        return { acknowledged: true };
      }
    }) as unknown as Collection<SearchCacheDoc>;

  const provider = new FakeSearch();
  const miss = await cachedSearch(provider, 'mongodb cosine scan', { ttlSeconds: 600, collection });
  assert.equal(miss.hit, false);
  assert.equal(rows.size, 1, 'the miss wrote a row');

  searchLru.clear(); // cold process, warm collection
  const hit = await cachedSearch(provider, 'MongoDB Cosine Scan.', { ttlSeconds: 600, collection });
  assert.equal(hit.hit, true);
  assert.equal(hit.tier, 'mongo');
  assert.equal(provider.queries.length, 1);
});

test('the LRU evicts the least recently used key and respects expiresAt', () => {
  const lru = new Lru<string>(2);
  lru.set('a', 'A', Date.now() + 1000);
  lru.set('b', 'B', Date.now() + 1000);
  lru.get('a');
  lru.set('c', 'C', Date.now() + 1000);
  assert.equal(lru.get('b'), undefined, 'b was least recently used');
  assert.equal(lru.get('a'), 'A');
  assert.equal(lru.get('c'), 'C');

  lru.set('d', 'D', Date.now() - 1);
  assert.equal(lru.get('d'), undefined, 'an expired entry is a miss');
});
