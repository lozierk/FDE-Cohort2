import type { AskMode } from '@lumina/contract';
import type { Logger } from 'pino';
import type { Providers } from '../providers/index.js';
import type { SourceRegistry } from '../loop/sources.js';

export type ToolResult =
  | { ok: true; content: string; sourcesAdded?: number[] }
  | { ok: false; error: string };

export interface ToolContext {
  userId: string;
  threadId: string;
  requestId: string;
  spaceId?: string;
  /** How deep into the loop we are. 0 on a quick run, 1 inside a deep fan-out. */
  depth: number;
  /**
   * Which deep sub-question this tool call is serving, so every source it registers can be
   * traced back to the question that went looking for it.
   *
   * It lives on the CONTEXT, not on the registry: the fan-out runs `DEEP_CONCURRENCY`
   * sub-questions against ONE shared registry at the same time, so a "current sub-question"
   * held anywhere shared would be whichever one happened to start last. Each sub-question
   * gets its own ctx and they share everything else.
   */
  subQuestion?: number;
  mode: AskMode;
  providers: Providers;
  sources: SourceRegistry;
  searchCacheTtlSeconds: number;
  /** Set by web_search: false the moment any search in this request missed both tiers. */
  markSearch(hit: boolean): void;
  /**
   * Embedding tokens THIS request spent, added by whichever tool embedded something.
   *
   * It replaces reading `providers.embedder.tokensUsed` in the cost sum: that counter is
   * cumulative for the life of the process, so the hundredth answer of a session was being
   * billed for the ninety-nine before it. Per-request is the only number that can be checked
   * against a bill.
   */
  addEmbeddingTokens(n: number): void;
  signal?: AbortSignal;
  log: Logger;
}

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
