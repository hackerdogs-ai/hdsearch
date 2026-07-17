/** Unified search/crawl result cache TTL — one value per user, all providers. */

import type { PlanId } from './plans.js';

export const DEFAULT_CACHE_TTL_SEC = 900; // 15 minutes

export const CACHE_TTL_OPTIONS = [
  { sec: 900, label: '15 min' },
  { sec: 1800, label: '30 min' },
  { sec: 3600, label: '1 hr' },
  { sec: 86400, label: '24 hr' },
] as const;

export const ALLOWED_CACHE_TTL_SEC = new Set<number>(CACHE_TTL_OPTIONS.map((o) => o.sec));

/** Max selectable cache TTL per plan tier (Result cache slider ceiling). */
export const MAX_CACHE_TTL_SEC_BY_PLAN: Record<PlanId, number> = {
  free: 1800,
  dev: 1800,
  devtest: 3600,
  production: 86400,
  enterprise: 86400,
};

export function maxCacheTtlSecForPlan(plan: string): number {
  const id = plan as PlanId;
  return MAX_CACHE_TTL_SEC_BY_PLAN[id] ?? MAX_CACHE_TTL_SEC_BY_PLAN.dev;
}

export function cacheTtlOptionsForPlan(plan: string): typeof CACHE_TTL_OPTIONS[number][] {
  const max = maxCacheTtlSecForPlan(plan);
  return CACHE_TTL_OPTIONS.filter((o) => o.sec <= max);
}

export function allowedCacheTtlSecForPlan(plan: string): Set<number> {
  return new Set(cacheTtlOptionsForPlan(plan).map((o) => o.sec));
}

/** Clamp a TTL to the highest allowed option at or below the value for this plan. */
export function clampCacheTtlSec(sec: number, plan: string): number {
  const allowed = allowedCacheTtlSecForPlan(plan);
  if (allowed.has(sec)) return sec;
  const max = maxCacheTtlSecForPlan(plan);
  const fit = [...cacheTtlOptionsForPlan(plan)].reverse().find((o) => o.sec <= sec);
  if (fit) return fit.sec;
  return cacheTtlOptionsForPlan(plan)[0]?.sec ?? Math.min(DEFAULT_CACHE_TTL_SEC, max);
}

export function normalizeCacheTtlSec(value: unknown, plan?: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  const base = ALLOWED_CACHE_TTL_SEC.has(n) ? n : DEFAULT_CACHE_TTL_SEC;
  return plan ? clampCacheTtlSec(base, plan) : base;
}

export function resolveUserCacheTtlSec(cacheTtlSec?: number, plan?: string): number {
  const raw =
    cacheTtlSec != null && ALLOWED_CACHE_TTL_SEC.has(cacheTtlSec) ? cacheTtlSec : DEFAULT_CACHE_TTL_SEC;
  return plan ? clampCacheTtlSec(raw, plan) : raw;
}
