export interface Embedder {
  readonly model: string;
  /** Tokens billed by the last embed call, so costUsd can include them. */
  readonly tokensUsed: number;
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDING_DIMS = 1536;

/** Cosine similarity over two unit-ish vectors. The `mongo-cosine-scan` backend's whole maths. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
