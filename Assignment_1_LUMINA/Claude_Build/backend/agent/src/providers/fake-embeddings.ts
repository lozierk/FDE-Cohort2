import { createHash } from 'node:crypto';
import { EMBEDDING_DIMS, type Embedder } from './embeddings.js';

/**
 * A deterministic hash-derived unit vector. Not semantic — it cannot be, without a model —
 * but it IS stable, so `save_memory` then `recall_memory` of the same text round-trips and
 * the memory path is exercised end to end with no key.
 */
export class FakeEmbedder implements Embedder {
  readonly model = 'fake-embeddings-1536';
  private used = 0;

  get tokensUsed(): number {
    return this.used;
  }

  async embed(texts: string[]): Promise<number[][]> {
    this.used += texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0);
    return texts.map((t) => unitVector(t));
  }
}

function unitVector(text: string): number[] {
  const out = new Array<number>(EMBEDDING_DIMS);
  // 64 bytes of sha512 per round, expanded to 1536 floats in [-1, 1).
  let seed = text.toLowerCase().trim();
  let filled = 0;
  while (filled < EMBEDDING_DIMS) {
    const digest = createHash('sha512').update(seed).digest();
    for (let i = 0; i < digest.length && filled < EMBEDDING_DIMS; i++) {
      out[filled++] = ((digest[i] ?? 0) - 127.5) / 127.5;
    }
    seed = digest.toString('hex');
  }
  let norm = 0;
  for (const v of out) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return out.map((v) => v / norm);
}
