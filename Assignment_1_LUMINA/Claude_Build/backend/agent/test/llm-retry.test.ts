import assert from 'node:assert/strict';
import test from 'node:test';
import { isRetryable, RetryAborted, withLlmRetry } from '../src/providers/llm-retry.js';

function fakeError(status: number, retryAfter?: string): Error & { status: number; headers: Record<string, string> } {
  const err = new Error(`fake ${status}`) as Error & { status: number; headers: Record<string, string> };
  err.status = status;
  err.headers = retryAfter ? { 'retry-after': retryAfter } : {};
  return err;
}

test('isRetryable: retryable statuses and APIConnectionError, plain objects shaped like the SDK errors', () => {
  for (const status of [408, 409, 429, 500, 502, 503, 529]) {
    assert.equal(isRetryable({ status }), true, `status ${status} should be retryable`);
  }
  assert.equal(isRetryable({ status: 400 }), false, '400 is not retryable');
  assert.equal(isRetryable({ status: 401 }), false, '401 is not retryable');
  assert.equal(isRetryable({ name: 'APIConnectionError' }), true, 'a connection error carries no status');
  assert.equal(isRetryable({ name: 'SomeOtherError' }), false);
  assert.equal(isRetryable(null), false);
  assert.equal(isRetryable('not an object'), false);
});

test('(a) one retryable failure then success: succeeds, and the wait was capped at maxWaitMs', async () => {
  let calls = 0;
  const retries: { status: number | undefined; attempt: number; waitMs: number }[] = [];
  const startedAt = Date.now();

  const result = await withLlmRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw fakeError(529, '30'); // retry-after: 30s, must be capped down to 10ms
      return 'ok';
    },
    { maxRetries: 2, maxWaitMs: 10, onRetry: (info) => retries.push(info) }
  );

  const elapsedMs = Date.now() - startedAt;
  assert.equal(result, 'ok');
  assert.equal(calls, 2, 'first attempt failed, second succeeded');
  assert.equal(retries.length, 1);
  assert.equal(retries[0]!.status, 529);
  assert.equal(retries[0]!.attempt, 1);
  assert.equal(retries[0]!.waitMs, 10, 'the 30s retry-after was capped at maxWaitMs');
  assert.ok(elapsedMs < 200, `capped wait kept this fast: ${elapsedMs} ms`);
});

test('(b) three retryable failures in a row: rethrows the last error, no more than maxRetries retries', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      withLlmRetry(
        async () => {
          calls += 1;
          throw fakeError(500);
        },
        { maxRetries: 2, maxWaitMs: 10 }
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as Error).message, 'fake 500');
      return true;
    }
  );
  assert.equal(calls, 3, 'the initial attempt plus two retries, then it gives up');
});

test('(c) an aborted signal during the wait rethrows promptly, without waiting out the full backoff', async () => {
  const controller = new AbortController();
  let calls = 0;
  const startedAt = Date.now();

  const promise = withLlmRetry(
    async () => {
      calls += 1;
      throw fakeError(529);
    },
    { maxRetries: 3, maxWaitMs: 5000, signal: controller.signal }
  );

  setTimeout(() => controller.abort(), 20);

  await assert.rejects(() => promise, RetryAborted);
  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 500, `aborted promptly instead of waiting the full backoff: ${elapsedMs} ms`);
  assert.equal(calls, 1, 'aborted during the first wait, before a second attempt was made');
});
