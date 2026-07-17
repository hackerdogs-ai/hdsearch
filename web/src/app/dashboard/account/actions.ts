'use server';

import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/config';
import { getSession, encodeSession, sessionCookieOptions } from '@/lib/session';

export async function clearNewApiKey() {
  const session = getSession();
  if (!session?.nk) return;
  const { nk: _, ...rest } = session;
  cookies().set(SESSION_COOKIE, encodeSession(rest), sessionCookieOptions());
}
