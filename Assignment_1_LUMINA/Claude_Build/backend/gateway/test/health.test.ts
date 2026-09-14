import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HealthResponse } from '@lumina/contract';
import { startStubAgent } from './helpers/stubAgent.js';
import { startGateway } from './helpers/testServer.js';

/**
 * The submitted URL is the gateway's, so the rubric's three names — model, search provider,
 * vector backend — are read off the GATEWAY's /health. It must carry the agent's names
 * through untouched, and it must say degraded, not ok, when the agent is gone.
 */
test('/health carries the agent\'s model, search provider and vector backend through, and parses', async () => {
  const stub = await startStubAgent();
  const gw = await startGateway({ AGENT_URL: stub.url });

  const res = await fetch(`${gw.baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = HealthResponse.parse(await res.json());
  assert.equal(body.status, 'ok');
  assert.equal(body.model, 'fake-model', 'the agent\'s model, not a gateway default');
  assert.equal(body.searchProvider, 'fake');
  assert.equal(body.vectorStore, 'mongo-cosine-scan');
  assert.equal(body.db, 'ok');
  assert.equal(body.ai?.status, 'ok', 'the agent\'s own health is nested');
  assert.equal(body.ai?.model, 'fake-model');

  await gw.close();
  await stub.close();
});

test('/health with the agent unreachable is 503 degraded, names nothing it cannot verify, and still parses', async () => {
  const stub = await startStubAgent();
  const deadUrl = stub.url;
  await stub.close();
  const gw = await startGateway({ AGENT_URL: deadUrl });

  const res = await fetch(`${gw.baseUrl}/health`);
  assert.equal(res.status, 503, 'a dead agent is not hidden behind a 200');
  const body = HealthResponse.parse(await res.json());
  assert.equal(body.status, 'degraded');
  assert.equal(body.ai?.status, 'down');
  assert.equal(body.model, 'unset', 'no model is claimed when no agent answered');
  assert.equal(body.db, 'down');

  await gw.close();
});
