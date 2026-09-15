/**
 * Import this FIRST in any test that drives a loop end to end. The quick loop now recalls
 * memory as its first step, which reaches the store; with MONGODB_URI empty, db.ts takes its
 * documented in-memory fallback instead of whatever `.env` points at. ESM evaluates imports
 * in order, so this runs before `src/env.ts` reads the environment — as long as it stays first.
 */
process.env.MONGODB_URI = '';
process.env.LOG_LEVEL = 'silent';
