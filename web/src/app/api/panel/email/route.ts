// BFF for the admin SMTP panel → /v1/admin/email (admin-gated API-side).
// The password is written straight through and stored encrypted; it is never read back.
import { NextRequest, NextResponse } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

function fail(e: unknown) {
  const status = e instanceof ApiError ? e.status : 500;
  return NextResponse.json({ error: (e as Error).message }, { status });
}

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await api.adminGetEmail());
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(req: NextRequest) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await api.adminSetEmail(body));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: NextRequest) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await api.adminTestEmail(body.to));
  } catch (e) {
    return fail(e);
  }
}
