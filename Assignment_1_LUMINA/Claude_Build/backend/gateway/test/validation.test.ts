import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startStubAgent } from './helpers/stubAgent.js';
import { startGateway } from './helpers/testServer.js';

test('400 on a bad body carries the zod message', async () => {
  const stub = await startStubAgent();
  const gw = await startGateway({ AGENT_URL: stub.url });

  // AskBody's `query` carries a custom zod message ('query is required') for the empty
  // string case; sending an empty query is the clearest way to exercise the contract's
  // own message rather than TypeScript's generic "Required" for a missing key.
  const res = await fetch(`${gw.baseUrl}/threads/thr_test1/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'user-1' },
    body: JSON.stringify({ query: '' })
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; status: number };
  assert.equal(body.error, 'query is required');
  assert.equal(body.status, 400);

  await gw.close();
  await stub.close();
});

test('400 on a CreateSpaceBody missing name', async () => {
  const stub = await startStubAgent();
  const gw = await startGateway({ AGENT_URL: stub.url });

  const res = await fetch(`${gw.baseUrl}/spaces`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': 'user-1' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.ok(body.error.length > 0);

  await gw.close();
  await stub.close();
});
