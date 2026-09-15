#!/usr/bin/env node
/**
 * Export only the Mongo `runs` written at or after a cutoff. OURS, not provided.
 *
 * The provided scripts/export-runs.mjs dumps the newest 500 runs regardless of when they
 * ran, so after a deployed bench it mixes in every earlier local run, and quality/check.mjs
 * then scores history instead of the deployed run. This writes the same RunLog shape
 * (tokens, wallClockSec, costUsd, terminated, toolCalls) for runs with createdAt >= --since.
 *
 *   node scripts-local/export-since.mjs --since 2026-09-15T11:00:00Z            # → runs/
 *   node scripts-local/export-since.mjs --since 2026-09-15T11:00:00Z --dry-run  # counts only
 *   node scripts-local/export-since.mjs --since ... --out runs                  # out dir
 *
 * Prints the count, the time range, and every run that did not terminate "done", so the
 * A2 check has a name to go with any capped run before quality/check.mjs runs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
config({ path: join(ROOT, '.env') });

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const dryRun = process.argv.includes('--dry-run');

const since = arg('since', null);
if (!since || Number.isNaN(Date.parse(since))) {
  console.error('usage: --since <ISO timestamp> [--out runs] [--dry-run]');
  process.exit(2);
}
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set.');
  process.exit(2);
}
const outDir = resolve(ROOT, arg('out', 'runs'));

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
try {
  await client.connect();
  const coll = client.db(process.env.MONGODB_DB ?? 'lumina').collection('runs');
  const total = await coll.countDocuments({});
  const runs = await coll
    .find({ createdAt: { $gte: new Date(since) } }, { sort: { createdAt: 1 } })
    .toArray();

  console.log(`runs in Mongo: ${total} · at or after ${since}: ${runs.length}`);
  if (!runs.length) process.exit(0);

  const first = runs[0].createdAt;
  const last = runs[runs.length - 1].createdAt;
  console.log(`range: ${new Date(first).toISOString()} → ${new Date(last).toISOString()}`);

  const byTerm = {};
  for (const r of runs) byTerm[r.terminated ?? 'undefined'] = (byTerm[r.terminated ?? 'undefined'] ?? 0) + 1;
  console.log('terminated:', JSON.stringify(byTerm));
  for (const r of runs) {
    if (r.terminated !== 'done') {
      const id = r.requestId ?? String(r._id);
      console.log(
        `  ${r.terminated}  ${id}  user=${r.userId ?? '?'}  depth=${r.depth ?? '?'}  mode=${r.mode ?? '?'}  ${r.wallClockSec ?? '?'}s  $${r.costUsd ?? '?'}  ${(r.toolCalls ?? []).length} calls  "${String(r.query ?? '').slice(0, 70)}"`
      );
    }
  }

  if (process.argv.includes('--list')) {
    console.log('fields:', Object.keys(runs[0]).join(' '));
    for (const r of runs) {
      const id = r.requestId ?? String(r._id);
      const names = (r.toolCalls ?? []).map((t) => t.name);
      console.log(
        `${new Date(r.createdAt).toISOString().slice(11, 19)}  ${id}  ${r.terminated}  depth=${r.depth ?? '?'}  mode=${r.mode ?? '?'}  user=${r.userId ?? '?'}  ${names.length} calls${names.includes('plan_research') ? ' [plan_research]' : ''}  ${r.wallClockSec}s  $${r.costUsd}  ttft=${r.ttftMs ?? r.latency?.ttftMs ?? '?'}  cached=${r.searchCached ?? '?'}  "${String(r.query ?? '').slice(0, 60)}"`
      );
      if (process.argv.includes('--calls')) console.log('      ' + (r.toolCalls ?? []).map((t) => `${t.name}:${t.ms}${t.ok ? '' : '!'}`).join(' '));
    }
    process.exit(0);
  }

  if (dryRun) process.exit(0);

  mkdirSync(outDir, { recursive: true });
  for (const run of runs) {
    const id = run.requestId ?? String(run._id);
    const { tokens, wallClockSec, costUsd, terminated, toolCalls } = run;
    writeFileSync(
      join(outDir, `${id}.json`),
      JSON.stringify({ tokens, wallClockSec, costUsd, terminated, toolCalls }, null, 2)
    );
  }
  console.log(`wrote ${runs.length} run log(s) to ${outDir}`);
} finally {
  await client.close();
}
