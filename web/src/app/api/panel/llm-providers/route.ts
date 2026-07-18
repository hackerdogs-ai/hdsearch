// BFF: LLM provider registry → /v1/admin/llm-providers (admin-gated API-side).
// Custom providers are persisted in Postgres (llm_providers, source='admin').
import { NextRequest, NextResponse } from 'next/server';
import { api, ApiError } from '@/lib/api';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await api.adminLlmProviders());
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}

export async function POST(req: NextRequest) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.id || !body.name || !body.baseUrl) {
    return NextResponse.json({ error: 'id, name, and baseUrl are required' }, { status: 400 });
  }
  try {
    return NextResponse.json(await api.adminUpsertProvider(body));
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
