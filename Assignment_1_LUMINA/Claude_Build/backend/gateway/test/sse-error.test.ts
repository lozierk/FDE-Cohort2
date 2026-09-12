import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startStubAgent } from './helpers/stubAgent.js';
import { startGateway } from './helpers/testServer.js';

test('SSE route forwards a non-2xx upstream status + JSON body untouched (no stream started)', async () => {
  const stub = await startStubAgent({
    askStatus: 429,
    askBody: { error: 'deep search cap reached', status: 429, resetsAt: new Date().toISOString() }
  });
  const gw = await startGateway({ AGENT_URL: stub.url });

  const res = await fetch(`${gw.baseUrl}/threads/thr_test1/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'user-1' },
    body: JSON.stringify({ query: 'hello there', depth: 'deep' })
  });

  assert.equal(res.status, 429);
  assert.doesNotMatch(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const body = (await res.json()) as { error: string };
  assert.equal(body.error, 'deep search cap reached');

  await gw.close();
  await stub.close();
});
