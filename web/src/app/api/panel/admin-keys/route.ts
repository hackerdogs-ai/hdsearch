import { NextRequest, NextResponse } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const r = await api.adminDefaultKeys();
    return NextResponse.json(r);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function PUT(req: NextRequest) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.provider || !body.field || !body.planId || !body.secret) {
    return NextResponse.json({ error: 'provider, field, planId, and secret required' }, { status: 400 });
  }
  try {
    const r = await api.adminPutDefaultKey(body);
    return NextResponse.json(r);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.field || !body.planId) {
    return NextResponse.json({ error: 'field and planId required' }, { status: 400 });
  }
  try {
    const r = await api.adminDeleteDefaultKey(body);
    return NextResponse.json(r);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
