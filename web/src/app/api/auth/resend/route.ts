// POST /api/auth/resend — resend the Auth0 verification email via hackerdogs-core.
// Uses the signed-in (but unverified) user's core JWT as the Bearer.
import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { getSession } from '@/lib/session';
import { validCoreJwt } from '@/lib/session-jwt';

export const dynamic = 'force-dynamic';

export async function POST() {
  const s = getSession();
  if (!s?.jwt) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  const jwt = await validCoreJwt(s);
  if (!jwt) return NextResponse.json({ error: 'session expired' }, { status: 401 });
  try {
    const returnTo = `${config.appBaseUrl}/api/auth/verified`;
    const res = await fetch(`${config.coreBaseUrl}/auth/resend-activation-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ email: s.email, return_to: returnTo }),
    });
    if (!res.ok) return NextResponse.json({ error: `core ${res.status}` }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
