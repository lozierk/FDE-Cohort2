import { AnthropicLlm } from './anthropic.js';
import type { Embedder } from './embeddings.js';
import { FakeEmbedder } from './fake-embeddings.js';
import { FakeLlm } from './fake-llm.js';
import { FakeSearch } from './fake-search.js';
import type { LlmProvider } from './llm.js';
import { OpenAiEmbedder } from './openai-embeddings.js';
import type { SearchProvider } from './search.js';
import { TavilySearch } from './tavily.js';

export interface Providers {
  llm: LlmProvider;
  search: SearchProvider;
  embedder: Embedder;
}

type EnvShape = {
  llmProvider: string;
  llmModel: string;
  searchProvider: string;
  embeddingProvider: string;
  embeddingModel: string;
};
type SecretShape = { anthropic: string; openai: string; tavily: string; serpapi: string };

/**
 * Pick every provider from env, and fail AT BOOT with the name of the missing variable if a
 * real provider was selected without its key. A service that starts fine and only discovers
 * the missing key on a user's first question has turned a config error into an outage.
 */
export function makeProviders(env: EnvShape, secrets: SecretShape): Providers {
  return {
    llm: makeLlm(env, secrets),
    search: makeSearch(env, secrets),
    embedder: makeEmbedder(env, secrets)
  };
}

function needKey(value: string, varName: string, provider: string): string {
  if (!value.trim()) {
    throw new Error(`${varName} is empty but ${provider} is selected — set it in .env or switch the provider to fake`);
  }
  return value;
}

function makeLlm(env: EnvShape, secrets: SecretShape): LlmProvider {
  switch (env.llmProvider) {
    case 'fake':
      // Say so in the name. /health reports whatever this is, and a local run that claims
      // "claude-haiku-4-5" makes every number on the page a quiet lie.
      return new FakeLlm(undefined, `fake:${env.llmModel}`);
    case 'anthropic':
      return new AnthropicLlm(needKey(secrets.anthropic, 'ANTHROPIC_API_KEY', 'anthropic'), env.llmModel);
    default:
      throw new Error(`unknown LLM_PROVIDER "${env.llmProvider}" — expected anthropic or fake`);
  }
}

function makeSearch(env: EnvShape, secrets: SecretShape): SearchProvider {
  switch (env.searchProvider) {
    case 'fake':
      return new FakeSearch();
    case 'tavily':
      return new TavilySearch(needKey(secrets.tavily, 'TAVILY_API_KEY', 'tavily'));
    case 'serpapi':
      // Declared swappable by env; the adapter is Week 2 work. Refuse at boot rather than at
      // the first question, and name what is missing.
      throw new Error('SEARCH_PROVIDER=serpapi is not implemented yet — use tavily or fake');
    default:
      throw new Error(`unknown SEARCH_PROVIDER "${env.searchProvider}" — expected tavily, serpapi or fake`);
  }
}

function makeEmbedder(env: EnvShape, secrets: SecretShape): Embedder {
  switch (env.embeddingProvider) {
    case 'fake':
      return new FakeEmbedder();
    case 'openai':
      return new OpenAiEmbedder(needKey(secrets.openai, 'OPENAI_API_KEY', 'openai embeddings'), env.embeddingModel);
    default:
      throw new Error(`unknown EMBEDDING_PROVIDER "${env.embeddingProvider}" — expected openai or fake`);
  }
}

export { AnthropicLlm, FakeEmbedder, FakeLlm, FakeSearch, OpenAiEmbedder, TavilySearch };
