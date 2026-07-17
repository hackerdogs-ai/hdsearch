import { NextRequest, NextResponse } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const r = await api.revokeApiKey(params.id);
    return NextResponse.json(r);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
