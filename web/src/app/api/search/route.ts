// BFF search proxy for client-side infinite scroll. The browser fetches
// subsequent pages from here; this route calls the hd-search API server-side
// (as the logged-in user, or a shared public-demo identity for anonymous home
// search) so the API key/secret never reaches the browser.
import { NextRequest, NextResponse } from 'next/server';
import { apiCall, ApiError, rethrowIfRedirect } from '@/lib/api';
import { getSession } from '@/lib/session';

import { parseSearchDepth, searchDepthToMode } from '@/lib/search-depth';

export const dynamic = 'force-dynamic';
/** High/Medium aggregate search can fan out to several engines (~6s+). */
export const maxDuration = 60;

const MODALITIES = ['web', 'news', 'images', 'videos', 'maps', 'scholar', 'places', 'shopping', 'code', 'social', 'archive', 'darkweb'];

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const q = (sp.get('q') || '').trim();
  if (!q) return NextResponse.json({ results: [], total: 0 });
  const modality = MODALITIES.includes(sp.get('modality') || '') ? sp.get('modality') : 'web';
  const page = Math.max(1, Number(sp.get('page') || 1));
  const depth = parseSearchDepth(sp.get('depth') || sp.get('searchDepth'));
  const mode = sp.get('mode') === 'aggregate' ? 'aggregate' : searchDepthToMode(depth);
  const engine = sp.get('engine') || undefined;
  const temporary = sp.get('temporary') === '1' || sp.get('temporary') === 'true';
  const sub = getSession()?.sub || 'public-demo';

  try {
    const resp = await apiCall('/v1/search', {
      method: 'POST',
      asUser: sub,
      body: {
        q,
        modality,
        mode,
        searchDepth: depth,
        engine,
        temporary,
        limit: 20,
        page,
        facets: page === 1,
      },
    });
    return NextResponse.json({
      results: resp.results || [],
      facets: resp.facets || [],
      total: resp.total || 0,
      enginesUsed: resp.enginesUsed || [],
      tookMs: resp.tookMs || 0,
    });
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message, results: [] }, { status });
  }
}
