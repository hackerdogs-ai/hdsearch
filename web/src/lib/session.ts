// Encrypted-cookie session for the BFF. The cookie holds the user's identity AND their
// hackerdogs-core JWT + Auth0 refresh token, so it is ENCRYPTED with AES-256-GCM (not just
// signed) — authenticated encryption gives confidentiality (tokens aren't readable from the
// cookie) and integrity (tamper-evident) in one. httpOnly + Secure keep it out of JS and
// off plaintext transports. See docs/AUTH_PLAN_INTEGRATION.md.
import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { config, SESSION_COOKIE } from './config';

export interface SessionData {
  sub: string; // stable id (Auth0 sub, or dev id)
  email?: string;
  name?: string;
  picture?: string;
  jwt?: string; // hackerdogs-core Hackerdogs JWT (Bearer for the API)
  rt?: string; // Auth0 refresh token (to refresh the core JWT)
  jexp?: number; // core JWT expiry (unix seconds)
  ev?: boolean; // email verified (from the Auth0 id_token); gates access when false
  da?: boolean; // disclaimer accepted — skips core/hd-search disclaimer round-trips
  nk?: string; // one-time new API key (set on first login, cleared after display)
  exp: number; // cookie/session expiry (unix seconds)
}
/** Back-compat alias — older imports used SessionUser. */
export type SessionUser = SessionData;

const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days
// 32-byte AES key derived from the (hex) session secret.
const KEY = createHash('sha256').update(config.sessionSecret).digest();

export function encodeSession(user: Omit<SessionData, 'exp'> & { exp?: number }): string {
  const full: SessionData = { ...user, exp: user.exp || Math.floor(Date.now() / 1000) + MAX_AGE_SEC };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(full), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2.${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
}

export function decodeSession(token: string | undefined): SessionData | null {
  if (!token || !token.startsWith('v2.')) return null;
  const [, ivB, tagB, ctB] = token.split('.');
  if (!ivB || !tagB || !ctB) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url')); // verifies integrity
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
    const user = JSON.parse(pt) as SessionData;
    if (!user.sub || !user.exp || user.exp < Math.floor(Date.now() / 1000)) return null;
    return user;
  } catch {
    return null; // bad tag / tampered / wrong key / expired
  }
}

/** Read the current session (server components, route handlers, server actions). */
export function getSession(): SessionData | null {
  return decodeSession(cookies().get(SESSION_COOKIE)?.value);
}

/** Merge fields into the session cookie (e.g. disclaimer accepted flag). */
export function persistSessionFields(s: SessionData, patch: Partial<SessionData>): void {
  try {
    cookies().set(SESSION_COOKIE, encodeSession({ ...s, ...patch }), sessionCookieOptions());
  } catch {
    /* cookies() unavailable outside a request */
  }
}

/** Write refreshed core JWT (and optional rotated refresh token) back into the session cookie. */
export function persistSessionTokens(
  s: SessionData,
  tokens: { jwt: string; jexp: number; rt?: string },
): void {
  try {
    const next: SessionData = {
      ...s,
      jwt: tokens.jwt,
      jexp: tokens.jexp,
      ...(tokens.rt ? { rt: tokens.rt } : {}),
    };
    cookies().set(SESSION_COOKIE, encodeSession(next), sessionCookieOptions());
  } catch {
    /* cookies() unavailable outside a request — in-memory cache still applies for this hop */
  }
}

/** Cookie options shared by login/logout writers. `secure` follows the actual request
 *  scheme (honoring x-forwarded-proto) so it works on https proxies and http localhost. */
export function sessionCookieOptions(req?: { url: string; headers: { get(name: string): string | null } }) {
  let secure = config.appBaseUrl.startsWith('https://');
  if (req) {
    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    secure = proto ? proto === 'https' : new URL(req.url).protocol === 'https:';
  }
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge: MAX_AGE_SEC };
}
