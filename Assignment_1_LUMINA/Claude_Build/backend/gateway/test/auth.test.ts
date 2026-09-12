import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startStubAgent } from './helpers/stubAgent.js';
import { startGateway } from './helpers/testServer.js';

test('401 without X-User-Id on a route that requires it', async () => {
  const stub = await startStubAgent();
  const gw = await startGateway({ AGENT_URL: stub.url });

  const res = await fetch(`${gw.baseUrl}/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: string; status: number; requestId: string };
  assert.match(body.error, /x-user-id/i);
  assert.equal(body.status, 401);
  assert.ok(body.requestId);

  await gw.close();
  await stub.close();
});

test('/health never requires X-User-Id', async () => {
  const stub = await startStubAgent();
  const gw = await startGateway({ AGENT_URL: stub.url });

  const res = await fetch(`${gw.baseUrl}/health`);
  assert.notEqual(res.status, 401);

  await gw.close();
  await stub.close();
});
