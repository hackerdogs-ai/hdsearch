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
  return (await resolveKey(userId, config.keyField)) || undefined;
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

      const result = streamText({
        model: languageModel,
        system: args.system,
        messages: toAiSdkMessages(args.messages) as any,
        tools,
        maxOutputTokens: Math.min(args.model.maxOutputTokens, args.maxOutputTokens),
        ...(args.effort && config.supportsThinking
          ? { providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: effortToBudget(args.effort, args.maxOutputTokens) } } } }
          : {}),
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
          const delta = (part as any).delta || '';
          if (delta) yield { type: 'thinking', delta };
        } else if (part.type === 'tool-call') {
          toolCalls.push({
            id: (part as any).toolCallId,
            name: (part as any).toolName,
            input: (part as any).input ?? (part as any).args ?? {},
          });
        }
      }

      const usage = await result.usage;
      const finishReason = await result.finishReason;

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

export const bedrockSdkProvider = createAiSdkProvider({
  id: 'aws_bedrock',
  keyField: 'aws_access_key',
  envKeys: ['AWS_ACCESS_KEY_ID'],
  createModel: (apiKey, modelId) => {
    const secretKey = process.env.AWS_SECRET_ACCESS_KEY || '';
    const region = process.env.AWS_REGION || 'us-east-1';
    return createAmazonBedrock({ accessKeyId: apiKey, secretAccessKey: secretKey, region })(modelId);
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
