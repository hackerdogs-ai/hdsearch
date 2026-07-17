// Register a local dev-login user with hackerdogs-core so credit deduction works
// the same as Auth0 sign-in (core JWT in the session cookie).
import 'server-only';
import { jwtExp } from './auth';
import { config } from './config';

export interface DevCoreSession {
  jwt: string;
  jexp: number;
}

/** Best-effort: returns a core JWT for the dev user, or null if core is unreachable. */
export async function devRegisterCoreUser(user: {
  email: string;
  name: string;
}): Promise<DevCoreSession | null> {
  try {
    const res = await fetch(`${config.coreBaseUrl}/auth/register_or_get_user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        user: {
          email: user.email,
          full_name: user.name,
          auth_provider: 'dev',
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const jwt = typeof j?.jwt_token === 'string' ? j.jwt_token : null;
    if (!jwt) return null;
    return { jwt, jexp: jwtExp(jwt) };
  } catch {
    return null;
  }
}
