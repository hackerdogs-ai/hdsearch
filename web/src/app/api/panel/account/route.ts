import { NextRequest, NextResponse } from 'next/server';
import { api, ApiError, rethrowIfRedirect } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Usage (+ optional credits) for the quota warning banner background refresh. */
export async function GET(req: NextRequest) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const includeCredits = req.nextUrl.searchParams.get('credits') === '1';
  try {
    const acc = await api.account();
    const body: Record<string, unknown> = {
      usage: {
        total: acc.usage?.total ?? 0,
        quota: acc.usage?.quota ?? null,
      },
      credits: null,
    };
    if (includeCredits) {
      const creditsResp = await api.credits().catch(() => null);
      body.credits = creditsResp?.balance ?? null;
    }
    return NextResponse.json(body);
  } catch (e) {
    rethrowIfRedirect(e);
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
