/**
 * Every published price LUMINA bills against, in one file next to the model id, so a model
 * swap changes one place (DESIGN.md trade-off 4). `costUsd` in the `done` event is measured
 * usage times these rates — never a flat estimate.
 *
 * Rates: Anthropic published USD per million tokens, read from the live pricing page
 * 2026-09-14 (https://platform.claude.com/docs/en/about-claude/pricing). Keyed by model id
 * because the synthesis call can now run on a different model than planning and research
 * (LLM_MODEL_SYNTHESIS in env.ts) — two models sharing one run means one rate table is no
 * longer enough.
 */
export const MODEL_ID = 'claude-haiku-4-5';

export const RATES_USD_PER_MTOK = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-sonnet-5': { input: 2.0, output: 10.0, cacheWrite: 2.5, cacheRead: 0.2 }
} as const;

/** OpenAI text-embedding-3-small. Not model-keyed: LUMINA only ever embeds with one model. */
export const EMBEDDING_RATE_USD_PER_MTOK = 0.02;

export type ModelRates = (typeof RATES_USD_PER_MTOK)[keyof typeof RATES_USD_PER_MTOK];

/** True when `ratesFor` would return this model's own published rates, not the Haiku fallback. */
export function hasRates(model: string): boolean {
  const bare = model.startsWith('fake:') ? model.slice('fake:'.length) : model;
  return bare in RATES_USD_PER_MTOK;
}

/**
 * Exact id match; else the id with a stripped `fake:` prefix (FakeLlm names itself
 * `fake:<model>` so a local run bills at the rate of the model it is standing in for); else
 * the Haiku rates, so a fake run's default model name (`fake-llm`, no colon) or any other
 * unrecognised id still prices as something rather than throwing mid-request — stats.test.ts
 * asserts a fake run costs more than zero.
 */
export function ratesFor(model: string): ModelRates {
  if (model in RATES_USD_PER_MTOK) return RATES_USD_PER_MTOK[model as keyof typeof RATES_USD_PER_MTOK];
  const bare = model.startsWith('fake:') ? model.slice('fake:'.length) : model;
  if (bare in RATES_USD_PER_MTOK) return RATES_USD_PER_MTOK[bare as keyof typeof RATES_USD_PER_MTOK];
  return RATES_USD_PER_MTOK['claude-haiku-4-5'];
}

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

/**
 * Priced at the CALLING model's own rate — the caller passes it per call (see `callLlm` in
 * loop/research.ts), because a run that mixes a research model and a synthesis model has no
 * single rate that is honest for the whole thing.
 */
export function llmCostUsd(u: TokenUsage, model: string): number {
  const rates = ratesFor(model);
  return (
    perMtok(u.input, rates.input) +
    perMtok(u.output, rates.output) +
    perMtok(u.cacheWrite, rates.cacheWrite) +
    perMtok(u.cacheRead, rates.cacheRead)
  );
}

export const embeddingCostUsd = (tokens: number) => perMtok(tokens, EMBEDDING_RATE_USD_PER_MTOK);
