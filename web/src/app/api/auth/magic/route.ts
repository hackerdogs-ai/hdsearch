// GET /api/auth/magic?token=… — redeem an emailed sign-in link and start a session.
// Mirrors /api/auth/local: the API verifies the token and returns the identity;
// the BFF turns that into the same encrypted session cookie every other path uses.
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { config, SESSION_COOKIE } from '@/lib/config';
import { encodeSession, sessionCookieOptions, type SessionUser } from '@/lib/session';
import { appPath } from '@/lib/origin';
import { POST_AUTH_LANDING_PATH } from '@/lib/routes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || '';
  if (!token) return NextResponse.redirect(appPath(req, '/login?error=invalid_token'), { status: 303 });

  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}/v1/auth/magic-verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.redirect(appPath(req, '/login?error=api_unreachable'), { status: 303 });
  }

  const data = await res.json().catch(() => ({}) as any);
  if (!res.ok || !data?.user?.sub) {
    return NextResponse.redirect(appPath(req, '/login?error=invalid_token'), { status: 303 });
  }

  const u = data.user;
  const user: SessionUser = { sub: u.sub, email: u.email, name: u.name, picture: u.picture, exp: 0 };
  cookies().set(SESSION_COOKIE, encodeSession(user), sessionCookieOptions(req));
  return NextResponse.redirect(appPath(req, POST_AUTH_LANDING_PATH), { status: 303 });
}
