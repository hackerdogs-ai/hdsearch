// Provider registry. Maps a model's `provider` field to its LlmProvider impl.
// AI SDK providers use the unified factory; Ollama keeps its custom impl for
// dynamic model discovery and text-based tool-call parsing.
import type { LlmProvider } from './types.js';
import {
  anthropicSdkProvider,
  openaiSdkProvider,
  xaiSdkProvider,
  openrouterSdkProvider,
  azureSdkProvider,
  bedrockSdkProvider,
  googleSdkProvider,
  groqSdkProvider,
  mistralSdkProvider,
  createAiSdkProvider,
} from './ai-sdk-provider.js';
import { createOpenAI } from '@ai-sdk/openai';
import { loadCustomProviders } from '../model-registry-db.js';
import { ollamaProvider } from './ollama.js';
import { log, errFields } from '../../logger.js';

const PROVIDERS = new Map<string, LlmProvider>([
  [anthropicSdkProvider.id, anthropicSdkProvider],
  [openaiSdkProvider.id, openaiSdkProvider],
  [xaiSdkProvider.id, xaiSdkProvider],
  [openrouterSdkProvider.id, openrouterSdkProvider],
  [azureSdkProvider.id, azureSdkProvider],
  [bedrockSdkProvider.id, bedrockSdkProvider],
  [googleSdkProvider.id, googleSdkProvider],
  [groqSdkProvider.id, groqSdkProvider],
  [mistralSdkProvider.id, mistralSdkProvider],
  [ollamaProvider.id, ollamaProvider],
]);

/** Built-ins are immutable; admin-added providers are re-registered on refresh. */
const BUILT_IN_IDS = new Set(PROVIDERS.keys());

export function getProvider(id: string): LlmProvider | undefined {
  return PROVIDERS.get(id);
}

export function allProviderIds(): string[] {
  return [...PROVIDERS.keys()];
}

/**
 * Register admin-defined providers (llm_providers, source='admin') as
 * OpenAI-compatible adapters. Called at boot and after any admin write, so a
 * newly added provider is usable without a restart.
 */
export async function refreshCustomProviders(): Promise<number> {
  try {
    const custom = await loadCustomProviders();
    for (const id of [...PROVIDERS.keys()]) {
      if (!BUILT_IN_IDS.has(id)) PROVIDERS.delete(id);
    }
    for (const p of custom) {
      if (BUILT_IN_IDS.has(p.id)) continue; // never shadow a built-in
      PROVIDERS.set(
        p.id,
        createAiSdkProvider({
          id: p.id,
          keyField: p.keyField || p.id,
          createModel: (apiKey, modelId) => createOpenAI({ apiKey, baseURL: p.baseUrl })(modelId),
        }),
      );
    }
    return custom.length;
  } catch (e) {
    log.warn('refreshCustomProviders failed (custom providers unavailable)', errFields(e));
    return 0;
  }
}

export type { LlmProvider, NeutralMsg, ToolSpec, ToolCall, TurnResult, StreamDelta, TurnArgs } from './types.js';
