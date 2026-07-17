// Anthropic provider for AI Mode. Translates the neutral transcript into Anthropic
// content blocks, streams one turn with adaptive thinking + tool use, and returns a
// normalized TurnResult. Key resolution: env (deployment-wide) → per-user encrypted
// key → dev .env. See docs/AI_MODE_SPEC.md §6.
import Anthropic from '@anthropic-ai/sdk';
import { resolveKey } from '../../keystore.js';
import type { LlmModel } from '../models.js';
import type { LlmProvider, TurnArgs, TurnResult, StreamDelta, NeutralMsg, ToolCall } from './types.js';

/** Resolve the Anthropic API key: env → per-user key → plan default → dev .env. */
export async function anthropicKey(userId?: string, planId?: string): Promise<string | undefined> {
  return (
    process.env.HDSEARCH_ANTHROPIC_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    (await resolveKey(userId, 'anthropic', planId)) ||
    undefined
  );
}

/** Build Anthropic `messages` from the neutral transcript. */
function toAnthropic(messages: NeutralMsg[]): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      // Vision: when the turn carries images, send text + image blocks so the model
      // actually sees them (base64). Plain-text turns stay a simple string.
      if (m.images?.length) {
        const blocks: any[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const img of m.images) {
          blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.dataBase64 } });
        }
        out.push({ role: 'user', content: blocks });
      } else {
        out.push({ role: 'user', content: m.content });
      }
    } else if (m.role === 'assistant') {
      // Replay the native content blocks if we have them (preserves thinking +
      // exact tool_use ids); otherwise reconstruct from text + toolCalls.
      if (m.raw) {
        out.push({ role: 'assistant', content: m.raw });
      } else {
        const blocks: any[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls || []) blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
        out.push({ role: 'assistant', content: blocks });
      }
    } else {
      // tool result → a user turn carrying tool_result blocks. Coalesce consecutive
      // tool results into the same user turn (Anthropic expects them grouped).
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content, ...(m.isError ? { is_error: true } : {}) };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    }
  }
  return out;
}

export const anthropicProvider: LlmProvider = {
  id: 'anthropic',

  async available(_model: LlmModel, userId?: string, planId?: string): Promise<boolean> {
    return !!(await anthropicKey(userId, planId));
  },

  async *streamTurn(args: TurnArgs): AsyncGenerator<StreamDelta, TurnResult, void> {
    const key = await anthropicKey(args.userId, args.planId);
    if (!key) throw new Error('no-anthropic-key');
    const client = new Anthropic({ apiKey: key });

    const stream = client.messages.stream({
      model: args.model.id,
      max_tokens: Math.min(args.model.maxOutputTokens, args.maxOutputTokens),
      system: args.system,
      messages: toAnthropic(args.messages),
      tools: args.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
      thinking: { type: 'adaptive' },
      ...(args.effort ? { output_config: { effort: args.effort } } : {}),
    } as any);

    for await (const ev of stream as any) {
      if (ev.type === 'content_block_delta') {
        if (ev.delta?.type === 'text_delta' && ev.delta.text) yield { type: 'text', delta: ev.delta.text };
        else if (ev.delta?.type === 'thinking_delta' && ev.delta.thinking) yield { type: 'thinking', delta: ev.delta.thinking };
      }
    }

    const msg: any = await stream.finalMessage();
    const toolCalls: ToolCall[] = (msg.content || [])
      .filter((b: any) => b.type === 'tool_use')
      .map((b: any) => ({ id: b.id, name: b.name, input: b.input }));
    const text = (msg.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    return {
      text,
      toolCalls,
      stopReason: msg.stop_reason || 'end_turn',
      raw: msg.content,
      usage: {
        inputTokens: msg.usage?.input_tokens || 0,
        outputTokens: msg.usage?.output_tokens || 0,
        cacheReadTokens: msg.usage?.cache_read_input_tokens || 0,
      },
    };
  },
};
