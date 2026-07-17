// BFF for sidebar folders: list + create.
import { NextRequest, NextResponse } from 'next/server';
import { apiCall, ApiError, rethrowIfRedirect } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sub = getSession()?.sub;
  if (!sub) return NextResponse.json({ folders: [], assignments: {} });
  const kind = req.nextUrl.searchParams.get('kind');
  try {
    const data = await apiCall(`/v1/folders${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`, { asUser: sub });
    return NextResponse.json(data);
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function POST(req: NextRequest) {
  const sub = getSession()?.sub;
  if (!sub) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const data = await apiCall('/v1/folders', { method: 'POST', body, asUser: sub });
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
