// BFF for a single AI thread. GET returns the full blob for sidebar-driven
// restore; PATCH renames; DELETE removes both index entry and body.
import { NextRequest, NextResponse } from 'next/server';
import { apiCall, ApiError, rethrowIfRedirect } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sub = getSession()?.sub;
  if (!sub) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  try {
    const data = await apiCall(`/v1/ai/threads/${encodeURIComponent(params.id)}`, { asUser: sub });
    return NextResponse.json(data);
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sub = getSession()?.sub;
  if (!sub) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const data = await apiCall(`/v1/ai/threads/${encodeURIComponent(params.id)}`, {
      method: 'PATCH',
      body,
      asUser: sub,
    });
    return NextResponse.json(data);
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const sub = getSession()?.sub;
  if (!sub) return NextResponse.json({ ok: true });
  try {
    await apiCall(`/v1/ai/threads/${encodeURIComponent(params.id)}`, {
      method: 'DELETE',
      asUser: sub,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
