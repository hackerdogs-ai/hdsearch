import { NextRequest, NextResponse } from 'next/server';
import { apiCall, ApiError, rethrowIfRedirect } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await apiCall('/v1/engines/prefs'));
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function PUT(req: NextRequest) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await apiCall('/v1/engines/prefs', { method: 'PUT', body }));
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
