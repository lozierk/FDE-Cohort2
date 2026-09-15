import { config } from 'dotenv';
import { resolve } from 'node:path';
import { MODEL_ID } from './config/model.js';
import {
  CHUNK_CHARS,
  CHUNK_OVERLAP_CHARS,
  DOCS_EXTRA_SEARCHES,
  EMBED_BATCH,
  MAX_UPLOAD_MB,
  RAG_CANDIDATES,
  RAG_RRF_K,
  RAG_TOP_K,
  RAG_VECTOR_NUM_CANDIDATES,
  WORKER_LEASE_SEC,
  WORKER_MAX_ATTEMPTS,
  WORKER_POLL_MS
} from './config/rag.js';

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
  // The answer is the one call worth a pricier model; planning and research stay on
  // `llmModel` (Haiku decides tool calls fine — the plan and the tool loop are not what a
  // reader judges). Defaults to `llmModel` so an unset var is a no-op, not a second model.
  llmModelSynthesis: process.env.LLM_MODEL_SYNTHESIS ?? process.env.LLM_MODEL ?? MODEL_ID,
  /** Deep synthesis only; falls back to the quick synthesis model, then LLM_MODEL. */
  llmModelSynthesisDeep:
    process.env.LLM_MODEL_SYNTHESIS_DEEP ?? process.env.LLM_MODEL_SYNTHESIS ?? process.env.LLM_MODEL ?? MODEL_ID,

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
  /** Sub-questions researched at once. Wall clock is the sum of the parts without this. */
  deepConcurrency: num(process.env.DEEP_CONCURRENCY, 3),
  /** Tool calls ONE sub-question may spend, its preflight included. The shared 24 still binds. */
  deepSubToolCalls: num(process.env.DEEP_SUB_TOOL_CALLS, 4),
  /** Passages synthesis reads per sub-question, so no sub-question is crowded out. */
  deepPassagesPerSub: num(process.env.DEEP_PASSAGES_PER_SUB, 4),
  /** Passages synthesis reads in total. Above this the model stops reading what it was given. */
  deepPassageLimit: num(process.env.DEEP_PASSAGE_LIMIT, 20),

  // The hard caps from AGENTS.md. Raising these to make a gate pass is the failure mode
  // the caps exist to catch. Two gears, two envelopes.
  maxToolCalls: num(process.env.MAX_TOOL_CALLS, 8),
  maxWallClockSec: num(process.env.MAX_WALL_CLOCK_SEC, 90),
  maxToolCallsDeep: num(process.env.MAX_TOOL_CALLS_DEEP, 24),
  maxWallClockSecDeep: num(process.env.MAX_WALL_CLOCK_SEC_DEEP, 240),

  /** Per-call backstop around every `tool.run`. `fetch_page` keeps its own tighter 8 s timeout. */
  toolTimeoutMs: num(process.env.TOOL_TIMEOUT_MS, 20_000),

  /** The Anthropic client's own request timeout; the SDK's 10-minute default is too loose for a live answer. */
  llmRequestTimeoutMs: num(process.env.LLM_REQUEST_TIMEOUT_MS, 120_000),
  /** Our own bounded retry loop replaces the SDK's silent retries (maxRetries: 0 on the client). */
  llmMaxRetries: num(process.env.LLM_MAX_RETRIES, 2),
  /** Cap on any single retry wait, including one driven by a provider `retry-after` header. */
  llmRetryMaxWaitMs: num(process.env.LLM_RETRY_MAX_WAIT_MS, 2_000),

  /**
   * `child`: index.ts forks the jobs worker at boot (DESIGN.md trade-off 3, one deploy).
   * `none`: it does not — what tests use, and what a two-process deploy uses alongside
   * `npm run worker`. Parsing a 60-page PDF on the thread streaming an answer is the failure
   * the bench's search-p95-during-ingest ratio exists to catch, so the default is a process.
   */
  worker: (process.env.WORKER ?? 'child') as 'child' | 'none',
  workerPollMs: num(process.env.WORKER_POLL_MS, WORKER_POLL_MS),
  /** A `running` job whose `claimedAt` is older than this is swept back to `pending`. */
  workerLeaseSec: num(process.env.WORKER_LEASE_SEC, WORKER_LEASE_SEC),
  /** After this many claims the job is `failed` and its document `failed` with the last error. */
  workerMaxAttempts: num(process.env.WORKER_MAX_ATTEMPTS, WORKER_MAX_ATTEMPTS),

  // Ingest and retrieval. Declared in config/rag.ts; these are the deploy-time overrides.
  maxUploadMb: num(process.env.MAX_UPLOAD_MB, MAX_UPLOAD_MB),
  chunkChars: num(process.env.CHUNK_CHARS, CHUNK_CHARS),
  chunkOverlapChars: num(process.env.CHUNK_OVERLAP_CHARS, CHUNK_OVERLAP_CHARS),
  docsExtraSearches: num(process.env.DOCS_EXTRA_SEARCHES, DOCS_EXTRA_SEARCHES),
  embedBatch: num(process.env.EMBED_BATCH, EMBED_BATCH),
  ragTopK: num(process.env.RAG_TOP_K, RAG_TOP_K),
  ragCandidates: num(process.env.RAG_CANDIDATES, RAG_CANDIDATES),
  ragVectorNumCandidates: num(process.env.RAG_VECTOR_NUM_CANDIDATES, RAG_VECTOR_NUM_CANDIDATES),
  ragRrfK: num(process.env.RAG_RRF_K, RAG_RRF_K),

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
