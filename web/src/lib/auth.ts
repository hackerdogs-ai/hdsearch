// Auth0 Authorization Code + PKCE for the BFF, bridged to hackerdogs-core. The browser
// never holds tokens: the server runs the code flow (PKCE — no client secret needed, same
// SPA client as worldmonitor), exchanges the Auth0 id_token at core /auth/token-exchange for
// the Hackerdogs JWT, and keeps everything in an encrypted httpOnly cookie. Refresh uses the
// Auth0 refresh token. See docs/AUTH_PLAN_INTEGRATION.md.
import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { config } from './config';

const REDIRECT = () => `${config.appBaseUrl}/api/auth/callback`;
const SCOPE = 'openid profile email offline_access'; // offline_access → refresh token

export interface IdClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  nickname?: string;
  picture?: string;
}

// ---- PKCE ----
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
export function newState(): string {
  return randomBytes(16).toString('hex');
}

export function authorizeUrl(state: string, codeChallenge: string, connection?: string): string {
  const u = new URL(`https://${config.auth0.domain}/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', config.auth0.clientId);
  u.searchParams.set('redirect_uri', REDIRECT());
  u.searchParams.set('scope', SCOPE);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (config.auth0.audience) u.searchParams.set('audience', config.auth0.audience);
  if (connection) u.searchParams.set('connection', connection);
  return u.toString();
}

export function logoutUrl(): string {
  const u = new URL(`https://${config.auth0.domain}/v2/logout`);
  u.searchParams.set('client_id', config.auth0.clientId);
  u.searchParams.set('returnTo', config.appBaseUrl);
  return u.toString();
}

interface Auth0Tokens {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
}

/** PKCE token exchange (no client secret unless a confidential client is configured). */
export async function exchangeCode(code: string, verifier: string): Promise<{ tokens: Auth0Tokens; claims: IdClaims }> {
  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    client_id: config.auth0.clientId,
    code,
    code_verifier: verifier,
    redirect_uri: REDIRECT(),
  };
  if (config.auth0.clientSecret) body.client_secret = config.auth0.clientSecret;
  const tokens = await tokenRequest(body);
  const claims = claimsFrom(tokens);
  if (!claims) throw new Error('no identity returned from Auth0');
  return { tokens, claims };
}

/** Refresh the Auth0 session (rotating refresh token) → fresh id_token. */
export async function refreshAuth0(refreshToken: string): Promise<Auth0Tokens> {
  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    client_id: config.auth0.clientId,
    refresh_token: refreshToken,
  };
  if (config.auth0.clientSecret) body.client_secret = config.auth0.clientSecret;
  return tokenRequest(body);
}

/** Exchange an Auth0 id_token at hackerdogs-core for the Hackerdogs JWT (+ identity). */
export async function coreTokenExchange(idToken: string): Promise<{ jwt: string; jexp: number; user: any }> {
  // Core register_or_get_user can take 10–20s when PgBouncer/DB is slow (plan + subscription lookups).
  const res = await fetch(`${config.coreBaseUrl}/auth/token-exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ auth0_token: idToken }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`core token-exchange failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const j: any = await res.json();
  const jwt = j.access_token;
  if (!jwt) throw new Error('core token-exchange returned no access_token');
  return { jwt, jexp: jwtExp(jwt), user: j.user };
}

/**
 * Whether the user is verified, per the AUTHORITATIVE core flag `is_active` (set when the
 * user clicks the activation link — shared across WM/Streamlit/hd-search). Falls back to the
 * Auth0 `email_verified` claim only when core doesn't report is_active. So a user who verified
 * on worldmonitor (is_active=true) is NOT re-gated on hd-search.
 */
export function isVerified(user: any, claims?: IdClaims): boolean {
  if (user && typeof user.is_active === 'boolean') return user.is_active;
  if (user && typeof user.email_verified === 'boolean') return user.email_verified;
  return claims ? claims.email_verified !== false : true;
}

// ---- helpers ----
async function tokenRequest(body: Record<string, string>): Promise<Auth0Tokens> {
  const res = await fetch(`https://${config.auth0.domain}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`auth0 token request failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return (await res.json()) as Auth0Tokens;
}

function claimsFrom(tokens: Auth0Tokens): IdClaims | null {
  if (tokens.id_token) {
    const c = decodeJwtPayload(tokens.id_token);
    if (c?.sub) return c as IdClaims;
  }
  return null;
}

/** Expiry (unix sec) of a JWT, or now+10min if absent. The token comes directly from the
 *  token endpoint over TLS, so we read claims without re-verifying here; the API
 *  re-verifies the core JWT's signature on every request. */
export function jwtExp(jwt: string): number {
  const p = decodeJwtPayload(jwt);
  return typeof p?.exp === 'number' ? p.exp : Math.floor(Date.now() / 1000) + 600;
}

/** Extract the `sub` claim (core user ID) from a core JWT. */
export function jwtSubject(jwt: string): string | null {
  const p = decodeJwtPayload(jwt);
  return typeof p?.sub === 'string' ? p.sub : null;
}

function decodeJwtPayload(jwt: string): Record<string, any> | null {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
