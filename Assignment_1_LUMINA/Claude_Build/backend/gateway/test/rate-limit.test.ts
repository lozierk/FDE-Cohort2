import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startStubAgent } from './helpers/stubAgent.js';
import { startGateway } from './helpers/testServer.js';

// One stub + one gateway for the whole file: env.ts is a module-level singleton, read
// once on the first dynamic import, so AGENT_URL can only be set once per test *file*
// (each file is its own node:test child process, which is what gives the isolation).

test('429 after the per-user rate limit, with resetsAt', async () => {
  const stub = await startStubAgent();
  const gw = await startGateway({ AGENT_URL: stub.url, RATE_LIMIT_PER_MINUTE: '2' });

  const call = (user: string) =>
    fetch(`${gw.baseUrl}/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': user },
      body: JSON.stringify({})
    });

  const first = await call('user-rl');
  const second = await call('user-rl');
  const third = await call('user-rl');

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 429);
  const body = (await third.json()) as { error: string; resetsAt: string };
  assert.ok(body.resetsAt);
  assert.ok(!Number.isNaN(Date.parse(body.resetsAt)));

  // The limit is per-user: a different X-User-Id still has its own fresh window.
  const otherUser = await call('user-rl-other');
  assert.equal(otherUser.status, 200);

  await gw.close();
  await stub.close();
});
