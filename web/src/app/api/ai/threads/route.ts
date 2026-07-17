// BFF for AI thread persistence. GET lists the user's Redis-tier thread index for
// the sidebar; DELETE wipes the whole set (account clear). Anonymous users get
// empty responses and rely on the local/session-storage tier instead.
import { NextResponse } from 'next/server';
import { apiCall, ApiError, rethrowIfRedirect } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sub = getSession()?.sub;
  if (!sub) return NextResponse.json({ entries: [], tier: 'browser' });
  try {
    const data = await apiCall('/v1/ai/threads', { asUser: sub });
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
    await apiCall('/v1/ai/threads', { method: 'DELETE', asUser: sub });
    return NextResponse.json({ ok: true });
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
