// Disclaimer acceptance shared with hackerdogs-core (so onboarding done on worldmonitor/
// Streamlit carries over). Acceptance lives in core `t_user_settings` under the key
// DISCLAIMER_AGREED, read/written via /tusersettingsui with the user's JWT. For dev/legacy
// sessions that have no core JWT we fall back to hd-search's own store (Redis via the API).
import 'server-only';
import { redirect } from 'next/navigation';
import { config } from './config';
import { api } from './api';
import { jwtSubject } from './auth';
import { validCoreJwt } from './session-jwt';
import type { SessionData } from './session';
import { persistSessionFields } from './session';

const KEY = 'DISCLAIMER_AGREED';
const truthy = (v: unknown) => ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

async function coreJwt(s: SessionData): Promise<string | null> {
  if (!s.jwt) return null;
  const jwt = await validCoreJwt(s);
  if (!jwt) redirect('/api/auth/logout');
  return jwt;
}

/** Read the core DISCLAIMER_AGREED setting for the user (throws on transport error). */
export async function coreGetDisclaimer(jwt: string, sub: string): Promise<boolean> {
  const coreId = jwtSubject(jwt) || sub;
  const u = new URL(`${config.coreBaseUrl}/tusersettingsui/`);
  u.searchParams.set('user_id', coreId);
  const res = await fetch(u.toString(), {
    headers: { authorization: `Bearer ${jwt}`, accept: 'application/json' },
    signal: AbortSignal.timeout(4000),
  });
  if (res.status === 401) redirect('/api/auth/logout');
  if (!res.ok) throw new Error(`core settings ${res.status}`);
  const data: any = await res.json();
  const rows: any[] = Array.isArray(data) ? data : data.settings || data.items || data.data || [];
  const row = rows.find((r) => r?.pref_key === KEY);
  return row ? truthy(row.pref_value) : false;
}

/** Write the core DISCLAIMER_AGREED=1 setting (shared with WM/Streamlit). */
export async function coreSetDisclaimer(jwt: string, sub: string): Promise<void> {
  const coreId = jwtSubject(jwt) || sub;
  const u = new URL(`${config.coreBaseUrl}/tusersettingsui/${KEY}`);
  u.searchParams.set('user_id', coreId);
  const res = await fetch(u.toString(), {
    method: 'POST',
    headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({ pref_value: '1' }),
    signal: AbortSignal.timeout(4000),
  });
  if (res.status === 401) redirect('/api/auth/logout');
  if (!res.ok) throw new Error(`core settings set ${res.status}`);
}

/**
 * Has the user accepted the disclaimer anywhere (core first, then hd-search's own store)?
 * Defaults to TRUE only on total failure so a transient error never hard-blocks the app.
 */
export async function isDisclaimerAccepted(s: SessionData, accFromApi?: { disclaimerAccepted?: boolean }): Promise<boolean> {
  if (s.da) return true;
  // Already accepted per hd-search account — skip a core round-trip on every dashboard nav.
  if (accFromApi?.disclaimerAccepted === true) return true;
  if (s.jwt) {
    try {
      const jwt = await coreJwt(s);
      if (jwt) return await coreGetDisclaimer(jwt, s.sub);
    } catch {
      /* core unreachable → fall back */
    }
  }
  if (accFromApi && typeof accFromApi.disclaimerAccepted === 'boolean') return accFromApi.disclaimerAccepted;
  try {
    return (await api.disclaimer()).accepted;
  } catch {
    return true; // don't block on a transient error
  }
}

/** Record acceptance to core (shared) AND mirror into hd-search's own store. */
export async function recordDisclaimerEverywhere(s: SessionData, termsVersion?: string): Promise<void> {
  if (s.jwt) {
    try {
      const jwt = await coreJwt(s);
      if (jwt) await coreSetDisclaimer(jwt, s.sub);
    } catch {
      /* best-effort; mirror below still records it locally */
    }
  }
  try {
    await api.acceptDisclaimer(termsVersion);
  } catch {
    /* ignore */
  }
  persistSessionFields(s, { da: true });
}
