// Server-side BFF client for the hd-search API. Every call is authenticated as
// the logged-in user via the trusted internal headers (X-HD-Internal + X-HD-User),
// so the browser never sees an API key and all quota/rate-limit/key resolution
// happens server-side exactly as for external API-key callers.
import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { config } from './config';
import { getSession, type SessionData, type SessionUser } from './session';
import { clearJwtCache, refreshCoreJwt, validCoreJwt } from './session-jwt';
import { rethrowIfRedirect } from './navigation-error';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

interface CallOpts {
  method?: string;
  body?: unknown;
  user?: SessionUser | null;
  // bypass the session (e.g. webhooks) — rarely used from the web app
  asUser?: string;
  cache?: RequestCache;
  /** Set during login callback so a profile upsert failure does not trigger auto-logout. */
  suppressAuthRedirect?: boolean;
}

/** Cookie session with a core JWT expired and unrecoverable → clear session via logout. */
function autoLogout(session: SessionData | null | undefined, opts: { suppressAuthRedirect?: boolean; user?: SessionUser | null }): never {
  if (!opts.suppressAuthRedirect && !opts.user && session?.jwt) redirect('/api/auth/logout');
  throw new ApiError(401, 'session expired — please sign in again');
}

/** Auth headers for upstream hd-search API calls — shared by apiCall and SSE proxies. */
export async function buildApiAuthHeaders(
  session: SessionData,
  opts: { suppressAuthRedirect?: boolean; user?: SessionUser | null } = {},
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const hadCoreJwt = !!session.jwt;
  const bearer = hadCoreJwt ? await validCoreJwt(session) : null;
  if (hadCoreJwt && !bearer) autoLogout(session, opts);
  const isDevSession = session.sub.startsWith('dev|');
  if (bearer && !isDevSession) {
    headers['authorization'] = `Bearer ${bearer}`;
  } else {
    headers['x-hd-user'] = session.sub;
    if (config.internalSecret) headers['x-hd-internal'] = config.internalSecret;
    if (bearer) headers['x-hd-core-jwt'] = bearer;
  }
  return headers;
}

export async function apiCall<T = any>(path: string, opts: CallOpts = {}): Promise<T> {
  const session = opts.user ?? getSession();
  const sub = session?.sub ?? opts.asUser;
  if (!sub) throw new ApiError(401, 'not authenticated');

  const headers = await buildApiAuthHeaders(session ?? { sub, exp: 0 }, opts);
  const hadCoreJwt = !!(session?.jwt);
  const autoLogoutOn401 = hadCoreJwt && !opts.user && !opts.suppressAuthRedirect;

  const body = opts.body ? JSON.stringify(opts.body) : undefined;
  const mkInit = (): RequestInit => ({
    method: opts.method || (body ? 'POST' : 'GET'),
    headers,
    body,
    cache: opts.cache ?? 'no-store',
  });
  let res = await fetch(`${config.apiUrl}${path}`, mkInit());

  let text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  // Safety net: token may have expired between the freshness check and the API hop — refresh once.
  if (
    !res.ok &&
    res.status === 401 &&
    hadCoreJwt &&
    session?.rt &&
    String(json?.message || '').includes('invalid or expired token')
  ) {
    if (session.sub) clearJwtCache(session.sub);
    const refreshed = await refreshCoreJwt(session);
    if (refreshed) {
      headers['authorization'] = `Bearer ${refreshed}`;
      res = await fetch(`${config.apiUrl}${path}`, mkInit());
      text = await res.text();
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = { raw: text };
      }
    }
  }

  if (!res.ok) {
    if (autoLogoutOn401 && res.status === 401) autoLogout(session, opts);
    throw new ApiError(res.status, json?.message || `API ${res.status}`, json);
  }
  return json as T;
}

/** Use at the top of catch blocks around apiCall so auto-logout redirects propagate. */
export { rethrowIfRedirect };

/** Per-request dedupe — layout + page often both need account in one navigation. */
const getAccountCached = cache(() => apiCall('/v1/account'));

// Convenience wrappers used across the panel ---------------------------------

export const api = {
  search: (body: Record<string, unknown>) => apiCall('/v1/search', { body }),
  crawl: (body: Record<string, unknown>) => apiCall('/v1/crawl', { body }),
  vectorSearch: (body: Record<string, unknown>) => apiCall('/v1/search/vector', { body }),
  engines: (qs = '') => apiCall(`/v1/engines${qs}`),
  account: () => getAccountCached(),
  disclaimer: () => apiCall<{ accepted: boolean; at?: string | null }>('/v1/account/disclaimer'),
  acceptDisclaimer: (termsVersion?: string) =>
    apiCall('/v1/account/accept-disclaimer', {
      method: 'POST',
      body: termsVersion ? { termsVersion } : {},
    }),
  history: (limit = 50, offset = 0) => apiCall(`/v1/account/history?limit=${limit}&offset=${offset}`),
  dashboard: (days = 30) => apiCall(`/v1/account/dashboard?days=${days}`),
  plans: () => apiCall('/v1/account/plans'),
  apiKeys: () => apiCall('/v1/keys/api'),
  createApiKey: (body: Record<string, unknown>) => apiCall('/v1/keys/api', { body, method: 'POST' }),
  revokeApiKey: (id: string) => apiCall(`/v1/keys/api/${id}`, { method: 'DELETE' }),
  providerKeys: () => apiCall('/v1/keys/providers'),
  putProviderKey: (body: Record<string, unknown>) => apiCall('/v1/keys/providers', { body, method: 'PUT' }),
  deleteProviderKey: (field: string) => apiCall(`/v1/keys/providers/${field}`, { method: 'DELETE' }),
  upsertProfile: (user: SessionUser) =>
    apiCall('/v1/account/profile', { method: 'PUT', user, body: { email: user.email, name: user.name, picture: user.picture } }),
  credits: () => apiCall('/v1/account/credits'),
  creditConsumption: (days = 30, limit = 500, offset = 0) =>
    apiCall(`/v1/account/credits/consumption?days=${days}&limit=${limit}&offset=${offset}`),
  creditStats: (days = 30) => apiCall(`/v1/account/credits/stats?days=${days}`),
  providerPrefs: () => apiCall('/v1/engines/prefs'),
  saveProviderPrefs: (prefs: { disabled?: string[]; ranks?: Record<string, number>; cacheTtlSec?: number }) =>
    apiCall('/v1/engines/prefs', { method: 'PUT', body: prefs }),
  aiProviders: () => apiCall('/v1/ai/providers'),
  // Billing is owned by hackerdogs-core; hd-search only links out to the core portal.

  // Admin endpoints (super-user only)
  adminDefaultKeys: () => apiCall('/v1/admin/default-keys'),
  adminPutDefaultKey: (body: Record<string, unknown>) => apiCall('/v1/admin/default-keys', { body, method: 'PUT' }),
  adminDeleteDefaultKey: (body: Record<string, unknown>) => apiCall('/v1/admin/default-keys', { body, method: 'DELETE' }),
  adminLlmProviders: () => apiCall('/v1/admin/llm-providers'),
  adminGetSignup: () => apiCall('/v1/admin/signup'),
  adminSetSignup: (allow: boolean) => apiCall('/v1/admin/signup', { body: { allow }, method: 'PUT' }),
};
