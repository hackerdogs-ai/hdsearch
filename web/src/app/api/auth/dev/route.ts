// POST /api/auth/dev — local dev login (only usable when Auth0 is NOT configured).
// Lets you run the whole product end-to-end without an Auth0 tenant.
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { config, SESSION_COOKIE } from '@/lib/config';
import { encodeSession, sessionCookieOptions, type SessionUser } from '@/lib/session';
import { appPath } from '@/lib/origin';
import { devRegisterCoreUser } from '@/lib/dev-core-auth';
import { POST_AUTH_LANDING_PATH } from '@/lib/routes';
import { apiCall } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Dev login is allowed only when explicitly enabled (on in dev, OFF in prod) — works even
  // when Auth0 is configured, so local dev runs before the Auth0 callback URL is registered.
  if (!config.devLoginEnabled) return NextResponse.redirect(appPath(req, '/login'));
  const form = await req.formData();
  const email = String(form.get('email') || 'dev@hackerdogs.ai').trim();
  const name = String(form.get('name') || 'Dev User').trim();
  const user: SessionUser = {
    sub: `dev|${email.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
    email,
    name,
    picture: `https://www.gravatar.com/avatar/${Buffer.from(email).toString('hex').slice(0, 32)}?d=identicon`,
    exp: 0,
  };
  let newApiKey: string | undefined;
  try {
    const res = await apiCall('/v1/account/profile', {
      method: 'PUT',
      user,
      body: { email: user.email, name: user.name, picture: user.picture },
    });
    if (res.apiKey) newApiKey = res.apiKey;
  } catch {
    /* ignore — API may be down */
  }

  const core = await devRegisterCoreUser({ email, name });

  cookies().set(
    SESSION_COOKIE,
    encodeSession({
      ...user,
      ...(core ? { jwt: core.jwt, jexp: core.jexp } : {}),
      ...(newApiKey ? { nk: newApiKey } : {}),
    }),
    sessionCookieOptions(req),
  );
  // to the request's browser-facing origin so it works on any host/port/proxy
  return NextResponse.redirect(appPath(req, POST_AUTH_LANDING_PATH));
}
