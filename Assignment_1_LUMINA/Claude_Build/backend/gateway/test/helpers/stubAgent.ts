/**
 * A tiny stand-in for the agent service (backend/agent/), which another agent is building
 * concurrently and which these tests must never import. Plain node:http, no framework:
 * answers /health, one JSON route (POST /threads), and streams a scripted SSE sequence
 * for POST /threads/:id/ask.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type StubSseFrame = { event: string; data: unknown };

export type StubAgentOptions = {
  /** Non-2xx status the ask route answers with instead of streaming (e.g. a 429 from the deep cap). */
  askStatus?: number;
  askBody?: unknown;
  /** The SSE frames to stream, in order, one per tick so they arrive as separate chunks. */
  askFrames?: StubSseFrame[];
};

export type StubAgent = {
  url: string;
  close: () => Promise<void>;
};

export function startStubAgent(opts: StubAgentOptions = {}): Promise<StubAgent> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';

    if (req.method === 'GET' && url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          model: 'fake-model',
          searchProvider: 'fake',
          vectorStore: 'mongo-cosine-scan',
          db: 'ok'
        })
      );
      return;
    }

    // Drain the request body (if any) before answering, whatever the route.
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'POST' && url === '/threads') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ threadId: 'thr_stub0000001' }));
        return;
      }

      if (req.method === 'POST' && /^\/threads\/[^/]+\/ask$/.test(url)) {
        if (opts.askStatus && opts.askStatus >= 300) {
          res.writeHead(opts.askStatus, { 'content-type': 'application/json' });
          res.end(JSON.stringify(opts.askBody ?? { error: 'stub ask error', status: opts.askStatus }));
          return;
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive'
        });
        const frames = opts.askFrames ?? [];
        let i = 0;
        const sendNext = () => {
          if (i >= frames.length) {
            res.end();
            return;
          }
          const frame = frames[i++];
          res.write(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
          // A separate macrotask per frame so they arrive as distinct chunks, exercising
          // the gateway's chunk-by-chunk (not buffer-the-whole-response) pass-through.
          setImmediate(sendNext);
        };
        sendNext();
        return;
      }

      // The real agent answers a delete with 204 and no body (routes/memory.ts).
      if (req.method === 'DELETE' && /^\/memory\/[^/]+$/.test(url)) {
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `stub: no route ${req.method} ${url}`, status: 404 }));
    });
  });

  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolvePromise({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res()))
      });
    });
  });
}
