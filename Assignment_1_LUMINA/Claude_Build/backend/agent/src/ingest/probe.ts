import type { ChunkDoc } from '@lumina/contract';
import type { Logger } from 'pino';
import { vectorBackend } from '../db.js';
import { env } from '../env.js';
import { PROBE_BACKOFF_SEC } from '../config/rag.js';
import { chunks } from '../store/index.js';

/**
 * The read-your-write probe: the only thing that earns a document the `indexed` status.
 *
 * "Upserted" is not "searchable". An Atlas Search index is eventually consistent, so a chunk
 * that a `bulkWrite` has acknowledged is invisible to `$vectorSearch` for anywhere from a
 * moment to tens of seconds. A document marked `indexed` on the write acknowledgement looks
 * correct and answers "no matching passages" — the most expensive kind of wrong, because
 * nothing in the system reports an error.
 *
 * So: ask the index, with the chunk's OWN embedding, for its own chunk back. Retry with
 * backoff. If it never appears, fail the document loudly. A document that cannot be searched
 * is not indexed, whatever the write said.
 */

export interface ProbeResult {
  ok: true;
  attempts: number;
  ms: number;
  backend: 'atlas-vector-search' | 'mongo-cosine-scan';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function probe(
  chunk0: ChunkDoc,
  opts: { log?: Logger; backoffSec?: readonly number[] } = {}
): Promise<ProbeResult> {
  const backend = vectorBackend();
  const backoff = opts.backoffSec ?? PROBE_BACKOFF_SEC;
  const started = Date.now();
  const prefix = `${chunk0.docId}:`;

  // 1 + backoff.length attempts: the first immediately, then one after each wait.
  for (let attempt = 1; attempt <= backoff.length + 1; attempt++) {
    const visible =
      backend === 'atlas-vector-search' ? await probeVector(chunk0, prefix) : await probeFindOne(chunk0);

    if (visible) {
      const result: ProbeResult = { ok: true, attempts: attempt, ms: Date.now() - started, backend };
      opts.log?.info(
        {
          docId: chunk0.docId,
          backend,
          attempts: attempt,
          ms: result.ms,
          how:
            backend === 'atlas-vector-search'
              ? '$vectorSearch on chunks_vector returned one of this document\'s own chunks'
              : 'mongo-cosine-scan has no search index, so the probe is findOne on the chunk itself'
        },
        'read-your-write probe succeeded'
      );
      return result;
    }

    const wait = backoff[attempt - 1];
    if (wait === undefined) break;
    opts.log?.debug({ docId: chunk0.docId, attempt, waitSec: wait }, 'probe miss — chunk not visible yet');
    await sleep(wait * 1000);
  }

  const total = backoff.reduce((a, b) => a + b, 0);
  throw new Error(
    `read-your-write probe failed: chunk not visible in chunks_vector after ${total} s`
  );
}

/**
 * The same `$vectorSearch` the tool runs, with the same index, the same filter field and the
 * same shape — a probe against a different query than production uses proves nothing about
 * production.
 */
async function probeVector(chunk0: ChunkDoc, prefix: string): Promise<boolean> {
  const col = await chunks();
  const hits = await col
    .aggregate<{ _id: string }>([
      {
        $vectorSearch: {
          index: 'chunks_vector',
          path: 'embedding',
          queryVector: chunk0.embedding,
          numCandidates: env.ragVectorNumCandidates,
          limit: 5,
          filter: { spaceId: chunk0.spaceId }
        }
      },
      { $project: { _id: 1 } }
    ])
    .toArray();
  return hits.some((h) => h._id.startsWith(prefix));
}

/** No search index exists on a plain mongod, so the honest probe is the write itself. */
async function probeFindOne(chunk0: ChunkDoc): Promise<boolean> {
  const col = await chunks();
  return (await col.findOne({ _id: chunk0._id }, { projection: { _id: 1 } })) !== null;
}
