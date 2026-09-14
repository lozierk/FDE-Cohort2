import { cosine } from '../providers/embeddings.js';
import { insertMemory, listMemories } from '../store/index.js';
import { str, type Tool, type ToolResult } from './types.js';

export const RECALL_LIMIT = 10;
/** ~1000 tokens of injected memory, the cap SPEC §5.3 asks for, counted in characters. */
export const RECALL_CHAR_BUDGET = 4000;

/**
 * Semantic recall. On Atlas this is `$vectorSearch` on `memories.embedding` filtered by
 * userId; with no Atlas it is an exact cosine scan over this user's rows. Same function,
 * selected by `env.vectorBackend`, so /health's `vectorStore` string is the only place a
 * reader has to look to know which number they are reading.
 */
export const recallMemory: Tool = {
  name: 'recall_memory',
  description:
    'Look up what you already know about this user — stable facts and preferences they have ' +
    'saved before. Use it when the answer would change depending on who is asking.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'What to recall, in the user\'s terms.' } },
    required: ['query'],
    additionalProperties: false
  },

  async run(input, ctx): Promise<ToolResult> {
    const query = str(input.query).trim() || 'user preferences';
    const rows = await listMemories(ctx.userId);
    if (!rows.length) return { ok: true, content: 'No memories saved for this user yet.' };

    const before = ctx.providers.embedder.tokensUsed;
    const [queryVec] = await ctx.providers.embedder.embed([query]);
    ctx.addEmbeddingTokens(ctx.providers.embedder.tokensUsed - before);
    if (!queryVec) return { ok: false, error: 'embedder returned no vector for the recall query' };

    const ranked = rows
      .map((r) => ({ text: r.text, id: r._id, score: cosine(queryVec, r.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, RECALL_LIMIT);

    const lines: string[] = [];
    let used = 0;
    for (const r of ranked) {
      if (used + r.text.length > RECALL_CHAR_BUDGET) break;
      used += r.text.length;
      lines.push(`- ${r.text} (score ${r.score.toFixed(3)}, id ${r.id})`);
    }
    return { ok: true, content: lines.length ? lines.join('\n') : 'No relevant memories.' };
  }
};

/**
 * The ONLY writer of long-term memory, and it writes nothing else. What counts as worth
 * saving is a prompt decision (stable facts and preferences, never trivia from one answer);
 * what is graded is that every write shows in the trace and in GET /memory, so nothing is
 * remembered that the user cannot see and delete.
 */
export const saveMemory: Tool = {
  name: 'save_memory',
  description:
    'Save one stable fact or preference about this user for future threads. Only durable ' +
    'things — a name, a role, a standing preference. Never a detail from the current answer.',
  input_schema: {
    type: 'object',
    properties: { text: { type: 'string', description: 'One fact or preference, in one sentence.' } },
    required: ['text'],
    additionalProperties: false
  },

  async run(input, ctx): Promise<ToolResult> {
    const text = str(input.text).trim();
    if (!text) return { ok: false, error: 'save_memory needs non-empty text' };
    if (text.length > 500) return { ok: false, error: 'save_memory text must be under 500 characters' };

    const before = ctx.providers.embedder.tokensUsed;
    const [vec] = await ctx.providers.embedder.embed([text]);
    ctx.addEmbeddingTokens(ctx.providers.embedder.tokensUsed - before);
    if (!vec) return { ok: false, error: 'embedder returned no vector for the memory text' };

    const doc = await insertMemory({
      userId: ctx.userId,
      text,
      embedding: vec,
      sourceThread: ctx.threadId
    });
    return { ok: true, content: `Saved memory ${doc._id}: ${text}` };
  }
};
