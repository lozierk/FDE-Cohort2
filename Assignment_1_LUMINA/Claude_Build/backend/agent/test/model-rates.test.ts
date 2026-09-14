import assert from 'node:assert/strict';
import test from 'node:test';
import { hasRates, llmCostUsd, ratesFor } from '../src/config/model.js';

/**
 * The rate table went from one flat RATES_USD_PER_MTOK to a per-model table the day
 * LLM_MODEL_SYNTHESIS could name a different model than LLM_MODEL. These pin the lookup
 * rules `ratesFor` promises: exact match, a `fake:`-prefixed id resolves to the model it
 * names, and an unrecognised id still prices as something (Haiku) rather than throwing.
 */

test('ratesFor: exact model id match', () => {
  assert.deepEqual(ratesFor('claude-haiku-4-5'), { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 });
  assert.deepEqual(ratesFor('claude-sonnet-5'), { input: 2.0, output: 10.0, cacheWrite: 2.5, cacheRead: 0.2 });
});

test('ratesFor: a fake: prefix resolves to the rates of the model it names', () => {
  assert.deepEqual(ratesFor('fake:claude-sonnet-5'), ratesFor('claude-sonnet-5'));
  assert.deepEqual(ratesFor('fake:claude-haiku-4-5'), ratesFor('claude-haiku-4-5'));
});

test('ratesFor: an unrecognised model (including the fake default "fake-llm") falls back to Haiku', () => {
  assert.deepEqual(ratesFor('fake-llm'), ratesFor('claude-haiku-4-5'));
  assert.deepEqual(ratesFor('some-future-model'), ratesFor('claude-haiku-4-5'));
  assert.deepEqual(ratesFor('fake:some-future-model'), ratesFor('claude-haiku-4-5'));
});

test('hasRates', () => {
  assert.equal(hasRates('claude-haiku-4-5'), true);
  assert.equal(hasRates('claude-sonnet-5'), true);
  assert.equal(hasRates('fake:claude-sonnet-5'), true);
  assert.equal(hasRates('fake-llm'), false);
  assert.equal(hasRates('claude-opus-5'), false);
});

test('llmCostUsd: 1M input tokens is $1.00 on Haiku and $2.00 on Sonnet', () => {
  const usage = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
  assert.ok(Math.abs(llmCostUsd(usage, 'claude-haiku-4-5') - 1.0) < 1e-9);
  assert.ok(Math.abs(llmCostUsd(usage, 'claude-sonnet-5') - 2.0) < 1e-9);
});
