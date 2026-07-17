// Client for the central hackerdogs-core auth, used when HDSEARCH_AUTH_MODE includes
// 'core'. Verifies the core-issued HS256 JWT (same JWT_SECRET_KEY the core signs with) and
// resolves the user's plan SKU from core GET /auth/me — exactly the identity worldmonitor
// gets from token-exchange, but fetched by Bearer JWT for a server-side API. Plan is cached
// briefly per user. Degrades gracefully (→ free) if the secret or endpoint is unavailable,
// so this is safe to ship before the core /auth/me PR lands. (Legacy; the
// open-source self-host build uses local auth, not core.) See docs/OPEN_SOURCE_MIGRATION.md.
import { verify } from 'hono/jwt';
import { env } from './env.js';
import { log, errFields } from './logger.js';

export interface CoreClaims {
  sub: string;
  email?: string;
  tenantId?: string;
  roles?: string[];
}

/** Verify a core Hackerdogs JWT (HS256). Returns claims or null if invalid/expired/disabled. */
export async function verifyCoreJwt(token: string): Promise<CoreClaims | null> {
  if (!env.jwtSecretKey) return null; // not configured → core auth disabled
  try {
    const p = (await verify(token, env.jwtSecretKey, 'HS256')) as Record<string, any>;
    const sub = p.sub || p.id || p.user_id;
    if (!sub) return null;
    return { sub: String(sub), email: p.email, tenantId: p.tenant_id, roles: p.roles };
  } catch {
    return null; // bad signature / expired / malformed
  }
}

// Short-lived per-user plan cache (process-local; mirrors keystore's pattern).
const planCache = new Map<string, { sku?: string; at: number }>();
const planInflight = new Map<string, Promise<string | undefined>>();
const PLAN_TTL_MS = 5 * 60 * 1000;

export interface CorePlanRow {
  id: string;
  sku_code: string;
  name?: string;
  price?: number;
  credits?: number;
  is_active?: boolean;
}

// Full plan rows from core /gpdtplansui, cached process-wide for 10 min.
let plansCache: { at: number; rows: CorePlanRow[] } | null = null;

export async function coreListPlans(token: string): Promise<CorePlanRow[]> {
  if (plansCache && Date.now() - plansCache.at < 10 * 60 * 1000) return plansCache.rows;
  const rows: CorePlanRow[] = [];
  try {
    const res = await fetch(`${env.coreBaseUrl}/gpdtplansui/`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const raw = (await res.json().catch(() => [])) as any[];
      for (const p of Array.isArray(raw) ? raw : []) {
        if (p?.sku_code) {
          rows.push({
            id: String(p.id ?? ''),
            sku_code: String(p.sku_code),
            name: p.name,
            price: p.price != null ? Number(p.price) : undefined,
            credits: p.credits != null ? Number(p.credits) : undefined,
            is_active: p.is_active,
          });
        }
      }
    } else {
      log.warn('coreListPlans non-OK', { status: res.status });
    }
  } catch (e) {
    log.warn('core plan catalog fetch failed', { err: (e as Error).message });
  }
  plansCache = { at: Date.now(), rows };
  return rows;
}

/** Public catalog fetch — uses HD_CORE_CATALOG_JWT when set, else empty (fallback pricing). */
export async function coreListPlansForCatalog(): Promise<CorePlanRow[]> {
  const token = env.coreCatalogJwt;
  if (!token) return [];
  return coreListPlans(token);
}

async function planCatalog(token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const p of await coreListPlans(token)) if (p.id && p.sku_code) map.set(p.id, p.sku_code);
  return map;
}

/**
 * Resolve the user's CURRENT core plan SKU. Core has no /auth/me, so we read the user's
 * active subscription (/tupaymentsubscriptionsui) and map its plan_id → sku_code via the
 * plan catalog (/gpdtplansui). Returns undefined (→ free tier) when there's no active
 * subscription or core is unreachable.
 */
export async function corePlanSku(token: string, sub: string): Promise<string | undefined> {
  const hit = planCache.get(sub);
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.sku;

  const pending = planInflight.get(sub);
  if (pending) return pending;

  const work = (async (): Promise<string | undefined> => {
    let sku: string | undefined;
    try {
      const res = await fetch(`${env.coreBaseUrl}/tupaymentsubscriptionsui/?user_id=${encodeURIComponent(sub)}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const subs = (await res.json().catch(() => [])) as any[];
        const rows = Array.isArray(subs) ? subs : [];
        const active = rows.find((s) => ['active', 'trialing'].includes(String(s?.status || '').toLowerCase())) || rows[0];
        if (active?.plan_id) sku = (await planCatalog(token)).get(active.plan_id);
      } else if (res.status !== 404) {
        log.warn('core subscriptions non-OK', { status: res.status });
      }
    } catch (e) {
      log.warn('core plan resolve failed', { err: (e as Error).message });
    }
    planCache.set(sub, { sku, at: Date.now() });
    return sku;
  })().finally(() => {
    planInflight.delete(sub);
  });

  planInflight.set(sub, work);
  return work;
}

// ── Central credit deduction ────────────────────────────────────────────────
// Calls core POST /unitconsumptiontrackerui/consume to atomically deduct
// credits and record the consumption event. Fire-and-forget safe: failures
// are logged but never block the user's request.

export interface ConsumeResult {
  ok: boolean;
  remaining?: number;
}

export async function coreConsumeCredits(
  token: string,
  opts: { sessionId: string; taskId?: string; credits: number; costUsd?: number },
): Promise<ConsumeResult> {
  if (!env.coreBaseUrl || opts.credits <= 0) return { ok: true };
  try {
    const res = await fetch(`${env.coreBaseUrl}/unitconsumptiontrackerui/consume`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        session_id: opts.sessionId,
        task_id: opts.taskId,
        units_charged: opts.credits,
        token_cost: opts.costUsd ?? opts.credits / 100,
        is_task_successful: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json().catch(() => ({}))) as Record<string, any>;
      return { ok: true, remaining: data.remaining_credits };
    }
    log.warn('core credit deduction non-OK', { status: res.status });
    return { ok: false };
  } catch (e) {
    log.warn('core credit deduction failed (non-blocking)', { err: (e as Error).message });
    return { ok: false };
  }
}

export async function coreGetBalance(token: string): Promise<{
  total: number; used: number; remaining: number;
} | null> {
  if (!env.coreBaseUrl) return null;
  try {
    const res = await fetch(`${env.coreBaseUrl}/creditbalancesui/balance`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      log.warn('coreGetBalance non-OK', { status: res.status });
      return null;
    }
    const d = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (!d) return null;
    return {
      total: d.total_credits ?? 0,
      used: d.used_credits ?? 0,
      remaining: d.remaining_credits ?? 0,
    };
  } catch (e) {
    log.warn('coreGetBalance failed', errFields(e));
    return null;
  }
}

export interface CoreConsumptionPage {
  records: Record<string, any>[];
  total: number;
  limit: number;
  offset: number;
}

export async function coreGetConsumption(
  token: string,
  params: { days?: number; limit?: number; offset?: number },
): Promise<CoreConsumptionPage | null> {
  if (!env.coreBaseUrl) return null;
  try {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset != null) qs.set('offset', String(params.offset));
    // Core expects start_date/end_date (ISO date), not a `days` param.
    if (params.days) {
      const end = new Date();
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - params.days);
      qs.set('start_date', start.toISOString().slice(0, 10));
      qs.set('end_date', end.toISOString().slice(0, 10));
    }
    const res = await fetch(`${env.coreBaseUrl}/unitconsumptiontrackerui/consumption?${qs}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      log.warn('coreGetConsumption non-OK', { status: res.status });
      return null;
    }
    const data = (await res.json().catch(() => null)) as Record<string, any> | null;
    if (!data) return null;
    const records = Array.isArray(data.records) ? data.records : [];
    return {
      records,
      total: Number(data.total ?? records.length),
      limit: Number(data.limit ?? params.limit ?? 100),
      offset: Number(data.offset ?? params.offset ?? 0),
    };
  } catch (e) {
    log.warn('coreGetConsumption failed', errFields(e));
    return null;
  }
}

export async function coreGetStats(
  token: string,
  params: { days?: number },
): Promise<Record<string, any> | null> {
  if (!env.coreBaseUrl) return null;
  try {
    const days = params.days ?? 30;
    const period = days <= 7 ? '7d' : days <= 30 ? '30d' : days <= 90 ? '90d' : '1y';
    const res = await fetch(`${env.coreBaseUrl}/unitconsumptiontrackerui/stats?period=${period}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      log.warn('coreGetStats non-OK', { status: res.status });
      return null;
    }
    return ((await res.json().catch(() => null)) as Record<string, any> | null) ?? null;
  } catch (e) {
    log.warn('coreGetStats failed', errFields(e));
    return null;
  }
}
