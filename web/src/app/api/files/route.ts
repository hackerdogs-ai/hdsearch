// BFF for file upload/list/delete. POST streams the multipart body straight to the
// hd-search API (no buffering in Next). GET/DELETE proxy as the logged-in user.
import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { apiCall, ApiError, buildApiAuthHeaders, rethrowIfRedirect } from '@/lib/api';
import { getSession } from '@/lib/session';
import { FILE_MAX_BYTES } from '@/lib/files-shared';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = getSession();
  if (!session?.sub) return NextResponse.json({ error: 'unauthorized', message: 'Sign in to upload files' }, { status: 401 });

  // Cheap early reject before we stream 200 MB upstream.
  const cl = Number(req.headers.get('content-length') || 0);
  if (cl && cl > FILE_MAX_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: 'file_too_large', maxBytes: FILE_MAX_BYTES }, { status: 413 });
  }

  let headers: Record<string, string>;
  try {
    headers = await buildApiAuthHeaders(session);
  } catch (e) {
    rethrowIfRedirect(e);
    if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  // Forward the browser's multipart content-type (with boundary), not JSON.
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  else delete headers['content-type'];

  try {
    const init = { method: 'POST', headers, body: req.body, cache: 'no-store', duplex: 'half' } as RequestInit & { duplex: 'half' };
    const upstream = await fetch(`${config.apiUrl}/v1/files`, init);
    const text = await upstream.text();
    return new NextResponse(text || '{}', {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const sub = getSession()?.sub;
  if (!sub) return NextResponse.json({ files: [] });
  const threadId = req.nextUrl.searchParams.get('threadId');
  try {
    const data = await apiCall(`/v1/files${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ''}`, { asUser: sub });
    return NextResponse.json(data);
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  const sub = getSession()?.sub;
  if (!sub) return NextResponse.json({ ok: true });
  const threadId = req.nextUrl.searchParams.get('threadId');
  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });
  try {
    await apiCall(`/v1/files?threadId=${encodeURIComponent(threadId)}`, { method: 'DELETE', asUser: sub });
    return NextResponse.json({ ok: true });
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
