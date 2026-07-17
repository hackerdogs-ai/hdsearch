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
} from './ai-sdk-provider.js';
import { ollamaProvider } from './ollama.js';

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

export function getProvider(id: string): LlmProvider | undefined {
  return PROVIDERS.get(id);
}

export function allProviderIds(): string[] {
  return [...PROVIDERS.keys()];
}

export type { LlmProvider, NeutralMsg, ToolSpec, ToolCall, TurnResult, StreamDelta, TurnArgs } from './types.js';
