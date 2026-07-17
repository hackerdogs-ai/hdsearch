// Public BFF passthrough for /v1/trends (search empty-state panel).
import { NextResponse } from 'next/server';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const res = await fetch(`${config.apiUrl}/v1/trends`, { cache: 'no-store' });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
