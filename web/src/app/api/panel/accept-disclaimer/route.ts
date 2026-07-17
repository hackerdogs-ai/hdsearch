// POST /api/panel/accept-disclaimer — record acceptance to hackerdogs-core (shared with
// WM/Streamlit via DISCLAIMER_AGREED) and mirror into hd-search's own store.
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { recordDisclaimerEverywhere } from '@/lib/core-settings';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const s = getSession();
  if (!s) return NextResponse.json({ error: 'not authenticated' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const termsVersion = typeof body?.termsVersion === 'string' ? body.termsVersion : undefined;
  await recordDisclaimerEverywhere(s, termsVersion);
  return NextResponse.json({ accepted: true, termsVersion: termsVersion ?? null });
}
