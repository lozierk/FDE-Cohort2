import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunLog, RunDoc, type Depth, type RequestDoc } from '@lumina/contract';
import { env } from './env.js';
import { log } from './log.js';
import { insertRequest, insertRun } from './store/index.js';
import type { QuickLoopResult } from './loop/quick.js';

/**
 * Written after EVERY ask, whatever the outcome — this is what the gates read, and a run log
 * that only appears when things went well measures nothing.
 *
 * Two shapes from one run: `RunLog` for the file (`tokens` is a single total) and `RequestDoc`
 * for the ledger `/stats` reconciles against. Both are validated with the contract's zod
 * before they are written, so a drift fails here rather than in `quality/check.mjs`.
 */
export interface RunLogInput {
  requestId: string;
  userId: string;
  threadId: string;
  query: string;
  route: string;
  status: number;
  depth: Depth;
  /**
   * A deep run's result too: `DeepLoopResult` extends this with `subQuestions`, and the run
   * log has no field for a plan. `depth` is what tells a legitimately expensive deep run
   * apart from a quick run that has quietly run away with the budget.
   */
  result: QuickLoopResult;
}

export function runLogFor(input: RunLogInput): RunLog {
  const { result } = input;
  return RunLog.parse({
    tokens: result.usage.input + result.usage.cacheRead + result.usage.cacheWrite + result.usage.output,
    wallClockSec: Number((result.latencyMs / 1000).toFixed(3)),
    costUsd: Number(result.costUsd.toFixed(6)),
    terminated: result.terminated,
    depth: input.depth,
    toolCalls: result.toolCalls.map((t) => ({
      name: t.name,
      ok: t.ok,
      ms: t.ms,
      ...(t.error ? { error: t.error } : {})
    }))
  });
}

/**
 * Where a run log file goes. Quality rule A2 fails any log under `runs/` not terminated
 * `done`, and `eval/build-report.mjs` promotes that to a red line; rule P1 wants a failing
 * trajectory to read, and `runs/failing/` is where the eval looks for it. So a provider
 * failure lands in `runs/failing/` — still written, still in Mongo, still in `/stats` — and
 * never sits in `runs/` waiting to fail the bench's quality check. A capped run stays in
 * `runs/` on purpose: it answered, and if A2 flags it the budget is wrong, which we want to see.
 */
export function runLogDir(terminated: RunLog['terminated'], runsDir = env.runsDir): string {
  return terminated === 'error' ? join(runsDir, 'failing') : runsDir;
}

/** File first: the gates read `runs/`, and a Mongo that is down must not cost us the evidence. */
export async function writeRunLog(input: RunLogInput): Promise<RunLog> {
  const runLog = runLogFor(input);

  try {
    const dir = runLogDir(runLog.terminated);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${input.requestId}.json`), `${JSON.stringify(runLog, null, 2)}\n`);
  } catch (err) {
    log.error({ err: (err as Error).message, requestId: input.requestId }, 'failed to write the run log file');
  }

  try {
    const doc = RunDoc.parse({
      ...runLog,
      requestId: input.requestId,
      userId: input.userId,
      threadId: input.threadId,
      answerId: input.result.answerId,
      query: input.query,
      createdAt: new Date()
    });
    await insertRun(doc);
  } catch (err) {
    log.error({ err: (err as Error).message, requestId: input.requestId }, 'failed to insert the run doc');
  }

  try {
    const req: RequestDoc = {
      requestId: input.requestId,
      userId: input.userId,
      route: input.route,
      status: input.status,
      ms: input.result.latencyMs,
      tokensIn: input.result.usage.input + input.result.usage.cacheRead + input.result.usage.cacheWrite,
      tokensOut: input.result.usage.output,
      costUsd: Number(input.result.costUsd.toFixed(6)),
      toolCalls: input.result.toolCalls.length,
      terminated: input.result.terminated,
      depth: input.depth,
      createdAt: new Date()
    };
    await insertRequest(req);
  } catch (err) {
    log.error({ err: (err as Error).message, requestId: input.requestId }, 'failed to insert the request row');
  }

  // The one line per answer AGENTS.md asks for. Greppable by requestId across both services.
  log.info(
    {
      requestId: input.requestId,
      userId: input.userId,
      toolCalls: input.result.toolCalls.length,
      terminated: input.result.terminated,
      tokens: { in: runLog.tokens - input.result.usage.output, out: input.result.usage.output },
      costUsd: runLog.costUsd,
      searchCached: input.result.searchCached,
      ttftMs: input.result.ttftMs,
      latencyMs: input.result.latencyMs
    },
    'answer'
  );

  return runLog;
}
