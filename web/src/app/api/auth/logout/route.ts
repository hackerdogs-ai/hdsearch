// GET /api/auth/logout — clear the local session cookie and return home.
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/config';
import { appPath } from '@/lib/origin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  cookies().delete(SESSION_COOKIE);
  // back to home on the same origin the user is on (not a hardcoded base URL)
  return NextResponse.redirect(appPath(req, '/'));
}
