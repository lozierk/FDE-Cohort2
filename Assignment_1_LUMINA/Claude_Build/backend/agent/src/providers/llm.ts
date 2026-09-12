/**
 * The LLM behind one interface, so the loop never imports a vendor SDK and a provider swap
 * is one file. Messages use Anthropic's content-block shape on purpose: the loop keeps ONE
 * history array and hands it straight back, instead of translating in both directions.
 */

export interface TextBlock {
  type: 'text';
  text: string;
}
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmRequest {
  system: string;
  messages: LlmMessage[];
  tools?: ToolDefinition[];
  maxTokens: number;
  signal?: AbortSignal;
}

export type LlmEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'usage'; input: number; output: number; cacheRead: number; cacheWrite: number }
  | { type: 'stop'; reason: 'end_turn' | 'tool_use' | 'max_tokens' };

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(req: LlmRequest): AsyncIterable<LlmEvent>;
}
