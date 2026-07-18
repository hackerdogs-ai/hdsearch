// BFF for admin result-cache TTL policy → /v1/admin/cache-ttl (admin-gated API-side).
import { NextRequest, NextResponse } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await api.adminGetCacheTtl());
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function PUT(req: NextRequest) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const defaultSec = Number(body.defaultSec);
  const maxSec = Number(body.maxSec);
  if (!Number.isFinite(defaultSec) || !Number.isFinite(maxSec)) {
    return NextResponse.json({ error: 'defaultSec and maxSec (numbers) required' }, { status: 400 });
  }
  try {
    return NextResponse.json(await api.adminSetCacheTtl({ defaultSec, maxSec }));
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message, message: (e as Error).message }, { status });
  }
}
