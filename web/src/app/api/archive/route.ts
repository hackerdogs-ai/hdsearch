// BFF archive proxy — renders or extracts a Common Crawl capture (the archived
// page, not the live site). `view=html` streams the archived HTML so the result
// link opens the snapshot; otherwise returns JSON { markdown, … } for the
// "Extract" action on archive results. The WARC locator (filename/offset/length)
// is carried from the search result so no extra CDX lookup is needed.
import { NextRequest, NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

const PASS = ['url', 'ts', 'filename', 'offset', 'length', 'provider'];

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const url = sp.get('url');
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });
  const view = sp.get('view') === 'html';
  const sub = getSession()?.sub || 'public-demo';

  const qs = new URLSearchParams();
  for (const k of PASS) {
    const v = sp.get(k);
    if (v) qs.set(k, v);
  }
  if (view) qs.set('format', 'html');

  const headers: Record<string, string> = { 'x-hd-user': sub };
  if (config.internalSecret) headers['x-hd-internal'] = config.internalSecret;

  try {
    const upstream = await fetch(`${config.apiUrl}/v1/archive?${qs.toString()}`, { headers, cache: 'no-store' });
    if (view) {
      if (!upstream.ok) {
        return new NextResponse(
          `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:2rem;color:#475569">` +
            `<h3>Archived capture unavailable</h3><p>Common Crawl couldn’t return this capture (HTTP ${upstream.status}).</p>` +
            `<p><a href="${url}">Open the live page →</a></p></body>`,
          { status: 502, headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
      const html = await upstream.text();
      return new NextResponse(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, max-age=600' },
      });
    }
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
