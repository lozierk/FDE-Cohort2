import Anthropic from '@anthropic-ai/sdk';
import type { LlmEvent, LlmProvider, LlmRequest } from './llm.js';

/**
 * Anthropic direct, manual tool-use loop. We do NOT use the SDK tool runner: the loop needs a
 * `trace` event per step with its own timing and it needs to enforce caps between steps, and a
 * runner that owns the loop owns both of those.
 *
 * `cache_control: {type:'ephemeral'}` goes on the last system block and the last tool
 * definition, which is the whole stable prefix (tools render before system before messages).
 * Across a multi-step loop that prefix is resent on every call, so the cache is most of the
 * saving — see `usage.cache_read_input_tokens` in the `done` event's costUsd.
 */
export class AnthropicLlm implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async *complete(req: LlmRequest): AsyncIterable<LlmEvent> {
    const tools = req.tools?.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      ...(i === req.tools!.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {})
    }));

    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: req.maxTokens,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: req.messages as unknown as Anthropic.MessageParam[],
        ...(tools?.length ? { tools } : {}),
        ...(req.toolChoice ? { tool_choice: { type: 'tool' as const, name: req.toolChoice.name } } : {})
      },
      { signal: req.signal }
    );

    // Tool inputs arrive as a stream of JSON fragments; accumulate per block index and
    // JSON.parse at the end. Never string-match the serialized input.
    const partial = new Map<number, { id: string; name: string; json: string }>();
    let stop: LlmEvent | null = null;
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

    for await (const ev of stream) {
      if (ev.type === 'message_start') {
        const u = ev.message.usage;
        usage.input += u.input_tokens ?? 0;
        usage.output += u.output_tokens ?? 0;
        usage.cacheRead += u.cache_read_input_tokens ?? 0;
        usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
      } else if (ev.type === 'content_block_start') {
        if (ev.content_block.type === 'tool_use') {
          partial.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, json: '' });
        }
      } else if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') {
          yield { type: 'text', text: ev.delta.text };
        } else if (ev.delta.type === 'input_json_delta') {
          const p = partial.get(ev.index);
          if (p) p.json += ev.delta.partial_json;
        }
      } else if (ev.type === 'content_block_stop') {
        const p = partial.get(ev.index);
        if (p) {
          partial.delete(ev.index);
          let input: Record<string, unknown> = {};
          if (p.json.trim()) {
            // A malformed tool input is a real failure, not something to paper over: let it
            // throw so the run ends with terminated:"error" rather than a plausible answer.
            input = JSON.parse(p.json) as Record<string, unknown>;
          }
          yield { type: 'tool_use', id: p.id, name: p.name, input };
        }
      } else if (ev.type === 'message_delta') {
        // message_delta.usage.output_tokens is the cumulative count for the message, not an
        // increment, so it replaces the provisional figure from message_start.
        usage.output = ev.usage.output_tokens ?? usage.output;
        const reason = ev.delta.stop_reason;
        if (reason === 'tool_use' || reason === 'max_tokens') stop = { type: 'stop', reason };
        else stop = { type: 'stop', reason: 'end_turn' };
      } else if (ev.type === 'message_stop') {
        yield { type: 'usage', ...usage };
        yield stop ?? { type: 'stop', reason: 'end_turn' };
      }
    }
  }
}
