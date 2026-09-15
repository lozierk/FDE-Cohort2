#!/usr/bin/env node
/**
 * Move error runs out of runs/ into runs/failing/. OURS, not provided.
 *
 * The provided scripts/export-runs.mjs dumps every Mongo run into runs/, but quality rule A2
 * fails any run in runs/ that did not terminate as "done". Locally the agent already writes
 * error runs to runs/failing/ (src/runlog.ts); this restores that split after an export.
 * Capped runs stay in runs/ on purpose: they answered, and if A2 flags them the budget is wrong.
 *
 *   node scripts-local/sort-failing.mjs            # from Claude_Build/
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runsDir = join(ROOT, 'runs');
const failingDir = join(runsDir, 'failing');

if (!existsSync(runsDir)) {
  console.error('runs/ does not exist — nothing to sort');
  process.exit(0);
}
mkdirSync(failingDir, { recursive: true });

let moved = 0;
let kept = 0;
for (const f of readdirSync(runsDir).filter((n) => n.endsWith('.json'))) {
  const path = join(runsDir, f);
  let terminated;
  try {
    terminated = JSON.parse(readFileSync(path, 'utf8')).terminated;
  } catch (err) {
    console.error(`skip ${f}: ${err.message}`);
    continue;
  }
  if (terminated === 'error') {
    renameSync(path, join(failingDir, f));
    moved++;
  } else {
    kept++;
  }
}
console.log(`kept ${kept} in runs/, moved ${moved} error run(s) to runs/failing/`);
