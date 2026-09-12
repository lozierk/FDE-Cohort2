import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startStubAgent, type StubSseFrame } from './helpers/stubAgent.js';
import { startGateway } from './helpers/testServer.js';

const frames: StubSseFrame[] = [
  { event: 'trace', data: { step: 1, tool: 'web_search', input: {}, ok: true, ms: 12 } },
  {
    event: 'sources',
    data: [{ n: 1, kind: 'web', title: 'Example', snippet: 'a passage', url: 'https://example.com' }]
  },
  { event: 'token', data: { text: 'Hello' } },
  { event: 'token', data: { text: ' world [1]' } },
  {
    event: 'done',
    data: {
      answerId: 'ans_test1',
      latencyMs: 100,
      ttftMs: 40,
      model: 'fake-model',
      tokens: { in: 10, out: 5 },
      costUsd: 0.001,
      searchCached: false,
      terminated: 'done',
      depth: 'quick'
    }
  }
];

function parseFrames(raw: string): Array<{ event: string; data: unknown }> {
  return raw
    .split('\n\n')
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const eventLine = block.split('\n').find((l) => l.startsWith('event: ')) ?? '';
      const dataLine = block.split('\n').find((l) => l.startsWith('data: ')) ?? '';
      return {
        event: eventLine.replace('event: ', '').trim(),
        data: JSON.parse(dataLine.replace('data: ', ''))
      };
    });
}

test('SSE pass-through preserves frame order: trace, sources, token, token, done', async () => {
  const stub = await startStubAgent({ askFrames: frames });
  const gw = await startGateway({ AGENT_URL: stub.url });

  const res = await fetch(`${gw.baseUrl}/threads/thr_test1/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'user-1' },
    body: JSON.stringify({ query: 'hello there' })
  });

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.equal(res.headers.get('cache-control'), 'no-cache, no-transform');

  // Read the stream chunk by chunk (as the gateway forwards it) rather than waiting for
  // the whole body, so an accidental buffer-until-close bug would still fail here.
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let chunkCount = 0;
  let raw = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunkCount += 1;
    raw += decoder.decode(value, { stream: true });
  }

  const received = parseFrames(raw);
  assert.deepEqual(
    received.map((f) => f.event),
    ['trace', 'sources', 'token', 'token', 'done']
  );
  // sources arrives before the first token, and the content is untouched by the gateway.
  assert.deepEqual(received[1]?.data, frames[1]?.data);
  assert.deepEqual(received[4]?.data, frames[4]?.data);
  // The stub sent each frame on its own tick; the gateway must not have coalesced them
  // into one write reaching us as a single chunk.
  assert.ok(chunkCount >= 2, `expected more than one chunk, got ${chunkCount}`);

  await gw.close();
  await stub.close();
});
