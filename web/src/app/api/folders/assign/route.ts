// BFF: assign / clear a chat thread's folder.
import { NextRequest, NextResponse } from 'next/server';
import { apiCall, ApiError, rethrowIfRedirect } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const sub = getSession()?.sub;
  if (!sub) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const data = await apiCall('/v1/folders/assign', { method: 'POST', body, asUser: sub });
    return NextResponse.json(data);
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
