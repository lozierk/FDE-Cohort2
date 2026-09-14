import assert from 'node:assert/strict';
import test from 'node:test';
import { makeProviders } from '../src/providers/index.js';

/**
 * The three model knobs and their fallbacks, as the factory reads them. The shipped setting
 * is Haiku for planning, research and the quick answer, Sonnet 5 for the deep answer only —
 * so the factory must build exactly one extra provider for that, and none when the knobs
 * all name the same model.
 */
const base = { llmProvider: 'fake', searchProvider: 'fake', embeddingProvider: 'fake', embeddingModel: 'fake' };
const secrets = { anthropic: '', openai: '', tavily: '', serpapi: '' };

test('one model everywhere builds no extra providers', () => {
  const p = makeProviders({ ...base, llmModel: 'claude-haiku-4-5', llmModelSynthesis: 'claude-haiku-4-5', llmModelSynthesisDeep: 'claude-haiku-4-5' }, secrets);
  assert.equal(p.synthesisLlm, undefined);
  assert.equal(p.deepSynthesisLlm, undefined);
});

test('a deep-only synthesis model builds only the deep provider, named after its model', () => {
  const p = makeProviders({ ...base, llmModel: 'claude-haiku-4-5', llmModelSynthesis: 'claude-haiku-4-5', llmModelSynthesisDeep: 'claude-sonnet-5' }, secrets);
  assert.equal(p.synthesisLlm, undefined, 'the quick answer stays on the base model');
  assert.equal(p.deepSynthesisLlm?.model, 'fake:claude-sonnet-5');
});

test('a quick synthesis model that deep inherits builds only the quick provider', () => {
  const p = makeProviders({ ...base, llmModel: 'claude-haiku-4-5', llmModelSynthesis: 'claude-sonnet-5', llmModelSynthesisDeep: 'claude-sonnet-5' }, secrets);
  assert.equal(p.synthesisLlm?.model, 'fake:claude-sonnet-5');
  assert.equal(p.deepSynthesisLlm, undefined, 'deep falls back to the quick synthesis model; no third provider');
});

test('an unpriced real model refuses to boot and names the variable', () => {
  assert.throws(
    () => makeProviders({ ...base, llmProvider: 'anthropic', llmModel: 'claude-haiku-4-5', llmModelSynthesis: 'claude-haiku-4-5', llmModelSynthesisDeep: 'claude-opus-5' }, { ...secrets, anthropic: 'k' }),
    /LLM_MODEL_SYNTHESIS_DEEP "claude-opus-5" has no published rate/
  );
});
