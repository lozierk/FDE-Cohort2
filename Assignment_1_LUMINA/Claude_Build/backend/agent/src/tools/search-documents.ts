import type { DocumentDoc } from '@lumina/contract';
import { env } from '../env.js';
import { passageTitle } from '../loop/sources.js';
import { searchChunks, type ChunkHit } from '../retrieval/search-chunks.js';
import { getDocument, listDocuments } from '../store/index.js';
import { str, type Tool, type ToolContext, type ToolResult } from './types.js';

/**
 * Search the documents in the request's Space, hybrid, locator-carrying.
 *
 * Three things about this tool are deliberate:
 *
 *  1. It registers every hit with `ctx.sources.add({ kind: 'doc', ... })` in fused order, and
 *     that registry is the ONLY way a chunk gets a citation number. A second path would be a
 *     way to cite a chunk this request never retrieved.
 *  2. The snippet carried into the `sources` event is the whole chunk text — see
 *     `chooseSnippet` in loop/sources.ts. What the model read and what the reader is shown are
 *     the same string.
 *  3. Zero hits is `ok: true` with a sentence saying so. An empty Space and a broken retriever
 *     must not look alike: the failure case here is a thrown provider call, and that stays a
 *     failure. (Rule A1, and the Live Translate precedent in AGENTS.md.)
 */
export const searchDocuments: Tool = {
  name: 'search_documents',
  description:
    'Search the documents the user uploaded to this Space. Returns numbered passages with the ' +
    'page or heading they came from; the number is the [n] you cite.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look for, in the words the documents would use.' }
    },
    required: ['query'],
    additionalProperties: false
  },

  async run(input, ctx): Promise<ToolResult> {
    const query = str(input.query).trim();
    if (!query) return { ok: false, error: 'search_documents needs a non-empty query' };
    if (!ctx.spaceId) {
      return { ok: false, error: 'no Space is attached to this request; ask the user to pick one' };
    }

    const before = ctx.providers.embedder.tokensUsed;
    const [queryVec] = await ctx.providers.embedder.embed([query]);
    ctx.addEmbeddingTokens(ctx.providers.embedder.tokensUsed - before);
    if (!queryVec) return { ok: false, error: 'embedder returned no vector for the document query' };

    const hits = await searchChunks({
      spaceId: ctx.spaceId,
      userId: ctx.userId,
      queryText: query,
      queryVec,
      topK: env.ragTopK,
      log: ctx.log
    });

    const pending = await pendingNotice(ctx.spaceId);

    if (!hits.length) {
      return {
        ok: true,
        content: [`No matching passages in this Space for "${query}".`, pending].filter(Boolean).join('\n'),
        sourcesAdded: []
      };
    }

    const titles = await titleCache(hits);
    const added: number[] = [];
    const lines: string[] = [];

    for (const hit of hits) {
      const { chunk } = hit;
      const title = titles.get(chunk.docId) ?? chunk.docId;
      const n = ctx.sources.add({
        kind: 'doc',
        title,
        docId: chunk.docId,
        locator: chunk.locator,
        ord: chunk.ord,
        text: chunk.text,
        ...(ctx.subQuestion ? { subQuestion: ctx.subQuestion } : {})
      });
      added.push(n);
      const where = passageTitle({ n, kind: 'doc', title, locator: chunk.locator });
      const preview = chunk.text.replace(/\s+/g, ' ').trim().slice(0, 300);
      lines.push(`[${n}] ${where} — ${preview}`);
    }

    ctx.log.debug(
      {
        spaceId: ctx.spaceId,
        query,
        hits: hits.map((h) => ({ id: h.chunk._id, score: Number(h.score.toFixed(5)), ranks: h.ranks }))
      },
      'search_documents fused hits'
    );

    if (pending) lines.push(pending);
    return { ok: true, content: lines.join('\n'), sourcesAdded: added };
  }
};

/** One `documents` read per distinct docId in the result, cached for the life of the call. */
async function titleCache(hits: ChunkHit[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of new Set(hits.map((h) => h.chunk.docId))) {
    const doc: DocumentDoc | null = await getDocument(id);
    if (doc) out.set(id, doc.title);
  }
  return out;
}

/**
 * Say out loud what is not searchable yet. A Space whose second upload is still embedding will
 * honestly answer half the question; silence would make that look like the document not
 * containing the answer, which is the one wrong conclusion a reader must not be led to.
 */
async function pendingNotice(spaceId: string): Promise<string> {
  const rows = await listDocuments(spaceId);
  const waiting = rows.filter((d) => d.status !== 'indexed');
  if (!waiting.length) return '';
  return `Not yet searchable (still indexing): ${waiting.map((d) => `${d.title} (${d.status})`).join(', ')}`;
}

export type { ToolContext };
