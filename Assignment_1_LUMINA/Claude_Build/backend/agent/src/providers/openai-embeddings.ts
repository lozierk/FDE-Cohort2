import OpenAI from 'openai';
import { EMBEDDING_DIMS, type Embedder } from './embeddings.js';

/** text-embedding-3-small, 1536 dims — the dimension the contract's MemoryDoc/ChunkDoc declare. */
export class OpenAiEmbedder implements Embedder {
  private readonly client: OpenAI;
  private used = 0;

  constructor(
    apiKey: string,
    readonly model: string
  ) {
    this.client = new OpenAI({ apiKey });
  }

  get tokensUsed(): number {
    return this.used;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const res = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: EMBEDDING_DIMS
    });
    this.used += res.usage?.total_tokens ?? 0;
    return res.data.map((d) => d.embedding);
  }
}
