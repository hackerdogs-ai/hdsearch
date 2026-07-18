// Client for the central hackerdogs-core auth, used when HDSEARCH_AUTH_MODE includes
// 'core'. Verifies the core-issued HS256 JWT (same JWT_SECRET_KEY the core signs with).
// Billing/plan lookups are gone — this build has no plans, quotas, or credits.
// (Legacy; the open-source self-host build uses local auth, not core.)
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
