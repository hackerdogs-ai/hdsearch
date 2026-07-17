// Plan-B2 entitlement mapping: hd-search has NO plans of its own — it folds into the
// central hackerdogs-core plans. This maps a core plan SKU to hd-search's internal PlanId,
// so every existing quota/feature check (plans.ts, checkQuota) keeps working unchanged.
// Gate on SKU (stable), never display name. See docs/AUTH_PLAN_INTEGRATION.md §4.2.
import type { PlanId } from './plans.js';

// core SKU → hd-search tier (verified against the live core /gpdtplansui catalog)
const SKU_TO_PLAN: Record<string, PlanId> = {
  'chihuahua-free': 'free', // Public 360 (Chihuahua) → hd-search 'free'
  'bulldog-starter': 'dev', // OSINT 360 (Bulldog) → 'dev'
  'german-shepherd-premium': 'devtest', // Threat 360 (German Shepherd) → 'devtest'
  'doberman-enterprise': 'production', // Intel 360 (Doberman) → 'production'
  'alpha-pack': 'enterprise', // Hackerdogs Alpha Pack → 'enterprise'
  'alpha-customer': 'enterprise', // tolerant alias
};

/**
 * Resolve the hd-search PlanId for a core plan SKU. Unknown/missing SKU → 'free' (safe
 * default). Matching is case-insensitive and tolerant of a missing tier suffix
 * (e.g. "doberman" → doberman-enterprise) so minor SKU drift still resolves.
 */
export function skuToPlanId(sku?: string | null): PlanId {
  if (!sku) return 'free';
  const s = sku.trim().toLowerCase();
  if (SKU_TO_PLAN[s]) return SKU_TO_PLAN[s];
  // tolerant prefix match on the dog/tier name
  for (const [k, v] of Object.entries(SKU_TO_PLAN)) {
    const base = k.split('-')[0]!; // chihuahua, bulldog, german, doberman, alpha
    if (s === base || s.startsWith(base + '-') || s.startsWith(base)) return v;
  }
  return 'free';
}

/** The mapping, for surfacing in docs/UI. */
export const PLAN_MAP = SKU_TO_PLAN;
