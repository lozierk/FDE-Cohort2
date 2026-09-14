import { ChunkDoc } from '@lumina/contract';
import type { Logger } from 'pino';
import { env } from '../env.js';
import { embeddingCostUsd } from '../config/model.js';
import type { Embedder } from '../providers/embeddings.js';
import {
  chunks as chunksCollection,
  countChunks,
  existingChunkIds,
  getDocument,
  updateDocumentStatus,
  upsertChunks
} from '../store/index.js';
import { getFile } from '../store/gridfs.js';
import { chunk, type ChunkDraft } from './chunk.js';
import { kindOf, parse, pdfPageCount } from './parse.js';
import { probe } from './probe.js';

/**
 * The body of the one job kind LUMINA has. Runs ONLY in the worker process.
 *
 * Stages, in order, each setting `documents.status` and `pct` before it starts, so a user
 * watching the list sees where the work actually is:
 *
 *   parsing    5 → 35     GridFS read, pdfjs / markdown / text → units with locators
 *   embedding 35 → 85     chunk, embed in batches, upsert by deterministic id
 *   probe     85 → 100    ask the vector index for one of this document's own chunks
 *   indexed              only here, only after the probe came back
 *
 * Resumability is not a bonus feature, it is the point of a job row: a worker killed halfway
 * through a 60-page PDF must not re-embed the fifty pages it already paid for. The chunk `_id`
 * is `${docId}:${ord}`, deterministic, so the ids already in the collection say exactly which
 * drafts are finished work.
 *
 * Every failure throws. The worker writes the message into the document's `error` and logs it.
 * Nothing here returns a plausible-looking success.
 */

export interface IndexDocumentInput {
  docId: string;
  spaceId: string;
  userId: string;
  embedder: Embedder;
  log: Logger;
}

export interface IndexDocumentResult {
  docId: string;
  spaceId: string;
  pages?: number;
  chunks: number;
  embedTokens: number;
  embedCostUsd: number;
  parseMs: number;
  embedMs: number;
  probeMs: number;
  probeAttempts: number;
}

export async function indexDocument(input: IndexDocumentInput): Promise<IndexDocumentResult> {
  const { docId, embedder, log } = input;

  const doc = await getDocument(docId);
  if (!doc) throw new Error(`document ${docId} does not exist`);

  // ------------------------------------------------------------------ parsing
  await updateDocumentStatus(docId, { status: 'parsing', pct: 5, error: null });
  const parseStart = Date.now();

  const buffer = await getFile(doc.fileId);
  const units = await parse(buffer, doc.mimeType, doc.title);
  const isPdf = kindOf(doc.mimeType, doc.title) === 'pdf';
  // The PDF's own page count, not the last page that yielded text: a trailing image-only page
  // is still a page of the document the user uploaded.
  const pages = isPdf ? await pdfPageCount(buffer) : undefined;
  const parseMs = Date.now() - parseStart;

  if (!units.length) {
    // A blank PDF or an empty file. NOT `indexed` with zero chunks: a document that answers
    // nothing while claiming to be searchable is indistinguishable from a broken retriever.
    throw new Error('no text could be extracted');
  }

  const drafts = chunk(units);
  if (!drafts.length) throw new Error('no text could be extracted');

  await updateDocumentStatus(docId, {
    status: 'parsing',
    pct: 35,
    ...(pages ? { pages } : {})
  });

  // ------------------------------------------------------------------ embedding
  await updateDocumentStatus(docId, { status: 'embedding', pct: 35 });
  const embedStart = Date.now();
  const tokensBefore = embedder.tokensUsed;

  const already = await existingChunkIds(docId);
  const todo = drafts.filter((d) => !already.has(chunkId(docId, d.ord)));
  if (todo.length < drafts.length) {
    log.info(
      { docId, drafts: drafts.length, alreadyEmbedded: drafts.length - todo.length },
      'resuming an interrupted job — finished chunks are not re-embedded'
    );
  }

  let written = already.size;
  for (let i = 0; i < todo.length; i += env.embedBatch) {
    const batch = todo.slice(i, i + env.embedBatch);
    const vectors = await embedder.embed(batch.map((d) => d.text));
    if (vectors.length !== batch.length) {
      throw new Error(`embedder returned ${vectors.length} vectors for ${batch.length} texts`);
    }

    const rows = batch.map((d, j) =>
      // Validated against the contract before it is written: a chunk with a 1,535-dim vector
      // or no locator fails here, at the write, rather than as a mysterious zero-recall later.
      ChunkDoc.parse({
        _id: chunkId(docId, d.ord),
        docId,
        spaceId: input.spaceId,
        userId: input.userId,
        text: d.text,
        locator: d.locator,
        ord: d.ord,
        embedding: vectors[j],
        createdAt: new Date()
      })
    );
    await upsertChunks(rows);

    written += rows.length;
    const progress = todo.length ? (i + batch.length) / todo.length : 1;
    await updateDocumentStatus(docId, {
      status: 'embedding',
      pct: Math.min(85, 35 + Math.round(progress * 50)),
      chunks: written
    });
  }

  const embedMs = Date.now() - embedStart;
  const embedTokens = embedder.tokensUsed - tokensBefore;
  const chunkCount = await countChunks(docId);

  // ------------------------------------------------------------------ probe
  await updateDocumentStatus(docId, { status: 'embedding', pct: 85 });
  const first = await firstChunk(docId, drafts, input, embedder);
  const probeResult = await probe(first, { log });

  // ------------------------------------------------------------------ indexed
  await updateDocumentStatus(docId, {
    status: 'indexed',
    pct: 100,
    chunks: chunkCount,
    ...(pages ? { pages } : {}),
    error: null
  });

  const result: IndexDocumentResult = {
    docId,
    spaceId: input.spaceId,
    ...(pages ? { pages } : {}),
    chunks: chunkCount,
    embedTokens,
    // Embedding a corpus is an ingest cost, not part of any answer's costUsd. It is logged
    // per job so the bill has one place to be read from, and charged to nobody's question.
    embedCostUsd: Number(embeddingCostUsd(embedTokens).toFixed(6)),
    parseMs,
    embedMs,
    probeMs: probeResult.ms,
    probeAttempts: probeResult.attempts
  };
  return result;
}

export const chunkId = (docId: string, ord: number): string => `${docId}:${ord}`;

/**
 * Chunk 0 as it now sits in the collection — the probe needs its stored embedding, and on a
 * resumed job this process never embedded it. Re-embedding one chunk is cheaper than keeping
 * every vector of a 60-page PDF in memory to reach this line.
 */
async function firstChunk(
  docId: string,
  drafts: ChunkDraft[],
  input: IndexDocumentInput,
  embedder: Embedder
): Promise<ChunkDoc> {
  const stored = await (await chunksCollection()).findOne({ docId }, { sort: { ord: 1 } });
  if (stored) return stored;

  const draft = drafts[0];
  if (!draft) throw new Error('no text could be extracted');
  const [vector] = await embedder.embed([draft.text]);
  if (!vector) throw new Error('embedder returned no vector for the probe chunk');
  return ChunkDoc.parse({
    _id: chunkId(docId, draft.ord),
    docId,
    spaceId: input.spaceId,
    userId: input.userId,
    text: draft.text,
    locator: draft.locator,
    ord: draft.ord,
    embedding: vector,
    createdAt: new Date()
  });
}
