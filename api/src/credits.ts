// Self-contained credit meter for HD-Search AI Mode. NO dependency on hackerdogs-core.
// Mirrors hackerdogs-core cost_analysis.py: 1 USD = 100 credits (1 credit = $0.01),
// 80% default margin, price = providerCost / (1 - margin), credits = ceil(price * rate).
// See docs/AI_MODE_SPEC.md §9.

export const USD_TO_CREDIT_RATE = Number(process.env.HDSEARCH_USD_TO_CREDIT_RATE) || 100;
export const DEFAULT_MARGIN = clampMargin(Number(process.env.HDSEARCH_AI_MARGIN));

function clampMargin(m: number): number {
  // default 0.80; keep strictly < 1 so the gross-up never divides by zero
  if (!Number.isFinite(m) || m < 0 || m >= 1) return 0.8;
  return m;
}

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

/** Raw provider cost (USD) for one model call. */
export function providerCostUsd(u: TokenUsage, p: ModelPrice): number {
  return (
    (u.inputTokens * p.inputPer1M) / 1e6 +
    (u.outputTokens * p.outputPer1M) / 1e6 +
    ((u.cacheReadTokens || 0) * (p.cachedInputPer1M ?? p.inputPer1M)) / 1e6
  );
}

/** Whole credits charged for a given USD provider cost, grossed up for margin. */
export function creditsFor(costUsd: number, margin = DEFAULT_MARGIN, rate = USD_TO_CREDIT_RATE): number {
  const priceUsd = costUsd / (1 - margin);
  // round to 6 dp before ceil so float artifacts like 165.00000000001 (from
  // 1-0.8 = 0.19999…) don't round a clean 165 up to 166.
  const raw = Math.ceil(Number((priceUsd * rate).toFixed(6)));
  // a billable run always costs at least 1 credit (no free LLM calls)
  return Math.max(costUsd > 0 ? 1 : 0, raw);
}

/** USD the user is charged for N credits (for display / reconciliation). */
export const usdCharged = (credits: number, rate = USD_TO_CREDIT_RATE) => credits / rate;

/** Minimum credits for any completed AI chat turn (incl. self-hosted / Ollama). */
export const AI_MIN_CREDITS_PER_TURN = 1;

/** Convenience: end-to-end credits for a usage+price pair. */
export function meter(u: TokenUsage, p: ModelPrice, margin = DEFAULT_MARGIN, minCredits = AI_MIN_CREDITS_PER_TURN) {
  const cost = providerCostUsd(u, p);
  const credits = Math.max(minCredits, creditsFor(cost, margin));
  return { providerCostUsd: cost, credits, usd: usdCharged(credits) };
}
