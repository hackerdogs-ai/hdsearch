// Shared core-JWT refresh for the BFF. Used by apiCall AND direct core fetches
// (disclaimer settings, etc.) so every hop uses the same refreshed token.
import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { refreshAuth0, coreTokenExchange, jwtExp } from './auth';
import { persistSessionTokens, type SessionData } from './session';

const jwtCache = new Map<string, { jwt: string; jexp: number }>();
const JWT_SKEW_SEC = 30;
/** Coalesce concurrent refresh attempts (parallel api.account hops used to stampede Auth0). */
const refreshInflight = new Map<string, Promise<string | null>>();

/** True when the JWT payload `exp` is still valid (cookie jexp is not trusted alone). */
export function jwtStillFresh(jwt: string): boolean {
  return jwtExp(jwt) > Math.floor(Date.now() / 1000) + JWT_SKEW_SEC;
}

/** Exchange the Auth0 refresh token for a fresh core JWT. Returns null on failure. */
export async function refreshCoreJwt(s: SessionData): Promise<string | null> {
  if (!s.rt || !s.sub) return null;
  const inflight = refreshInflight.get(s.sub);
  if (inflight) return inflight;

  const work = (async (): Promise<string | null> => {
    try {
      const t = await refreshAuth0(s.rt!);
      if (!t.id_token) return null;
      const { jwt, jexp } = await coreTokenExchange(t.id_token);
      const rt = t.refresh_token ?? s.rt!;
      jwtCache.set(s.sub!, { jwt, jexp });
      persistSessionTokens(s, { jwt, jexp, rt });
      return jwt;
    } catch {
      return null;
    } finally {
      refreshInflight.delete(s.sub!);
    }
  })();

  refreshInflight.set(s.sub, work);
  return work;
}

/** Return a non-expired core JWT, refreshing when needed. Null = dev session or refresh failed. */
export const validCoreJwt = cache(async (s: SessionData): Promise<string | null> => {
  if (!s.jwt) return null;
  if (jwtStillFresh(s.jwt)) return s.jwt;
  const cached = s.sub ? jwtCache.get(s.sub) : undefined;
  if (cached && jwtStillFresh(cached.jwt)) {
    persistSessionTokens(s, { jwt: cached.jwt, jexp: cached.jexp });
    return cached.jwt;
  }
  return refreshCoreJwt(s);
});

/** Awaitable gate for dashboard routes — redirect before rendering stale sessions. */
export const ensureCoreSession = cache(async (s: SessionData): Promise<string | null> => {
  if (!s.jwt) return null;
  const jwt = await validCoreJwt(s);
  if (!jwt) redirect('/api/auth/logout');
  return jwt;
});

export function clearJwtCache(sub?: string): void {
  if (sub) jwtCache.delete(sub);
}
