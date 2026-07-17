// Server-only configuration. Never import this into a client component.
import 'server-only';
import { readSharedSecret, getOrCreateSecret } from './secrets';

export const config = {
  // hd-search API (BFF target). In docker this is the container name.
  apiUrl: (process.env.HDSEARCH_API_URL || 'http://127.0.0.1:8791').replace(/\/$/, ''),
  // shared secret the API trusts for first-party calls (X-HD-Internal). Falls back
  // to the shared secrets file the API auto-generates, so they match out of the box.
  internalSecret: process.env.HDSEARCH_INTERNAL_SECRET || readSharedSecret('internalSecret'),
  // cookie signing secret (env → shared file → generated)
  sessionSecret: process.env.HDSEARCH_WEB_SESSION_SECRET || getOrCreateSecret('webSessionSecret'),
  appBaseUrl: (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  // hackerdogs-core API base — for /auth/token-exchange + /auth/me (the SSO bridge).
  coreBaseUrl: (process.env.HD_CORE_BASE_URL || 'http://localhost:8000').replace(/\/$/, ''),
  // local dev login (no Auth0): on by default in dev, OFF in production unless forced.
  devLoginEnabled: /^(1|true|yes|on)$/i.test(process.env.HDSEARCH_DEV_LOGIN || (process.env.NODE_ENV !== 'production' ? '1' : '0')),
  // When false, AI Search works without sign-in (uses public-demo identity).
  signInRequiredForAi: !/^(0|false|no|off)$/i.test(process.env.SIGN_IN_REQUIRED_FOR_AI || 'true'),

  // Auth0 — Authorization Code + PKCE (no client secret required; the same SPA client
  // worldmonitor uses works). clientSecret stays optional (confidential clients only).
  auth0: {
    domain: process.env.AUTH0_DOMAIN || '',
    clientId: process.env.AUTH0_CLIENT_ID || '',
    clientSecret: process.env.AUTH0_CLIENT_SECRET || '',
    audience: process.env.AUTH0_AUDIENCE || '',
  },
};

/** True when a real Auth0 tenant is configured (PKCE needs only domain + clientId). */
export function auth0Configured(): boolean {
  return !!(config.auth0.domain && config.auth0.clientId);
}

export const SESSION_COOKIE = 'hd_session';
export const OAUTH_STATE_COOKIE = 'hd_oauth_state';
export const PKCE_COOKIE = 'hd_pkce';
