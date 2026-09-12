/**
 * Produce a REAL failing trajectory for rule P1, without hand-writing one.
 *
 *   npx tsx bin/make-failing-run.mts
 *
 * It drives the actual quick loop with a provider scripted to throw on its second call, and
 * writes the run log the loop produced into `runs/failing/`. The subfolder matters: rule A2
 * grades every run in `runs/` and fails one that did not terminate as `done`, while P1 wants
 * a failing trajectory kept and read. `quality/check.mjs` reads `runs/*.json` only, so both
 * hold at once.
 *
 * Nothing here is edited afterwards. If the loop stops producing this shape, this script
 * stops producing this file, which is the point.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pino from 'pino';
import { runQuickLoop } from '../src/loop/quick.js';
import { runLogFor } from '../src/runlog.js';
import { FakeEmbedder } from '../src/providers/fake-embeddings.js';
import { FakeLlm } from '../src/providers/fake-llm.js';
import { FakeSearch } from '../src/providers/fake-search.js';

const OUT = resolve(process.cwd(), '../../runs/failing');
const requestId = `req_failing_${Date.now().toString(36)}`;

const result = await runQuickLoop({
  query: 'What is Tavily?',
  mode: 'web',
  userId: 'dev',
  threadId: 'thr_failing_demo',
  requestId,
  history: [],
  providers: {
    llm: new FakeLlm([
      { tool: 'web_search', input: { query: 'What is Tavily?' } },
      { throws: 'anthropic: 529 overloaded_error' }
    ]),
    search: new FakeSearch(),
    embedder: new FakeEmbedder()
  },
  caps: { maxToolCalls: 8, maxWallClockSec: 90 },
  searchCacheTtlSeconds: 21600,
  emit: () => {},
  log: pino({ level: 'silent' })
});

const runLog = runLogFor({
  requestId,
  userId: 'dev',
  threadId: 'thr_failing_demo',
  query: 'What is Tavily?',
  route: '/threads/:threadId/ask',
  status: 502,
  depth: 'quick',
  result
});

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${requestId}.json`), `${JSON.stringify(runLog, null, 2)}\n`);
console.log(`wrote ${join(OUT, `${requestId}.json`)}: terminated=${runLog.terminated}, error=${result.error}`);
