import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { HealthResponse } from '@lumina/contract';
import { closeDb, vectorBackend } from '../src/db.js';
import { FakeEmbedder } from '../src/providers/fake-embeddings.js';
import { FakeLlm } from '../src/providers/fake-llm.js';
import { FakeSearch } from '../src/providers/fake-search.js';
import { healthRoutes } from '../src/routes/health.js';

type Providers = Parameters<typeof healthRoutes>[0];

/**
 * The rubric reads three names off /health — model, search provider, vector backend — and a
 * deployment whose env is missing one would still answer 200 with a lie unless the route
 * takes them from the live providers. These tests pin that, with and without a database.
 */
const providers = { llm: new FakeLlm(undefined, 'claude-test-model'), search: new FakeSearch(), embedder: new FakeEmbedder() };

let server: ReturnType<ReturnType<typeof express>['listen']>;
let base = '';
let ping: 'ok' | 'down' = 'ok';

before(async () => {
  const app = express();
  app.use(healthRoutes(providers as unknown as Providers, { pingDb: async () => ping, vectorBackend }));
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  await closeDb();
});

test('/health names the live model, search provider and vector backend, and parses against the contract', async () => {
  ping = 'ok';
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = HealthResponse.parse(await res.json());
  assert.equal(body.status, 'ok');
  assert.equal(body.model, 'claude-test-model', 'the model is the one serving answers, not an env default');
  assert.equal(body.searchProvider, 'fake', 'the search provider is the one that is live');
  assert.equal(body.vectorStore, vectorBackend(), 'the vector backend is the one recall was measured on');
  assert.equal(body.db, 'ok');
  assert.equal(body.ai?.status, 'ok');
});

test('/health with the database down is 503 degraded and still names all three', async () => {
  ping = 'down';
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 503, 'a dead dependency is not hidden behind a 200');
  const body = HealthResponse.parse(await res.json());
  assert.equal(body.status, 'degraded');
  assert.equal(body.db, 'down');
  assert.equal(body.model, 'claude-test-model', 'degraded still says what it is running');
  assert.equal(body.searchProvider, 'fake');
  assert.equal(body.vectorStore, vectorBackend());
});

test('/health needs no X-User-Id', async () => {
  ping = 'ok';
  const res = await fetch(`${base}/health`, { headers: {} });
  assert.equal(res.status, 200);
});

// ---------------------------------------------------------------- LLM_MODEL_SYNTHESIS

test('/health names both models when synthesisLlm differs, and still parses against the contract', async () => {
  ping = 'ok';
  (providers as unknown as { synthesisLlm?: unknown }).synthesisLlm = new FakeLlm(undefined, 'claude-test-synthesis');
  try {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = HealthResponse.parse(await res.json());
    assert.equal(body.model, 'claude-test-model; synthesis: claude-test-synthesis');
  } finally {
    delete (providers as unknown as { synthesisLlm?: unknown }).synthesisLlm;
  }
});

test('/health names the plain model when synthesisLlm is the same model', async () => {
  ping = 'ok';
  (providers as unknown as { synthesisLlm?: unknown }).synthesisLlm = new FakeLlm(undefined, 'claude-test-model');
  try {
    const res = await fetch(`${base}/health`);
    const body = HealthResponse.parse(await res.json());
    assert.equal(body.model, 'claude-test-model');
  } finally {
    delete (providers as unknown as { synthesisLlm?: unknown }).synthesisLlm;
  }
});

test('/health names the deep synthesis model too when it differs from the quick one', async () => {
  ping = 'ok';
  const p = providers as unknown as { synthesisLlm?: unknown; deepSynthesisLlm?: unknown };
  p.deepSynthesisLlm = new FakeLlm(undefined, 'claude-test-deep');
  try {
    // Deep only: the quick answer is still on the base model, so it is not named twice.
    let body = HealthResponse.parse(await (await fetch(`${base}/health`)).json());
    assert.equal(body.model, 'claude-test-model; deep synthesis: claude-test-deep');
    // All three differ: every model that can write an answer is on the wire.
    p.synthesisLlm = new FakeLlm(undefined, 'claude-test-synthesis');
    body = HealthResponse.parse(await (await fetch(`${base}/health`)).json());
    assert.equal(body.model, 'claude-test-model; synthesis: claude-test-synthesis; deep synthesis: claude-test-deep');
  } finally {
    delete p.synthesisLlm;
    delete p.deepSynthesisLlm;
  }
});

test('/health names the plain model when there is no synthesisLlm', async () => {
  ping = 'ok';
  const res = await fetch(`${base}/health`);
  const body = HealthResponse.parse(await res.json());
  assert.equal(body.model, 'claude-test-model');
});
