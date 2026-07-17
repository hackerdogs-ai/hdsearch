// BFF for server-side search history (signed-in users). GET lists the Redis 3-day
// history; DELETE clears it. Anonymous visitors get an empty server list and rely
// on the browser (localStorage) tier instead.
import { NextRequest, NextResponse } from 'next/server';
import { apiCall, ApiError, rethrowIfRedirect } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sub = getSession()?.sub;
  if (!sub) return NextResponse.json({ entries: [], tier: 'browser' });
  try {
    const data = await apiCall('/v1/history', { asUser: sub });
    return NextResponse.json(data);
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ entries: [], error: (e as Error).message }, { status });
  }
}

export async function DELETE() {
  const sub = getSession()?.sub;
  if (!sub) return NextResponse.json({ ok: true });
  try {
    await apiCall('/v1/history', { method: 'DELETE', asUser: sub });
    return NextResponse.json({ ok: true });
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
