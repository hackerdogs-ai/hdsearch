// Auto-select optimizer for AI Mode (spec §7, Appendix B). A constrained weighted-sum
// scalarization over {cost, latency, failure}: filter by hard constraints (capability,
// budget, key availability, enabled), then minimize the normalized weighted score.
// Returns a RANKED list — [0] is the pick, the rest is the fallback chain.
import type { LlmModel } from './models.js';
import { providerCostUsd, type TokenUsage } from '../tokens.js';

/** Set to true to re-enable OR optimizer auto-selection (cost/latency/failure). */
export const AUTO_SELECT_ENABLED = false;

export interface SelectWeights {
  cost: number;
  latency: number;
  fail: number;
}
export const DEFAULT_WEIGHTS: SelectWeights = { cost: 0.4, latency: 0.3, fail: 0.3 };

export interface ModelStats {
  // EWMA telemetry; cold start falls back to neutral defaults.
  latencyMs?: number; // est time-to-first-token + generation for this run
  failRate?: number; // 0..1 recent error/timeout/refusal rate
}

export interface SelectContext {
  promptTokens: number; // size of prompt+history+tool schemas
  estOutputTokens: number; // per-modality prior
  needs: { tools?: boolean; vision?: boolean };
  budgetUsd?: number; // optional cost cap for model selection (USD)
  hasKey: (model: LlmModel) => boolean; // user has a key (or model is self-hosted)
  statsFor: (id: string) => ModelStats; // telemetry lookup
  weights?: SelectWeights;
}

export interface Ranked {
  model: LlmModel;
  cost: number;
  latencyMs: number;
  failRate: number;
  score: number;
}

function eligible(model: LlmModel, ctx: SelectContext, cost: number): boolean {
  if (!model.enabled) return false;
  if (ctx.needs.tools && !model.capabilities.tools) return false;
  if (ctx.needs.vision && !model.capabilities.vision) return false;
  if (model.contextTokens < ctx.promptTokens) return false;
  if (model.requiresKeys.length > 0 && !ctx.hasKey(model)) return false;
  if (ctx.budgetUsd != null && cost > ctx.budgetUsd) return false;
  return true;
}

function normFn(xs: number[]): (x: number) => number {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const d = hi - lo || 1; // avoid /0 when all equal → everyone maps to 0
  return (x: number) => (x - lo) / d;
}

/** Rank candidates best-first. Throws-free: returns [] when nothing is eligible. */
export function selectModels(models: LlmModel[], ctx: SelectContext): Ranked[] {
  const w = normalizeWeights(ctx.weights || DEFAULT_WEIGHTS);
  const usage: TokenUsage = { inputTokens: ctx.promptTokens, outputTokens: ctx.estOutputTokens };

  const cands = models
    .map((model) => {
      const cost = providerCostUsd(usage, model);
      const st = ctx.statsFor(model.id);
      return { model, cost, latencyMs: st.latencyMs ?? estLatency(model, ctx), failRate: st.failRate ?? 0 };
    })
    .filter((c) => eligible(c.model, ctx, c.cost));

  if (cands.length === 0) return [];
  if (cands.length === 1) return [{ ...cands[0]!, score: 0 }];

  const nc = normFn(cands.map((c) => c.cost));
  const nt = normFn(cands.map((c) => c.latencyMs));
  const nf = normFn(cands.map((c) => c.failRate));

  return cands
    .map((c) => ({ ...c, score: w.cost * nc(c.cost) + w.latency * nt(c.latencyMs) + w.fail * nf(c.failRate) }))
    .sort((a, b) => a.score - b.score || a.model.defaultRank - b.model.defaultRank);
}

/** Manual mode: user-ranked order, first eligible first, then the rest as fallback. */
export function rankExplicit(models: LlmModel[], order: string[], ctx: SelectContext): LlmModel[] {
  const usage: TokenUsage = { inputTokens: ctx.promptTokens, outputTokens: ctx.estOutputTokens };
  const idx = new Map(order.map((id, i) => [id, i]));
  return models
    .filter((mdl) => eligible(mdl, ctx, providerCostUsd(usage, mdl)))
    .sort((a, b) => (idx.get(a.id) ?? 999) - (idx.get(b.id) ?? 999) || a.defaultRank - b.defaultRank);
}

function normalizeWeights(w: SelectWeights): SelectWeights {
  const s = w.cost + w.latency + w.fail || 1;
  return { cost: w.cost / s, latency: w.latency / s, fail: w.fail / s };
}

// Cold-start latency prior: scale generation time by output size + a per-tier base.
function estLatency(model: LlmModel, ctx: SelectContext): number {
  const base = model.label.includes('Haiku') ? 600 : model.label.includes('Sonnet') ? 900 : 1400;
  return base + ctx.estOutputTokens * 4; // ~4ms/token rough prior
}
