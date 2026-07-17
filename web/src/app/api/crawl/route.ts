// BFF crawl proxy — lets the open-search result actions turn any URL into clean
// markdown, a full-page screenshot, or a PDF via the API's crawl engines
// (crawl4ai/browserless/…), as the logged-in user or the shared public-demo identity.
import { NextRequest, NextResponse } from 'next/server';
import { apiCall, ApiError } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

const FORMATS = { markdown: 'markdown', screenshot: 'screenshot', pdf: 'pdf' } as const;
type Fmt = keyof typeof FORMATS;

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const url = sp.get('url');
  const format = (sp.get('format') || 'markdown') as Fmt;
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 });
  if (!FORMATS[format]) return NextResponse.json({ error: 'bad format' }, { status: 400 });
  const sub = getSession()?.sub || 'public-demo';
  try {
    const resp = await apiCall('/v1/crawl', {
      method: 'POST',
      asUser: sub,
      body: { url, formats: [format] },
    });
    const r = resp.result || {};
    if (format === 'screenshot') {
      if (!r.screenshot) return NextResponse.json({ error: 'no screenshot returned', source: r.source }, { status: 502 });
      return NextResponse.json({ url, source: r.source, title: r.title, screenshot: r.screenshot });
    }
    if (format === 'pdf') {
      if (!r.pdf) return NextResponse.json({ error: 'no pdf returned', source: r.source }, { status: 502 });
      return NextResponse.json({ url, source: r.source, title: r.title, pdf: r.pdf });
    }
    return NextResponse.json({
      url,
      source: r.source,
      title: r.title,
      markdown: (r.markdown || '').slice(0, 6000),
      truncated: (r.markdown || '').length > 6000,
    });
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
