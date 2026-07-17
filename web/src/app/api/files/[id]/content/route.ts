// BFF: stream a file's raw bytes back to the browser (access-checked upstream).
import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { buildApiAuthHeaders, ApiError, rethrowIfRedirect } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session?.sub) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  let headers: Record<string, string>;
  try {
    headers = await buildApiAuthHeaders(session);
  } catch (e) {
    rethrowIfRedirect(e);
    if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  try {
    const upstream = await fetch(`${config.apiUrl}/v1/files/${encodeURIComponent(params.id)}/content`, {
      headers,
      cache: 'no-store',
    });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: 'not_found' }, { status: upstream.status || 404 });
    }
    const out = new Headers();
    out.set('content-type', upstream.headers.get('content-type') || 'application/octet-stream');
    const cd = upstream.headers.get('content-disposition');
    if (cd) out.set('content-disposition', cd);
    const len = upstream.headers.get('content-length');
    if (len) out.set('content-length', len);
    return new NextResponse(upstream.body, { status: 200, headers: out });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
