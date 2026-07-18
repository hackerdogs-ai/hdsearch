import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { api, ApiError, rethrowIfRedirect } from '@/lib/api';

/** One account hop per request for dashboard chrome (header, nav). */
export const loadDashboardAccount = cache(async () => {
  try {
    const acc = await api.account();
    return { role: acc?.role || 'user' };
  } catch (e) {
    rethrowIfRedirect(e);
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) redirect('/api/auth/logout');
    throw e;
  }
});
