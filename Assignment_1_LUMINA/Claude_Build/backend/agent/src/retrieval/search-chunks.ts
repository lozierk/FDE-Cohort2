import type { ChunkDoc } from '@lumina/contract';
import type { Logger } from 'pino';
import { vectorBackend } from '../db.js';
import { env } from '../env.js';
import { COSINE_SCAN_MAX_CHUNKS, COSINE_SCAN_WARN_CHUNKS } from '../config/rag.js';
import { cosine } from '../providers/embeddings.js';
import { chunks } from '../store/index.js';
import { terms } from '../loop/sources.js';

/**
 * Hybrid retrieval over one Space's chunks: a dense ranker and a lexical ranker, fused by
 * reciprocal rank fusion.
 *
 * WHY BOTH. Dense retrieval matches meaning and misses rare exact tokens — a SKU, an error
 * code, `X-Accel-Buffering`. BM25 matches those and misses paraphrase ("car" against
 * "automobile"). The gold set contains both kinds of question, so one ranker cannot clear
 * recall@5 ≥ 0.70 on it.
 *
 * WHY RRF RATHER THAN A WEIGHTED SCORE SUM. BM25 scores are unbounded and corpus-dependent
 * while cosine sits in a narrow band, so any constant scaling them together is arbitrary and
 * drifts as the corpus grows. RRF reads only ranks. What it gives up is confidence: a certain
 * retriever and a guessing one look identical once only the ordering survives.
 *
 * WHY THERE IS NO RE-RANK STEP. A cross-encoder re-rank is the standard next lift, and it is
 * deliberately not here. The corpus is four documents; RRF over two rankers already puts the
 * exact-token hits on top, and a re-ranker means one more model round trip inside a 2.5 s
 * time-to-first-token budget, on the request path, for a corpus small enough that the fused
 * top-5 already contains the answer. If the corpus grows past a few hundred documents, this
 * is the first thing to add, and the measurement that would justify it is recall@5 against
 * this same gold set.
 *
 * WHY `spaceId` FILTERS INSIDE `$vectorSearch`. The index declares it as a filter field. A
 * `$match` afterwards would let another Space's chunks win the approximate-neighbour search
 * first and then be thrown away, which silently costs recall instead of failing.
 */

/** A chunk as retrieval returns it: everything but the 1536 floats nobody downstream reads. */
export type RetrievedChunk = Omit<ChunkDoc, 'embedding'>;

export interface ChunkHit {
  chunk: RetrievedChunk;
  /** The fused RRF score. Comparable within one result set and meaningless across two. */
  score: number;
  /** 1-based rank in each ranker that returned this chunk. Absent where it did not appear. */
  ranks: { vector?: number; text?: number };
}

export interface SearchChunksInput {
  spaceId: string;
  /** Defence in depth: the Space was already resolved through its owner, and the index declares
   *  userId as a filter field too, so the filter costs nothing and makes isolation a property
   *  of the query rather than of the route above it. */
  userId: string;
  queryText: string;
  queryVec: number[];
  topK?: number;
  log?: Logger;
}

export async function searchChunks(input: SearchChunksInput): Promise<ChunkHit[]> {
  const topK = input.topK ?? env.ragTopK;
  const backend = vectorBackend();
  const [dense, lexical] =
    backend === 'atlas-vector-search' ? await atlasRankers(input) : await cosineScanRankers(input);
  return fuseRrf(dense, lexical, topK);
}

// ---------------------------------------------------------------- atlas

async function atlasRankers(input: SearchChunksInput): Promise<[RetrievedChunk[], RetrievedChunk[]]> {
  const col = await chunks();
  const limit = env.ragCandidates;

  // In parallel: the two rankers are independent, and running them in series would add the
  // slower one's latency to a request that is already spending a model round trip.
  return Promise.all([
    col
      .aggregate<RetrievedChunk>([
        {
          $vectorSearch: {
            index: 'chunks_vector',
            path: 'embedding',
            queryVector: input.queryVec,
            numCandidates: env.ragVectorNumCandidates,
            limit,
            filter: { spaceId: input.spaceId, userId: input.userId }
          }
        },
        { $project: { embedding: 0 } }
      ])
      .toArray(),
    col
      .aggregate<RetrievedChunk>([
        {
          $search: {
            index: 'chunks_text',
            compound: {
              must: [{ text: { query: input.queryText, path: 'text' } }],
              filter: [
                { equals: { path: 'spaceId', value: input.spaceId } },
                { equals: { path: 'userId', value: input.userId } }
              ]
            }
          }
        },
        { $limit: limit },
        { $project: { embedding: 0 } }
      ])
      .toArray()
  ]);
}

// ---------------------------------------------------------------- mongo-cosine-scan

/**
 * The documented local-dev fallback: exact cosine over this Space's chunks, with query-term
 * overlap as the lexical half. Exact and linear — fine to a few thousand chunks, which is why
 * it warns above 2,000 and refuses to read past 5,000 rather than quietly getting slow.
 *
 * Same signature as the Atlas path, so the tool above it has one code path and `/health`'s
 * `vectorStore` string is the only place a reader looks to know which number they are reading.
 */
async function cosineScanRankers(
  input: SearchChunksInput
): Promise<[RetrievedChunk[], RetrievedChunk[]]> {
  const col = await chunks();
  const rows = await col
    .find({ spaceId: input.spaceId, userId: input.userId })
    .limit(COSINE_SCAN_MAX_CHUNKS)
    .toArray();

  if (rows.length >= COSINE_SCAN_WARN_CHUNKS) {
    input.log?.warn(
      { spaceId: input.spaceId, chunks: rows.length, cap: COSINE_SCAN_MAX_CHUNKS },
      'mongo-cosine-scan is reading a large working set — this backend is exact but linear; use Atlas Vector Search'
    );
  }

  // Drop the 1,536 floats: nothing above this layer reads them, and carrying them into the
  // registry would put a megabyte of vector into every synthesis prompt's neighbourhood.
  const strip = (r: ChunkDoc): RetrievedChunk => {
    const rest: Record<string, unknown> = { ...r };
    delete rest.embedding;
    return rest as unknown as RetrievedChunk;
  };

  const dense = rows
    .map((r) => ({ row: r, score: cosine(input.queryVec, r.embedding) }))
    .sort((a, b) => b.score - a.score || a.row.ord - b.row.ord)
    .slice(0, env.ragCandidates)
    .map((s) => strip(s.row));

  const want = new Set(terms(input.queryText));
  const lexical = rows
    .map((r) => {
      let score = 0;
      for (const t of new Set(terms(r.text))) if (want.has(t)) score += 1;
      return { row: r, score };
    })
    // A chunk that shares no query term is not a lexical hit. Giving it a rank anyway would
    // hand RRF 5,000 equally worthless votes.
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.row.ord - b.row.ord)
    .slice(0, env.ragCandidates)
    .map((s) => strip(s.row));

  return [dense, lexical];
}

// ---------------------------------------------------------------- fusion

/** `score(d) = Σ 1/(k + rank_i(d))` over the lists that contain d. Ties break on lower `ord`. */
export function fuseRrf(dense: RetrievedChunk[], lexical: RetrievedChunk[], topK: number): ChunkHit[] {
  const k = env.ragRrfK;
  const byId = new Map<string, ChunkHit>();

  const feed = (list: RetrievedChunk[], which: 'vector' | 'text') => {
    list.forEach((chunkDoc, i) => {
      const rank = i + 1;
      const existing = byId.get(chunkDoc._id);
      if (existing) {
        existing.score += 1 / (k + rank);
        existing.ranks[which] = rank;
        return;
      }
      byId.set(chunkDoc._id, { chunk: chunkDoc, score: 1 / (k + rank), ranks: { [which]: rank } });
    });
  };

  feed(dense, 'vector');
  feed(lexical, 'text');

  return [...byId.values()]
    .sort((a, b) => b.score - a.score || a.chunk.ord - b.chunk.ord)
    .slice(0, topK);
}
