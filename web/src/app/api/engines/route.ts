import { NextRequest, NextResponse } from 'next/server';
import { apiCall, ApiError, rethrowIfRedirect } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

const MODALITIES = ['web', 'news', 'images', 'videos', 'maps', 'scholar', 'places', 'shopping', 'code', 'social', 'archive', 'darkweb'];

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const modality = MODALITIES.includes(sp.get('modality') || '') ? sp.get('modality')! : 'web';
  const sub = getSession()?.sub || 'public-demo';

  try {
    const resp = await apiCall(`/v1/engines?modality=${encodeURIComponent(modality)}&category=search`, {
      method: 'GET',
      asUser: sub,
    });
    return NextResponse.json(resp);
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message, engines: [] }, { status });
  }
}
