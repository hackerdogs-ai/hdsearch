// Upgrade-plan cards: hd-search display metadata merged with live g_pdt_plans pricing
// from hackerdogs-core (/gpdtplansui). Gate on SKU, show DB price + credits.
import type { PlanId } from './plans.js';
import type { CorePlanRow } from './coreClient.js';

export interface PlanCard {
  id: PlanId;
  sku: string;
  label: string;
  price: string;
  cadence?: string;
  quota: string;
  vector: boolean;
  features: string[];
  cta: string;
  highlight?: boolean;
  /** Raw monthly USD from core (null = custom / contact sales) */
  priceMonthly: number | null;
  /** Monthly credits from core (null = custom) */
  credits: number | null;
  /** Core g_pdt_plans.id (UUID) — sent to checkout endpoint */
  corePlanId: string | null;
  /** Core g_pdt_plans.name — sent to checkout endpoint */
  corePlanName: string | null;
}

/** hd-search tier metadata. Labels are the hd-search product names; core DB names
 *  (Public 360, OSINT 360, etc.) are carried in corePlanName for checkout. */
const PLAN_META: Omit<PlanCard, 'price' | 'cadence' | 'quota' | 'priceMonthly' | 'credits' | 'corePlanId' | 'corePlanName'>[] = [
  {
    id: 'free',
    sku: 'chihuahua-free',
    label: 'Free',
    vector: false,
    features: ['All free & self-hosted engines', 'Faceted search', '3-day data retention'],
    cta: 'Start free',
  },
  {
    id: 'dev',
    sku: 'bulldog-starter',
    label: 'Dev',
    vector: false,
    features: ['All engines', 'Use your own provider keys', '30-day data retention'],
    cta: 'Choose Dev',
  },
  {
    id: 'devtest',
    sku: 'german-shepherd-premium',
    label: 'DevTest',
    vector: true,
    features: ['Everything in Dev', 'Vector search & indexing', 'Priority queueing'],
    cta: 'Choose DevTest',
    highlight: true,
  },
  {
    id: 'production',
    sku: 'doberman-enterprise',
    label: 'Production',
    vector: true,
    features: ['Everything in DevTest', 'Higher rate limits', 'Priority support'],
    cta: 'Choose Production',
  },
  {
    id: 'enterprise',
    sku: 'alpha-pack',
    label: 'Enterprise',
    vector: true,
    features: ['Dedicated instance', 'Customer support & training', 'Custom SLAs', '365-day data retention'],
    cta: 'Contact sales',
  },
];

/** Seed values from g_pdt_plans — used when core is unreachable. */
const FALLBACK_BY_SKU: Record<string, { corePlanId: string; corePlanName: string; price: number; credits: number }> = {
  'chihuahua-free': { corePlanId: '01K0Q0AHMY6QY5V6TD84BE79NN', corePlanName: 'Public 360 (Chihuahua)', price: 0, credits: 50 },
  'bulldog-starter': { corePlanId: '01K0Q0AHN42Z6A6GDKYMF2SR0A', corePlanName: 'OSINT 360 (Bulldog)', price: 30, credits: 3150 },
  'german-shepherd-premium': { corePlanId: '01K0Q0AHN6VVCT9XH2HRFY000X', corePlanName: 'Threat 360 (German Shepherd)', price: 100, credits: 10000 },
  'doberman-enterprise': { corePlanId: '01K0Q0AHN9S2TTBPHHDZ59FZSP', corePlanName: 'Intel 360 (Doberman)', price: 500, credits: 55000 },
  'alpha-pack': { corePlanId: '01KF1T0B0SZ5F4RVQHXM7MPPQV', corePlanName: 'Hackerdogs Alpha Pack', price: 10000, credits: 1100000 },
};

export function formatUsd(price: number): string {
  if (price === 0) return '$0';
  const hasCents = Math.round(price * 100) % 100 !== 0;
  return `$${price.toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  })}`;
}

export function formatCredits(credits: number): string {
  return `${credits.toLocaleString('en-US')} credits / mo`;
}

function pricingFromCore(meta: (typeof PLAN_META)[number], core?: CorePlanRow): Pick<PlanCard, 'price' | 'cadence' | 'quota' | 'priceMonthly' | 'credits' | 'corePlanId' | 'corePlanName'> {
  const fallback = FALLBACK_BY_SKU[meta.sku];
  const corePlanId = core?.id || fallback?.corePlanId || null;
  const corePlanName = core?.name || fallback?.corePlanName || null;
  if (meta.id === 'enterprise') {
    return { price: 'Contact us', quota: 'Custom volume', priceMonthly: null, credits: null, corePlanId, corePlanName };
  }
  const priceMonthly = Number(core?.price ?? fallback?.price);
  const credits = Number(core?.credits ?? fallback?.credits);
  if (!Number.isFinite(priceMonthly) || !Number.isFinite(credits)) {
    return { price: '—', quota: '—', priceMonthly: null, credits: null, corePlanId: null, corePlanName: null };
  }
  return {
    price: formatUsd(priceMonthly),
    cadence: '/mo',
    quota: formatCredits(credits),
    priceMonthly,
    credits,
    corePlanId,
    corePlanName,
  };
}

/** Build plan cards for the Upgrade Plan UI, overlaying core DB price/credits on hd-search copy. */
export function buildPlanCards(corePlans: CorePlanRow[]): PlanCard[] {
  const bySku = new Map<string, CorePlanRow>();
  for (const p of corePlans) {
    if (p.sku_code && p.is_active !== false) bySku.set(p.sku_code.toLowerCase(), p);
  }
  return PLAN_META.map((meta) => ({
    ...meta,
    ...pricingFromCore(meta, bySku.get(meta.sku.toLowerCase())),
  }));
}

/** hd-search tier id → display label */
export const PLAN_LABEL: Record<string, string> = Object.fromEntries(PLAN_META.map((p) => [p.id, p.label]));
