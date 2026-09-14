/**
 * Every published price LUMINA bills against, in one file next to the model id, so a model
 * swap changes one place (DESIGN.md trade-off 4). `costUsd` in the `done` event is measured
 * usage times these rates — never a flat estimate.
 *
 * Rates: Anthropic Claude Haiku 4.5, published USD per million tokens.
 */
export const MODEL_ID = 'claude-haiku-4-5';

export const RATES_USD_PER_MTOK = {
  input: 1.0,
  output: 5.0,
  cacheWrite: 1.25,
  cacheRead: 0.1,
  /** OpenAI text-embedding-3-small. */
  embedding: 0.02
} as const;

/** Per uncached provider search call (benchmark/sla.json cost_model.search_usd_per_call). */
export const SEARCH_USD_PER_CALL = 0.008;

/**
 * max_tokens per call shape. Tool decisions are short; synthesis is the answer.
 *
 * `plan` is a forced tool call holding at most six question/reason pairs. `deepSynthesis` is
 * larger than `synthesis` because a deep answer is a section per sub-question plus what is
 * still unknown, and a structured answer truncated at the fourth of six headings is worse
 * than the quick answer it cost seven times as much to beat.
 */
export const MAX_TOKENS = { toolDecision: 1024, synthesis: 4096, plan: 1024, deepSynthesis: 6144 } as const;

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const emptyUsage = (): TokenUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

const perMtok = (tokens: number, rate: number) => (tokens / 1_000_000) * rate;

export function llmCostUsd(u: TokenUsage): number {
  return (
    perMtok(u.input, RATES_USD_PER_MTOK.input) +
    perMtok(u.output, RATES_USD_PER_MTOK.output) +
    perMtok(u.cacheWrite, RATES_USD_PER_MTOK.cacheWrite) +
    perMtok(u.cacheRead, RATES_USD_PER_MTOK.cacheRead)
  );
}

export const embeddingCostUsd = (tokens: number) => perMtok(tokens, RATES_USD_PER_MTOK.embedding);
