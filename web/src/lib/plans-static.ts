// HD-Search plan cards — display metadata for the Upgrade Plan page. Live price/credits
// come from GET /v1/account/plans (g_pdt_plans via core). Fallback values here MUST match
// the g_pdt_plans table in the core database.
export interface PlanCard {
  id: string;
  sku: string;
  label: string;
  price: string;
  cadence?: string;
  quota: string;
  vector: boolean;
  features: string[];
  cta: string;
  highlight?: boolean;
  priceMonthly: number | null;
  credits: number | null;
  /** Core g_pdt_plans.id (UUID) — sent to checkout endpoint */
  corePlanId: string | null;
  /** Core g_pdt_plans.name — sent to checkout endpoint */
  corePlanName: string | null;
}

export const PLAN_CARDS: PlanCard[] = [
  {
    id: 'free',
    sku: 'chihuahua-free',
    label: 'Free',
    price: '$0',
    cadence: '/mo',
    quota: '50 credits / mo',
    vector: false,
    features: ['All free & self-hosted engines', 'Faceted search', '3-day data retention'],
    cta: 'Start free',
    priceMonthly: 0,
    credits: 50,
    corePlanId: '01K0Q0AHMY6QY5V6TD84BE79NN',
    corePlanName: 'Public 360 (Chihuahua)',
  },
  {
    id: 'dev',
    sku: 'bulldog-starter',
    label: 'Dev',
    price: '$30',
    cadence: '/mo',
    quota: '3,150 credits / mo',
    vector: false,
    features: ['All engines', 'Use your own provider keys', '30-day data retention'],
    cta: 'Choose Dev',
    priceMonthly: 30,
    credits: 3150,
    corePlanId: '01K0Q0AHN42Z6A6GDKYMF2SR0A',
    corePlanName: 'OSINT 360 (Bulldog)',
  },
  {
    id: 'devtest',
    sku: 'german-shepherd-premium',
    label: 'DevTest',
    price: '$100',
    cadence: '/mo',
    quota: '10,000 credits / mo',
    vector: true,
    features: ['Everything in Dev', 'Vector search & indexing', 'Priority queueing'],
    cta: 'Choose DevTest',
    highlight: true,
    priceMonthly: 100,
    credits: 10000,
    corePlanId: '01K0Q0AHN6VVCT9XH2HRFY000X',
    corePlanName: 'Threat 360 (German Shepherd)',
  },
  {
    id: 'production',
    sku: 'doberman-enterprise',
    label: 'Production',
    price: '$500',
    cadence: '/mo',
    quota: '55,000 credits / mo',
    vector: true,
    features: ['Everything in DevTest', 'Higher rate limits', 'Priority support'],
    cta: 'Choose Production',
    priceMonthly: 500,
    credits: 55000,
    corePlanId: '01K0Q0AHN9S2TTBPHHDZ59FZSP',
    corePlanName: 'Intel 360 (Doberman)',
  },
  {
    id: 'enterprise',
    sku: 'alpha-pack',
    label: 'Enterprise',
    price: 'Contact us',
    quota: 'Custom volume',
    vector: true,
    features: ['Dedicated instance', 'Customer support & training', 'Custom SLAs', '365-day data retention'],
    cta: 'Contact sales',
    priceMonthly: null,
    credits: null,
    corePlanId: '01KF1T0B0SZ5F4RVQHXM7MPPQV',
    corePlanName: 'Hackerdogs Alpha Pack',
  },
];

/** hd-search tier id → hd-search display name (for the "current plan" label). */
export const PLAN_LABEL: Record<string, string> = Object.fromEntries(PLAN_CARDS.map((p) => [p.id, p.label]));

/** Merge live API plan cards onto static fallback (keeps features/copy if API omits fields). */
export function mergePlanCards(apiPlans: PlanCard[] | undefined): PlanCard[] {
  if (!apiPlans?.length) return PLAN_CARDS;
  const byId = new Map(apiPlans.map((p) => [p.id, p]));
  return PLAN_CARDS.map((fallback) => {
    const live = byId.get(fallback.id);
    if (fallback.id === 'enterprise') return fallback;
    return live
      ? { ...fallback, price: live.price, cadence: live.cadence, quota: live.quota, priceMonthly: live.priceMonthly ?? fallback.priceMonthly, credits: live.credits ?? fallback.credits, corePlanId: live.corePlanId ?? fallback.corePlanId, corePlanName: live.corePlanName ?? fallback.corePlanName }
      : fallback;
  });
}
