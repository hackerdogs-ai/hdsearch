// Public password-recovery proxies. `action` selects the API endpoint:
//   forgot  → email a reset link      reset → redeem a link and set a new password
//   magic   → email a sign-in link
// These are unauthenticated by design; the API rate-limits them and never reveals
// whether an address is registered.
import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

const ROUTES: Record<string, string> = {
  forgot: '/v1/auth/forgot-password',
  reset: '/v1/auth/reset-password',
  magic: '/v1/auth/magic-link',
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const path = ROUTES[String(body.action || '')];
  if (!path) return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  const { action, ...payload } = body;
  void action;
  try {
    const r = await fetch(`${config.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    return NextResponse.json(await r.json().catch(() => ({})), { status: r.status });
  } catch (e) {
    return NextResponse.json({ error: 'api_unreachable', message: (e as Error).message }, { status: 502 });
  }
}
