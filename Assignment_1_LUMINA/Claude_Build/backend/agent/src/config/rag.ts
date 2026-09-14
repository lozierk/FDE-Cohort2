/**
 * Every declared retrieval and chunking constant, in one file next to the model rates
 * (SPEC §5.4: "top-k and thresholds declared in config, not hard-coded"). `env.ts` reads an
 * override for each of these with the same name in upper snake case, so a deploy can retune
 * retrieval without a code change — and a reader can see the whole retrieval envelope here
 * rather than hunting for a magic number inside an aggregation pipeline.
 *
 * These are DEFAULTS, not caps: nothing here is a spend gate, so overriding one is tuning,
 * not loosening. The spend gates live in env.ts and stay where they are.
 */

/** Target chunk length in characters. ~250 tokens of English prose. */
export const CHUNK_CHARS = 1000;

/** Overlap between consecutive chunks INSIDE one unit (a PDF page, a Markdown section). */
export const CHUNK_OVERLAP_CHARS = 150;

/** Texts per embedding call. OpenAI takes many; batching is what keeps a 60-page PDF cheap. */
export const EMBED_BATCH = 64;

/** Chunks `search_documents` returns and registers as sources. The bench's recall@5 window. */
export const RAG_TOP_K = 5;

/** Results taken from EACH ranker before fusion. RRF needs depth to have anything to fuse. */
export const RAG_CANDIDATES = 20;

/** `$vectorSearch.numCandidates`: how many approximate neighbours HNSW visits. */
export const RAG_VECTOR_NUM_CANDIDATES = 100;

/**
 * The RRF constant. 60 is the value from Cormack, Clarke and Buettcher (2009) — it damps the
 * difference between rank 1 and rank 2 so one ranker's confident wrong answer cannot win alone.
 */
export const RAG_RRF_K = 60;

/**
 * Document searches the MODEL may add on top of the preflight in one quick request. Measured
 * 2026-09-14 on the 39-question gold set: every hit came from the preflight's own results, and
 * each extra search the model asked for cost a ~2 s Haiku turn against a 2.5 s TTFT budget.
 * Enforced in the loop, not asked for in the prompt.
 */
export const DOCS_EXTRA_SEARCHES = 1;

/** Upper bound on the cosine-scan fallback's working set, and the size it warns above. */
export const COSINE_SCAN_MAX_CHUNKS = 5000;
export const COSINE_SCAN_WARN_CHUNKS = 2000;

/** The worker's polling and lease envelope. DESIGN.md: "polled every two seconds". */
export const WORKER_POLL_MS = 2000;
export const WORKER_LEASE_SEC = 120;
export const WORKER_MAX_ATTEMPTS = 3;
/** How often a running job refreshes `claimedAt` so a slow 60-page PDF is not swept mid-job. */
export const WORKER_HEARTBEAT_MS = 30_000;

/** multer's `limits.fileSize`. The contract's MAX_UPLOAD_BYTES is the same 25 MB. */
export const MAX_UPLOAD_MB = 25;

/**
 * The read-your-write probe's backoff, in seconds. Atlas Search is eventually consistent, so
 * "upserted" is not "searchable"; these six waits are ~63 s of patience before the document
 * is failed loudly rather than marked `indexed` on a write nobody can find.
 */
export const PROBE_BACKOFF_SEC = [1, 2, 4, 8, 16, 32] as const;
