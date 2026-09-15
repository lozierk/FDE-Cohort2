import assert from 'node:assert/strict';
import test from 'node:test';
import pino from 'pino';
import { SourceRegistry } from '../src/loop/sources.js';
import { FakeEmbedder } from '../src/providers/fake-embeddings.js';
import { FakeLlm } from '../src/providers/fake-llm.js';
import { FakeSearch } from '../src/providers/fake-search.js';
import { runWithDeadline } from '../src/tools/with-deadline.js';
import type { Tool, ToolContext } from '../src/tools/types.js';

const log = pino({ level: 'silent' });

function harness(signal?: AbortSignal): ToolContext {
  return {
    userId: 'test-user',
    threadId: 'thr_test',
    requestId: 'req_test',
    depth: 0,
    mode: 'web',
    providers: { llm: new FakeLlm(), search: new FakeSearch(), embedder: new FakeEmbedder() },
    sources: new SourceRegistry(),
    searchCacheTtlSeconds: 60,
    markSearch: () => {},
    addEmbeddingTokens: () => {},
    ...(signal ? { signal } : {}),
    log
  };
}

/** Filled in by `hangingTool.run` so the test can assert the signal it was handed got aborted. */
let seenSignal: AbortSignal | undefined;

/** A tool whose `run` never resolves on its own — only the passed-in signal ends it. */
const hangingTool: Tool = {
  name: 'hanging_tool',
  description: 'never resolves',
  input_schema: { type: 'object', properties: {} },
  run(_input, ctx) {
    seenSignal = ctx.signal;
    return new Promise((_resolve, reject) => {
      ctx.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }
};

const quickTool: Tool = {
  name: 'quick_tool',
  description: 'resolves fast',
  input_schema: { type: 'object', properties: {} },
  async run() {
    await new Promise((r) => setTimeout(r, 10));
    return { ok: true, content: 'done quickly' };
  }
};

test('a tool that never resolves times out, aborting the signal passed to it', async () => {
  const ctx = harness();
  const startedAt = Date.now();
  const result = await runWithDeadline(hangingTool, {}, ctx, 50);
  const elapsedMs = Date.now() - startedAt;

  assert.ok(elapsedMs < 200, `resolved in ${elapsedMs} ms, well under the 200 ms slack`);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /timed out/);
  assert.equal(seenSignal?.aborted, true, 'the signal passed to the tool was aborted on timeout');
});

test('a tool that resolves quickly passes through unchanged', async () => {
  const ctx = harness();
  const result = await runWithDeadline(quickTool, {}, ctx, 50);

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.content, 'done quickly');
});
