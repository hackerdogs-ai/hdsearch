// BFF: list AI Mode models (+ availability for the current user) for the model picker.
import { NextResponse } from 'next/server';
import { apiCall, ApiError, rethrowIfRedirect } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = getSession();
  const catalog = new URL(req.url).searchParams.get('catalog');
  const qs = catalog === '1' || catalog === 'true' ? '?catalog=1' : '';
  try {
    const data = await apiCall(`/v1/ai/models${qs}`, { asUser: session?.sub || 'public-demo' });
    return NextResponse.json(data);
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 502;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
