'use client';

// Intercept client-side fetches to our BFF routes — on 401, sign out automatically.
// Must install synchronously (not in useEffect): child useEffects can fire before a
// parent effect runs, so a late patch misses the first fetch on pages like Provider Ranking.
const BFF_PREFIX = '/api/';
const GUARD_EXEMPT = ['/api/ai/'];

function installAuthFetchGuard(): void {
  if (typeof window === 'undefined') return;
  const w = window as Window & { __hdsFetchGuard?: boolean };
  if (w.__hdsFetchGuard) return;
  w.__hdsFetchGuard = true;

  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (res.status === 401 && url.startsWith(BFF_PREFIX) && !GUARD_EXEMPT.some((p) => url.startsWith(p))) {
      window.location.href = '/api/auth/logout';
    }
    return res;
  };
}

installAuthFetchGuard();

export function AuthFetchGuard() {
  installAuthFetchGuard();
  return null;
}
