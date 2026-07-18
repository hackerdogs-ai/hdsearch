// Authn/z middleware. Two trusted callers:
//   1. External developers — `Authorization: Bearer sk-hds-...` API key. Resolves
//      to a user id + scopes + per-key rate limit.
//   2. The first-party web app (Next.js BFF) — passes the Auth0-authenticated
//      user via `X-HD-User` plus a shared `X-HD-Internal` secret so the panel can
//      act on the logged-in user's behalf without minting an API key.
//
// On success we attach { userId, scopes, role, keyId } to the context.
import type { Context, Next } from 'hono';
import { env } from './env.js';
import { verifyKey, touchKey, type Scope } from './apikeys.js';
import { rateLimit } from './ratelimit.js';
import { SCHEMA, tryQuery } from './db.js';
import { verifyCoreJwt } from './coreClient.js';
import { rolesToHd, type HdRole } from './roles.js';

// Full first-party scope set granted to a signed-in user (web BFF / legacy header path).
const USER_SCOPES: Scope[] = ['search:read', 'crawl:read', 'vector:read', 'admin:keys'];

export interface Principal {
  userId: string;
  scopes: Scope[];
  role?: HdRole; // 'admin' (core super/tenant-admin) | 'user'
  keyId?: string;
  coreJwt?: string; // the raw core JWT, when central auth is enabled
  rateLimitPerMin: number;
}

declare module 'hono' {
  interface ContextVariableMap {
    principal: Principal;
  }
}

const INTERNAL_SECRET = env.internalSecret;

// Shared identities used for ANONYMOUS (not-signed-in) home/search browsing.
// Abuse is bounded by the per-id rate limit. Configurable via HDSEARCH_DEMO_USERS.
const DEMO_USERS = new Set(
  (process.env.HDSEARCH_DEMO_USERS || 'public-demo').split(',').map((s) => s.trim()).filter(Boolean),
);
// generous shared rate limit for the anonymous demo bucket (bounded to deter abuse)
const DEMO_RATE_LIMIT = Number(process.env.HDSEARCH_DEMO_RATE_LIMIT) || 6000;

/** Is this the shared anonymous demo identity (vs a real signed-in user)? */
export function isDemoUser(userId: string): boolean {
  return DEMO_USERS.has(userId);
}

/** Local-auth role lookup: the DB `role` column is the source of truth for admin
 * in self-hosted mode (there is no core JWT to carry role claims). */
export async function roleForUser(userId: string): Promise<HdRole> {
  const rows = await tryQuery<{ role: string }>(`select role from ${SCHEMA}.users where id=$1`, [userId]);
  return rows[0]?.role === 'admin' ? 'admin' : 'user';
}

/** Require a valid principal (API key or trusted internal header). */
export function requireAuth() {
  return async (c: Context, next: Next) => {
    // 1) internal web BFF (self-asserted user behind the shared secret). This is the
    // legacy/dev trust path — DISABLED in 'core' mode, where identity must come from a
    // cryptographically-verified core JWT (see 2a). Active in 'legacy'/'both' for dev-login.
    const internal = c.req.header('x-hd-internal');
    const hdUser = c.req.header('x-hd-user');
    if (env.authMode !== 'core' && INTERNAL_SECRET && internal && internal === INTERNAL_SECRET && hdUser) {
      // The shared anonymous demo identity is rate-limited far more generously than
      // a single signed-in user, since one bucket is shared across all visitors.
      const isDemo = DEMO_USERS.has(hdUser);
      const coreJwtHeader = c.req.header('x-hd-core-jwt');
      // Local-auth admin: derive the platform-admin scope from the DB role (there
      // is no core JWT in self-hosted mode). Demo/anon users are never admin.
      const dbRole = isDemo ? 'user' : await roleForUser(hdUser);
      const scopes: Scope[] = dbRole === 'admin' ? [...USER_SCOPES, 'admin:platform'] : [...USER_SCOPES];
      const principal: Principal = {
        userId: hdUser,
        scopes,
        role: dbRole,
        coreJwt: coreJwtHeader || undefined,
        rateLimitPerMin: isDemo ? DEMO_RATE_LIMIT : env.defaultRateLimitPerMin,
      };
      c.set('principal', principal);
      return rateGate(c, next, `u:${hdUser}`, principal.rateLimitPerMin);
    }

    // 2) Bearer token — either an hd-search API key (sk-hds-…) or a central core JWT.
    const auth = c.req.header('authorization') || '';
    const bearer = auth.match(/^Bearer\s+(.+)$/)?.[1]?.trim() || c.req.header('x-api-key') || '';

    // 2a) central hackerdogs-core JWT (when enabled) — any non-sk-hds bearer.
    if (bearer && !bearer.startsWith('sk-hds-') && (env.authMode === 'core' || env.authMode === 'both')) {
      const claims = await verifyCoreJwt(bearer);
      if (!claims) return c.json({ error: 'unauthorized', message: 'invalid or expired token' }, 401);
      // RBAC: inherit the user's core role → hd-search scopes.
      const { role, scopes } = rolesToHd(claims.roles);
      const principal: Principal = {
        userId: claims.sub,
        scopes,
        role,
        coreJwt: bearer,
        rateLimitPerMin: env.defaultRateLimitPerMin,
      };
      c.set('principal', principal);
      return rateGate(c, next, `u:${claims.sub}`, principal.rateLimitPerMin);
    }

    // 2b) hd-search developer API key
    const raw = bearer.startsWith('sk-hds-') ? bearer : c.req.header('x-api-key') || '';
    if (!raw) return c.json({ error: 'unauthorized', message: 'missing API key' }, 401);
    const rec = await verifyKey(raw);
    if (!rec) return c.json({ error: 'unauthorized', message: 'invalid or revoked API key' }, 401);

    void touchKey(rec.id);
    const principal: Principal = {
      userId: rec.userId,
      scopes: rec.scopes,
      keyId: rec.id,
      rateLimitPerMin: rec.rateLimitPerMin,
    };
    c.set('principal', principal);
    return rateGate(c, next, `k:${rec.id}`, rec.rateLimitPerMin);
  };
}

async function rateGate(c: Context, next: Next, id: string, perMin: number) {
  const rl = await rateLimit(id, perMin);
  c.header('X-RateLimit-Limit', String(rl.limit));
  c.header('X-RateLimit-Remaining', String(rl.remaining));
  c.header('X-RateLimit-Reset', String(rl.resetSec));
  if (!rl.allowed) return c.json({ error: 'rate_limited', message: 'rate limit exceeded', retryAfter: rl.resetSec }, 429);
  return next();
}

/** Require a specific scope (use after requireAuth). */
export function requireScope(scope: Scope) {
  return async (c: Context, next: Next) => {
    const p = c.get('principal');
    if (!p || !p.scopes.includes(scope)) {
      return c.json({ error: 'forbidden', message: `missing scope '${scope}'` }, 403);
    }
    return next();
  };
}

