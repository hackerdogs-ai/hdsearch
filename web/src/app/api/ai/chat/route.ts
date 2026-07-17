// BFF for AI Mode — streams the SSE answer from the hd-search API to the browser as
// the logged-in user (same auth path as every other BFF call), so provider keys resolve
// to the same identity as /api/ai/models.
import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { buildApiAuthHeaders, ApiError } from '@/lib/api';
import { getSession } from '@/lib/session';
import { rethrowIfRedirect } from '@/lib/navigation-error';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = getSession();
  if (!session && config.signInRequiredForAi) {
    return NextResponse.json({ error: 'unauthorized', message: 'Sign in to use AI Search' }, { status: 401 });
  }

  const effectiveSession = session ?? { sub: 'public-demo', exp: 0 };

  let headers: Record<string, string>;
  try {
    headers = await buildApiAuthHeaders(effectiveSession);
  } catch (e) {
    rethrowIfRedirect(e);
    if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const body = await req.text();

  try {
    const upstream = await fetch(`${config.apiUrl}/v1/ai/chat`, { method: 'POST', headers, body, cache: 'no-store' });
    if (!upstream.ok || !upstream.body) {
      const txt = await upstream.text().catch(() => '');
      let message = txt || `AI upstream ${upstream.status}`;
      try {
        const j = JSON.parse(txt);
        message = j.message || j.error || message;
      } catch {
        /* raw text */
      }
      return NextResponse.json({ error: message }, { status: upstream.status || 502 });
    }
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
