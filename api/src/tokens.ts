// Token accounting for AI Mode. HD-Search is free and self-hosted — there is no
// billing here. We report the tokens a turn actually consumed, plus the raw
// provider cost (used only to rank models by cost in the selector).
export interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

/** Raw provider cost (USD) for one model call, from list prices. */
export function providerCostUsd(u: TokenUsage, p: ModelPrice): number {
  return (
    (u.inputTokens * p.inputPer1M) / 1e6 +
    (u.outputTokens * p.outputPer1M) / 1e6 +
    ((u.cacheReadTokens || 0) * (p.cachedInputPer1M ?? p.inputPer1M)) / 1e6
  );
}

/** Total tokens billed against the context window for a turn. */
export function totalTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens;
}
