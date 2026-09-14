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
  /** How deep into the loop we are. Reserved for Week 2's deep fan-out. */
  depth: number;
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
