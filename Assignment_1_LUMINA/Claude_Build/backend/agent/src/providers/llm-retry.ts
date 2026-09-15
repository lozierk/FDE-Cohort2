/**
 * The bounded, abortable retry loop around one attempt at starting an Anthropic stream.
 * Pulled out of `AnthropicLlm.complete` so it can be unit-tested without the real SDK: the
 * shapes it cares about (`status`, `name`, `headers`) are exactly what `Anthropic.APIError`
 * and `Anthropic.APIConnectionError` carry, so a plain object built the same shape exercises
 * the same logic.
 */

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 529]);

/** Shape enough of the SDK's error classes to decide retryability without importing them. */
export interface RetryableErrorShape {
  status?: number;
  name?: string;
  headers?: Record<string, string | undefined> | Headers;
}

/**
 * `Anthropic.APIError` (a retryable status) or `Anthropic.APIConnectionError` (the request
 * never reached the provider at all — `name` is how the SDK's error classes tell those apart,
 * since a connection error carries no `status`).
 */
export function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as RetryableErrorShape;
  if (typeof e.status === 'number' && RETRYABLE_STATUS.has(e.status)) return true;
  return e.name === 'APIConnectionError';
}

/** `retry-after`: seconds, or an HTTP date. Unparsable or absent is undefined, never a throw. */
export function retryAfterMs(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const headers = (err as RetryableErrorShape).headers;
  if (!headers) return undefined;
  const raw = headers instanceof Headers ? headers.get('retry-after') : headers['retry-after'];
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.max(0, at - Date.now());

  return undefined;
}

/** Aborted by `signal` during a wait: rethrown promptly rather than waited out. */
export class RetryAborted extends Error {}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new RetryAborted('aborted during retry wait'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new RetryAborted('aborted during retry wait'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export interface LlmRetryOptions {
  /** Retries beyond the first attempt. 2 means up to 3 attempts total. */
  maxRetries: number;
  /** Every wait, including one driven by `retry-after`, is capped at this. */
  maxWaitMs: number;
  signal?: AbortSignal;
  /** `{ status, attempt, waitMs }` on every retry. Optional: no logger, no line. */
  onRetry?: (info: { status: number | undefined; attempt: number; waitMs: number }) => void;
}

/**
 * Run `attempt()` up to `1 + opts.maxRetries` times. Retries only on `isRetryable(err)`, and
 * ONLY before `attempt` has produced any output of its own — the caller decides that by not
 * calling this once streaming has started (see `AnthropicLlm.complete`, which retries only
 * around stream CREATION, before the first event is yielded).
 *
 * Backoff: 500 ms, then 1500 ms, unless the error's `retry-after` header says otherwise — either
 * way capped at `opts.maxWaitMs`. The final attempt's error is rethrown unchanged so the loop's
 * existing `terminated: 'error'` path handles it exactly as it always has.
 */
export async function withLlmRetry<T>(attempt: () => Promise<T>, opts: LlmRetryOptions): Promise<T> {
  const backoffs = [500, 1500];
  let lastErr: unknown;
  for (let i = 0; i <= opts.maxRetries; i++) {
    try {
      return await attempt();
    } catch (err) {
      lastErr = err;
      if (i >= opts.maxRetries || !isRetryable(err)) throw err;
      const waitMs = Math.min(retryAfterMs(err) ?? backoffs[Math.min(i, backoffs.length - 1)]!, opts.maxWaitMs);
      opts.onRetry?.({ status: (err as RetryableErrorShape)?.status, attempt: i + 1, waitMs });
      await wait(waitMs, opts.signal);
    }
  }
  // Unreachable: the loop above always either returns or throws.
  throw lastErr;
}
