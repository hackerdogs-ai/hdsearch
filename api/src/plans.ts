// Plan catalog + quota enforcement (spec: Plans / Pricing). Quotas are checked
// against the monthly usage counter. Vector search is gated to DevTest+.
import { PLAN_LABEL } from './planCatalog.js';

export type PlanId = 'free' | 'dev' | 'devtest' | 'production' | 'enterprise';

export interface Plan {
  id: PlanId;
  label: string;
  /** USD per month; null = custom/contact sales */
  priceMonthly: number | null;
  /** combined monthly searches + crawls; null = custom */
  quota: number | null;
  /** does the plan include vector search/index? */
  vector: boolean;
  features: string[];
  /** Stripe price id env var name (resolved at runtime) */
  stripePriceEnv?: string;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    label: 'Free',
    priceMonthly: 0,
    quota: 100,
    vector: false,
    features: ['100 searches + crawls / month', 'All free & self-hosted engines', 'No vector search'],
  },
  dev: {
    id: 'dev',
    label: 'Dev',
    priceMonthly: 20,
    quota: 1000,
    vector: false,
    stripePriceEnv: 'STRIPE_PRICE_DEV',
    features: ['1,000 searches + crawls / month', 'All engines', 'No vector search'],
  },
  devtest: {
    id: 'devtest',
    label: 'DevTest',
    priceMonthly: 200,
    quota: 15000,
    vector: true,
    stripePriceEnv: 'STRIPE_PRICE_DEVTEST',
    features: ['15,000 searches + crawls / month', 'Includes vector search & indexing', 'All engines'],
  },
  production: {
    id: 'production',
    label: 'Production',
    priceMonthly: 250,
    quota: 30000,
    vector: true,
    stripePriceEnv: 'STRIPE_PRICE_PRODUCTION',
    features: ['30,000 searches + crawls / month', 'Includes vector search & indexing', 'Priority support'],
  },
  enterprise: {
    id: 'enterprise',
    label: 'Enterprise',
    priceMonthly: null,
    quota: null,
    vector: true,
    features: ['Custom volume', 'SSO / dedicated support', 'On-prem / self-hosted options', 'Contact sales'],
  },
};

export function planOf(id: string | undefined): Plan {
  const plan = PLANS[(id as PlanId) in PLANS ? (id as PlanId) : 'free'];
  return { ...plan, label: PLAN_LABEL[plan.id] ?? plan.label };
}

export interface QuotaCheck {
  allowed: boolean;
  reason?: string;
  used: number;
  quota: number | null;
  plan: PlanId;
}

/**
 * Enforce monthly quota + the vector entitlement.
 *
 * Self-hosted / open-source mode: quotas and the vector entitlement are
 * disabled — every request is allowed and no feature is gated behind a plan.
 * (Left as a single chokepoint so it can be reintroduced later as an *optional*
 * local rate-limit, off by default, rather than SaaS billing enforcement.)
 */
export async function checkQuota(
  userId: string,
  planId: string | undefined,
  kind: 'search' | 'crawl' | 'vector',
): Promise<QuotaCheck> {
  const plan = planOf(planId);
  // Open-source: unlimited, unconditionally — no quota, no vector entitlement gate.
  void userId;
  void kind;
  return { allowed: true, used: 0, quota: null, plan: plan.id };
}
