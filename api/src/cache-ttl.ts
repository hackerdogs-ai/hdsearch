/** Unified search/crawl result cache TTL — admin default/max + optional per-request override. */

import { getDefaultCacheTtlSec, getMaxCacheTtlSec } from './runtime-config.js';

export const DEFAULT_CACHE_TTL_SEC = 900; // 15 minutes
/** Built-in hard max when admin has not configured one (24 hours). */
export const DEFAULT_MAX_CACHE_TTL_SEC = 86400;

export const CACHE_TTL_OPTIONS = [
  { sec: 900, label: '15 min' },
  { sec: 1800, label: '30 min' },
  { sec: 3600, label: '1 hr' },
  { sec: 86400, label: '24 hr' },
] as const;

export const ALLOWED_CACHE_TTL_SEC = new Set<number>(CACHE_TTL_OPTIONS.map((o) => o.sec));

export interface CacheTtlLimits {
  defaultSec: number;
  maxSec: number;
}

/** Resolve admin/env/built-in default + hard max (default is never above max). */
export function getAdminCacheTtlLimits(): CacheTtlLimits {
  const maxRaw = getMaxCacheTtlSec();
  const maxEnv = process.env.HDSEARCH_MAX_CACHE_TTL;
  let maxSec =
    typeof maxRaw === 'number' && maxRaw > 0
      ? Math.floor(maxRaw)
      : maxEnv && Number(maxEnv) > 0
        ? Math.floor(Number(maxEnv))
        : DEFAULT_MAX_CACHE_TTL_SEC;

  const defRaw = getDefaultCacheTtlSec();
  const defEnv = process.env.HDSEARCH_DEFAULT_CACHE_TTL;
  let defaultSec =
    typeof defRaw === 'number' && defRaw > 0
      ? Math.floor(defRaw)
      : defEnv && Number(defEnv) > 0
        ? Math.floor(Number(defEnv))
        : DEFAULT_CACHE_TTL_SEC;

  if (defaultSec > maxSec) defaultSec = maxSec;
  return { defaultSec, maxSec };
}

/**
 * Resolve the Redis cache TTL for a request.
 * Uses `ttl` when set and ≤ hard max; otherwise the admin default
 * (also when ttl is missing, non-positive, or greater than max).
 */
export function resolveRequestCacheTtlSec(
  ttl?: number | null,
  limits?: Partial<CacheTtlLimits>,
): number {
  const admin = getAdminCacheTtlLimits();
  const maxSec = limits?.maxSec ?? admin.maxSec;
  const defaultSec = Math.min(limits?.defaultSec ?? admin.defaultSec, maxSec);
  if (ttl == null || !Number.isFinite(ttl) || ttl < 1 || ttl > maxSec) return defaultSec;
  return Math.floor(ttl);
}

/** Highest selectable cache TTL — the admin/env hard max (no per-plan clamp). */
export function maxCacheTtlSec(): number {
  return getAdminCacheTtlLimits().maxSec;
}

export function cacheTtlOptions(): (typeof CACHE_TTL_OPTIONS)[number][] {
  const max = maxCacheTtlSec();
  return CACHE_TTL_OPTIONS.filter((o) => o.sec <= max);
}

export function allowedCacheTtlSec(): Set<number> {
  return new Set(cacheTtlOptions().map((o) => o.sec));
}

export function normalizeCacheTtlSec(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return resolveRequestCacheTtlSec(ALLOWED_CACHE_TTL_SEC.has(n) ? n : undefined);
}

export function resolveUserCacheTtlSec(cacheTtlSec?: number): number {
  return resolveRequestCacheTtlSec(cacheTtlSec);
}
