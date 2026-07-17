// Display names for LLM provider ids — mirrors api/src/ai/llm-providers.json `name` fields.
// Prefer `providerLabel` from GET /v1/ai/models when available; this is the offline fallback.
export const LLM_PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  xai: 'xAI (Grok)',
  google: 'Google',
  aws_bedrock: 'AWS Bedrock',
  azure: 'Azure OpenAI',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  mistral: 'Mistral AI',
  ollama: 'Ollama (Local)',
};

export function llmProviderLabel(providerId: string, fromApi?: string): string {
  if (fromApi?.trim()) return fromApi.trim();
  if (LLM_PROVIDER_LABELS[providerId]) return LLM_PROVIDER_LABELS[providerId]!;
  return providerId
    .split('_')
    .map((part) => part.replace(/\b\w/g, (c) => c.toUpperCase()))
    .join(' ')
    .replace(/\bAws\b/g, 'AWS')
    .replace(/\bAi\b/g, 'AI')
    .replace(/\bOpenai\b/g, 'OpenAI');
}
