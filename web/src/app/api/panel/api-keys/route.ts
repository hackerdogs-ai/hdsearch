// BFF: create an API key for the logged-in user. The browser never sees the
// internal secret — this server route injects it via the api lib.
import { NextRequest, NextResponse } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const r = await api.createApiKey({ name: body.name || 'api key', scopes: body.scopes });
    return NextResponse.json(r);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
