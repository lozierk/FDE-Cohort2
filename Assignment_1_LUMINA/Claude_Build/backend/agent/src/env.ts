import { config } from 'dotenv';
import { resolve } from 'node:path';
import { MODEL_ID } from './config/model.js';

// The single .env at the assignment root. Provider keys are read HERE and nowhere else.
config({ path: resolve(process.cwd(), '../../.env') });
config({ path: resolve(process.cwd(), '.env') });

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
export const env = {
  port: num(process.env.PORT_AGENT ?? process.env.PORT, 8000),
  mongoUri: process.env.MONGODB_URI ?? '',
  mongoDb: process.env.MONGODB_DB ?? 'lumina',
  vectorBackend: (process.env.VECTOR_BACKEND ?? 'atlas-vector-search') as
    | 'atlas-vector-search'
    | 'mongo-cosine-scan',

  // DESIGN.md v1.0: Anthropic direct, Claude Haiku 4.5. MODEL_ID in src/config/model.ts is
  // the same string; this env var is how a deploy overrides it without a code change.
  llmProvider: (process.env.LLM_PROVIDER ?? 'anthropic') as 'anthropic' | 'fake',
  llmModel: process.env.LLM_MODEL ?? MODEL_ID,

  searchProvider: (process.env.SEARCH_PROVIDER ?? 'tavily') as 'tavily' | 'serpapi' | 'fake',
  // Embeddings are OpenAI even when the LLM is Anthropic (D-9). The only inherited value is
  // `fake`, so a keyless local run (LLM_PROVIDER=fake) needs no second switch.
  embeddingProvider: (process.env.EMBEDDING_PROVIDER ??
    (process.env.LLM_PROVIDER === 'fake' ? 'fake' : 'openai')) as 'openai' | 'fake',
  searchCacheTtlSeconds: num(process.env.SEARCH_CACHE_TTL_SECONDS, 21600),

  embeddingModel: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',

  // Deep search is the expensive gear, so its limits are configuration, not code.
  deepSubQuestionsMin: num(process.env.DEEP_SUB_QUESTIONS_MIN, 3),
  deepSubQuestionsMax: num(process.env.DEEP_SUB_QUESTIONS_MAX, 6),
  deepDailyCap: num(process.env.DEEP_DAILY_CAP, 5),

  // The hard caps from AGENTS.md. Raising these to make a gate pass is the failure mode
  // the caps exist to catch. Two gears, two envelopes.
  maxToolCalls: num(process.env.MAX_TOOL_CALLS, 8),
  maxWallClockSec: num(process.env.MAX_WALL_CLOCK_SEC, 90),
  maxToolCallsDeep: num(process.env.MAX_TOOL_CALLS_DEEP, 24),
  maxWallClockSecDeep: num(process.env.MAX_WALL_CLOCK_SEC_DEEP, 240),

  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  /**
   * Where the per-answer run logs land. `quality/check.mjs .` reads `<repo>/runs`, which is
   * what the default resolves to when the service runs from `backend/agent`. RUNS_DIR exists
   * so tests can write somewhere else and not pollute the graded folder.
   */
  runsDir: process.env.RUNS_DIR ? resolve(process.env.RUNS_DIR) : resolve(process.cwd(), '../../runs')
} as const;

/** Never log or return these. /health names the model; it never echoes a key. */
export const secrets = {
  anthropic: process.env.ANTHROPIC_API_KEY ?? '',
  openai: process.env.OPENAI_API_KEY ?? '',
  tavily: process.env.TAVILY_API_KEY ?? '',
  serpapi: process.env.SERPAPI_API_KEY ?? ''
} as const;
