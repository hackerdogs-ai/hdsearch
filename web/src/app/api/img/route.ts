// Image proxy — fetches third-party result thumbnails/images server-side and
// streams them back from our own origin. This fixes broken images caused by
// upstream CDNs (e.g. imgs.search.brave.com) that rate-limit (429) or block
// hotlinking when the browser loads many of them directly. Responses are cached
// so repeats don't re-fetch. Same approach SerpAPI/Google use for result images.
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_BYTES = 8 * 1024 * 1024; // 8MB cap
// 1x1 transparent gif returned on any failure, so the <img> never shows broken.
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

function placeholder() {
  return new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: { 'content-type': 'image/gif', 'cache-control': 'public, max-age=300' },
  });
}

export async function GET(req: NextRequest) {
  const raw = new URL(req.url).searchParams.get('url');
  if (!raw) return placeholder();
  let target: URL;
  try {
    target = new URL(raw);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return placeholder();
  } catch {
    return placeholder();
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(target.toString(), {
      signal: ctrl.signal,
      // no Referer (avoid hotlink blocks), browser UA, accept images
      headers: { 'user-agent': UA, accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      redirect: 'follow',
    });
    if (!res.ok) return placeholder();
    const ct = res.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) return placeholder();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return placeholder();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'content-type': ct,
        // cache hard: result thumbnails are immutable for the session
        'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch {
    return placeholder();
  } finally {
    clearTimeout(t);
  }
}
