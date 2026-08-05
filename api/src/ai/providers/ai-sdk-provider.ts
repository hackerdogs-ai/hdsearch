// Unified AI SDK provider factory. Creates LlmProvider implementations from any
// Vercel AI SDK provider adapter. Adding a new LLM backend = one config entry.
import { streamText, tool, jsonSchema } from 'ai';
import type { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { resolveKey } from '../../keystore.js';
import type { LlmModel } from '../models.js';
import type { LlmProvider, TurnArgs, TurnResult, StreamDelta, ToolCall, NeutralMsg } from './types.js';

export interface AiSdkProviderConfig {
  id: string;
  keyField: string;
  /** Extra keystore fields tried after keyField (migration / aliases). */
  altKeyFields?: string[];
  envKeys?: string[];
  createModel: (apiKey: string, modelId: string) => LanguageModel;
  supportsThinking?: boolean;
}

function toAiSdkMessages(messages: NeutralMsg[]): any[] {
  const out: any[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user' as const, content: m.content });
    } else if (m.role === 'assistant') {
      const parts: any[] = [];
      if (m.content) parts.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls || []) {
        parts.push({ type: 'tool-call', toolCallId: tc.id, toolName: tc.name, input: tc.input });
      }
      out.push({ role: 'assistant' as const, content: parts.length ? parts : m.content || '' });
    } else {
      out.push({
        role: 'tool' as const,
        content: [{
          type: 'tool-result',
          toolCallId: m.toolCallId,
          toolName: m.name,
          output: m.isError
            ? { type: 'error-text' as const, value: m.content }
            : { type: 'text' as const, value: m.content },
        }],
      });
    }
  }
  return out;
}

async function resolveApiKey(config: AiSdkProviderConfig, userId?: string): Promise<string | undefined> {
  for (const envKey of config.envKeys || []) {
    const v = process.env[envKey];
    if (v) return v;
  }
  const fields = [config.keyField, ...(config.altKeyFields || [])];
  for (const field of fields) {
    const v = await resolveKey(userId, field);
    if (v) return v;
  }
  return undefined;
}

/** Models that only accept extended thinking (`enabled` + budget_tokens). */
function usesExtendedThinkingOnly(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return /haiku-4-5|sonnet-4-5|opus-4-5|opus-4-1|claude-3/.test(id);
}

/**
 * Anthropic thinking config for the chosen model.
 * - Haiku 4.5 / Sonnet 4.5 / Opus 4.5: extended thinking only (`enabled` + budget).
 * - Opus 4.7+, Fable 5, Sonnet 4.6+: adaptive + effort (legacy `enabled` returns 400).
 */
function anthropicThinkingOptions(
  modelId: string,
  effort: string | undefined,
  maxOutputTokens: number,
): { thinking: { type: 'enabled'; budgetTokens: number } | { type: 'adaptive' }; effort?: string } | undefined {
  if (!effort) return undefined;

  if (usesExtendedThinkingOnly(modelId)) {
    return {
      thinking: { type: 'enabled', budgetTokens: effortToBudget(effort, maxOutputTokens) },
    };
  }

  return {
    thinking: { type: 'adaptive' },
    effort,
  };
}

function streamPartErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return cause.message;
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
    return (error as any).message;
  }
  return String(error || 'stream error');
}

export function createAiSdkProvider(config: AiSdkProviderConfig): LlmProvider {
  return {
    id: config.id,

    async available(_model: LlmModel, userId?: string): Promise<boolean> {
      return !!(await resolveApiKey(config, userId));
    },

    async *streamTurn(args: TurnArgs): AsyncGenerator<StreamDelta, TurnResult, void> {
      const apiKey = await resolveApiKey(config, args.userId);
      if (!apiKey) throw new Error(`no-${config.id}-key`);

      const languageModel = config.createModel(apiKey, args.model.id);

      const tools: Record<string, any> = {};
      for (const t of args.tools) {
        tools[t.name] = tool({
          description: t.description,
          inputSchema: jsonSchema(t.input_schema as any),
        });
      }

      const maxOut = Math.min(args.model.maxOutputTokens, args.maxOutputTokens);
      const anthropicOpts =
        args.effort && config.supportsThinking
          ? anthropicThinkingOptions(args.model.id, args.effort, maxOut)
          : undefined;

      const result = streamText({
        model: languageModel,
        system: args.system,
        messages: toAiSdkMessages(args.messages) as any,
        tools,
        maxOutputTokens: maxOut,
        ...(anthropicOpts ? { providerOptions: { anthropic: anthropicOpts } as any } : {}),
      });

      const toolCalls: ToolCall[] = [];
      let text = '';

      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') {
          const delta = (part as any).text || (part as any).delta || '';
          if (delta) {
            text += delta;
            yield { type: 'text', delta };
          }
        } else if (part.type === 'reasoning-delta') {
          const delta = (part as any).text || (part as any).delta || '';
          if (delta) yield { type: 'thinking', delta };
        } else if (part.type === 'tool-call') {
          toolCalls.push({
            id: (part as any).toolCallId,
            name: (part as any).toolName,
            input: (part as any).input ?? (part as any).args ?? {},
          });
        } else if (part.type === 'error') {
          throw new Error(streamPartErrorMessage((part as any).error));
        }
      }

      let usage: { inputTokens?: number; outputTokens?: number } | undefined;
      let finishReason: string | undefined;
      try {
        usage = await result.usage;
        finishReason = await result.finishReason;
      } catch (e) {
        throw new Error(streamPartErrorMessage(e));
      }

      return {
        text,
        toolCalls,
        stopReason: finishReason === 'tool-calls' ? 'tool_use' : finishReason || 'end_turn',
        usage: {
          inputTokens: usage?.inputTokens || 0,
          outputTokens: usage?.outputTokens || 0,
          cacheReadTokens: 0,
        },
      };
    },
  };
}

function effortToBudget(effort: string, maxOutput: number): number {
  const base = Math.min(maxOutput, 16000);
  switch (effort) {
    case 'low': return Math.round(base * 0.25);
    case 'medium': return Math.round(base * 0.5);
    case 'high': return Math.round(base * 0.75);
    case 'xhigh': return base;
    case 'max': return Math.min(base * 2, 128000);
    default: return Math.round(base * 0.5);
  }
}

// ---- Provider configurations ----

export const anthropicSdkProvider = createAiSdkProvider({
  id: 'anthropic',
  keyField: 'anthropic',
  envKeys: ['HDSEARCH_ANTHROPIC_KEY', 'ANTHROPIC_API_KEY'],
  supportsThinking: true,
  createModel: (apiKey, modelId) => createAnthropic({ apiKey })(modelId),
});

export const openaiSdkProvider = createAiSdkProvider({
  id: 'openai',
  keyField: 'openai',
  envKeys: ['HDSEARCH_OPENAI_KEY', 'OPENAI_API_KEY'],
  createModel: (apiKey, modelId) => createOpenAI({ apiKey })(modelId),
});

export const xaiSdkProvider = createAiSdkProvider({
  id: 'xai',
  keyField: 'xai',
  envKeys: ['HDSEARCH_XAI_KEY', 'XAI_API_KEY'],
  createModel: (apiKey, modelId) => createOpenAI({ apiKey, baseURL: 'https://api.x.ai/v1' })(modelId),
});

export const openrouterSdkProvider = createAiSdkProvider({
  id: 'openrouter',
  keyField: 'openrouter',
  envKeys: ['HDSEARCH_OPENROUTER_KEY', 'OPENROUTER_API_KEY'],
  createModel: (apiKey, modelId) =>
    createOpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' })(modelId),
});

export const azureSdkProvider = createAiSdkProvider({
  id: 'azure',
  keyField: 'azure_openai',
  envKeys: ['HDSEARCH_AZURE_OPENAI_KEY', 'AZURE_OPENAI_API_KEY'],
  createModel: (apiKey, modelId) => {
    const resourceName = process.env.HDSEARCH_AZURE_RESOURCE || process.env.AZURE_RESOURCE_NAME || '';
    return createAzure({ apiKey, resourceName })(modelId);
  },
});

/** AWS Bedrock via a single Bedrock API key (bearer token) — same UX as Anthropic. */
export const bedrockSdkProvider = createAiSdkProvider({
  id: 'aws_bedrock',
  keyField: 'aws_bedrock',
  altKeyFields: ['aws_access_key'], // older UI field name
  envKeys: ['HDSEARCH_BEDROCK_KEY', 'AWS_BEARER_TOKEN_BEDROCK'],
  createModel: (apiKey, modelId) => {
    const region = process.env.HDSEARCH_BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1';
    return createAmazonBedrock({ apiKey, region })(modelId);
  },
});

export const googleSdkProvider = createAiSdkProvider({
  id: 'google',
  keyField: 'google',
  envKeys: ['HDSEARCH_GOOGLE_AI_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
  createModel: (apiKey, modelId) => createGoogleGenerativeAI({ apiKey })(modelId),
});

export const groqSdkProvider = createAiSdkProvider({
  id: 'groq',
  keyField: 'groq',
  envKeys: ['HDSEARCH_GROQ_KEY', 'GROQ_API_KEY'],
  createModel: (apiKey, modelId) =>
    createOpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' })(modelId),
});

export const mistralSdkProvider = createAiSdkProvider({
  id: 'mistral',
  keyField: 'mistral',
  envKeys: ['HDSEARCH_MISTRAL_KEY', 'MISTRAL_API_KEY'],
  createModel: (apiKey, modelId) =>
    createOpenAI({ apiKey, baseURL: 'https://api.mistral.ai/v1' })(modelId),
});
