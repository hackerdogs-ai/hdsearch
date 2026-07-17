// POST /api/auth/local — local email+password auth (the open-source path, no Auth0).
// Handles both first-run admin setup (mode=register) and normal sign-in (mode=login):
// calls the hd-search API's public /v1/auth endpoints, and on success writes the same
// encrypted session cookie the Auth0/dev paths use. See docs/OPEN_SOURCE_MIGRATION.md.
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { config, SESSION_COOKIE } from '@/lib/config';
import { encodeSession, sessionCookieOptions, type SessionUser } from '@/lib/session';
import { appPath } from '@/lib/origin';
import { POST_AUTH_LANDING_PATH } from '@/lib/routes';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const mode = String(form.get('mode') || 'login') === 'register' ? 'register' : 'login';
  const email = String(form.get('email') || '').trim();
  const name = String(form.get('name') || '').trim();
  const password = String(form.get('password') || '');

  if (!email || !password) {
    return NextResponse.redirect(appPath(req, '/login?error=missing_fields'), { status: 303 });
  }

  const body = mode === 'register' ? { email, name, password } : { email, password };
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}/v1/auth/${mode}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.redirect(appPath(req, '/login?error=api_unreachable'), { status: 303 });
  }

  const data = await res.json().catch(() => ({}) as any);
  if (!res.ok || !data?.user?.sub) {
    const code = data?.error || `http_${res.status}`;
    return NextResponse.redirect(appPath(req, `/login?error=${encodeURIComponent(code)}`), { status: 303 });
  }

  const u = data.user;
  const user: SessionUser = {
    sub: u.sub,
    email: u.email,
    name: u.name,
    picture: u.picture,
    exp: 0,
  };
  cookies().set(
    SESSION_COOKIE,
    encodeSession({ ...user, ...(data.apiKey ? { nk: data.apiKey } : {}) }),
    sessionCookieOptions(req),
  );
  return NextResponse.redirect(appPath(req, POST_AUTH_LANDING_PATH), { status: 303 });
}
