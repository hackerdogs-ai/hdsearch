import { NextRequest, NextResponse } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function PUT(req: NextRequest) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.provider || !body.secret) return NextResponse.json({ error: 'provider and secret required' }, { status: 400 });
  try {
    const r = await api.putProviderKey({ provider: body.provider, field: body.field || body.provider, secret: body.secret });
    return NextResponse.json(r);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
