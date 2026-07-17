// BFF: lightweight processing-status poll for the composer.
import { NextRequest, NextResponse } from 'next/server';
import { apiCall, ApiError, rethrowIfRedirect } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sub = getSession()?.sub;
  if (!sub) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  try {
    const data = await apiCall(`/v1/files/${encodeURIComponent(params.id)}/status`, { asUser: sub });
    return NextResponse.json(data);
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
