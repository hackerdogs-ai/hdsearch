/** Per-user Redis retention for search history + AI threads (hot tier). */

export const DEFAULT_HISTORY_TTL_SEC = 3 * 24 * 3600; // 3 days

export const HISTORY_TTL_OPTIONS = [
  { sec: 1 * 24 * 3600, days: 1, label: '1 day' },
  { sec: 3 * 24 * 3600, days: 3, label: '3 days' },
  { sec: 7 * 24 * 3600, days: 7, label: '7 days' },
  { sec: 14 * 24 * 3600, days: 14, label: '14 days' },
  { sec: 30 * 24 * 3600, days: 30, label: '30 days' },
] as const;

export const ALLOWED_HISTORY_TTL_SEC = new Set<number>(HISTORY_TTL_OPTIONS.map((o) => o.sec));

export function historyTtlOptions(): (typeof HISTORY_TTL_OPTIONS)[number][] {
  return [...HISTORY_TTL_OPTIONS];
}

/** Coerce a stored/API value to an allowed History Cache TTL; default 3 days. */
export function normalizeHistoryTtlSec(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (ALLOWED_HISTORY_TTL_SEC.has(n)) return n;
  return DEFAULT_HISTORY_TTL_SEC;
}

export function resolveUserHistoryTtlSec(historyTtlSec?: number): number {
  return normalizeHistoryTtlSec(historyTtlSec);
}

export function historyTtlDaysLabel(ttlSec: number): string {
  const opt = HISTORY_TTL_OPTIONS.find((o) => o.sec === ttlSec);
  if (opt) return opt.label;
  const days = Math.max(1, Math.round(ttlSec / 86400));
  return days === 1 ? '1 day' : `${days} days`;
}
