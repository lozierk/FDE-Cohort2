import type { Response } from 'express';

/**
 * Copied verbatim from `backend/gateway/src/sse.ts` (the spec says copy, not import: the two
 * services must not share code across the process boundary).
 *
 * Express buffers Server-Sent Events by default, and so do most proxies. Get these four
 * headers and the flush right or your tokens all arrive at once at the end, which reads as
 * "the model is slow" and fails the TTFT SLA for a reason no profiler will show you.
 *
 * Also: do NOT put `compression()` in front of the ask route.
 */
export function sseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // nginx / Fly's proxy will otherwise hold the stream until it has a bufferful.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

/** Write one SSE frame and flush it. The blank line terminates the frame; without it the client waits. */
export function sseSend(res: Response, event: string, data: unknown): void {
  // A deep search fans out; a sub-question can still finish after the run has already
  // ended the stream with an `error` frame. Writing then raises on the response, so drop it.
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  // @ts-expect-error `flush` exists when a compression middleware is present; harmless otherwise.
  if (typeof res.flush === 'function') res.flush();
}

/**
 * Headers go out on the FIRST frame, not when the handler starts. That is what keeps the
 * spec's two error paths distinguishable: a provider that throws before anything was emitted
 * still gets a `502` JSON `ErrorBody`; one that throws mid-stream gets an `error` frame.
 */
export class SseStream {
  private opened = false;

  constructor(private readonly res: Response) {}

  get headersOut(): boolean {
    return this.opened;
  }

  send(event: string, data: unknown): void {
    if (!this.opened) {
      sseHeaders(this.res);
      this.opened = true;
    }
    sseSend(this.res, event, data);
  }

  end(): void {
    this.res.end();
  }
}
