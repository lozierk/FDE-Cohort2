import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startStubAgent } from './helpers/stubAgent.js';
import { startGateway } from './helpers/testServer.js';

/**
 * DELETE /memory/:id is the one JSON route whose success has no body. The third full bench
 * (2026-09-14) saved and recalled a preference and then lost all three memory gates because
 * the gateway mirrored the agent's 204 as "agent returned a non-JSON body" 502.
 */
test('DELETE /memory/:id mirrors the agent\'s 204 instead of failing to parse an empty body', async () => {
  const stub = await startStubAgent();
  const gw = await startGateway({ AGENT_URL: stub.url });

  const res = await fetch(`${gw.baseUrl}/memory/mem_0000000001`, {
    method: 'DELETE',
    headers: { 'x-user-id': 'someone' }
  });
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '', 'no body, as the agent sent none');

  await gw.close();
  await stub.close();
});
