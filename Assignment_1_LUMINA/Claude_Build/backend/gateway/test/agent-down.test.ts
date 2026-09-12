import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startStubAgent } from './helpers/stubAgent.js';
import { startGateway } from './helpers/testServer.js';

test('502 on a JSON route when the agent is unreachable', async () => {
  const stub = await startStubAgent();
  const deadUrl = stub.url;
  await stub.close(); // nothing is listening at deadUrl anymore

  const gw = await startGateway({ AGENT_URL: deadUrl });

  const res = await fetch(`${gw.baseUrl}/threads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'user-1' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string; status: number };
  assert.match(body.error, /agent unreachable/i);
  assert.equal(body.status, 502);

  await gw.close();
});

test('502 on POST /threads/:id/ask when the agent is unreachable', async () => {
  const stub = await startStubAgent();
  const deadUrl = stub.url;
  await stub.close();

  const gw = await startGateway({ AGENT_URL: deadUrl });

  const res = await fetch(`${gw.baseUrl}/threads/thr_test1/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'user-1' },
    body: JSON.stringify({ query: 'hello' })
  });
  assert.equal(res.status, 502);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /agent unreachable/i);

  await gw.close();
});
