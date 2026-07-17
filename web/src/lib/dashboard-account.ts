import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { api, ApiError, rethrowIfRedirect } from '@/lib/api';
import { PLAN_LABEL } from '@/lib/plans-static';
import type { QuotaBannerSnapshot } from '@/lib/quota-warning';

/** One account hop per request for dashboard chrome (header, nav, quota strip). */
export const loadDashboardAccount = cache(async () => {
  try {
    const acc = await api.account();
    const snapshot: QuotaBannerSnapshot = {
      usage: {
        total: acc.usage?.total ?? 0,
        quota: acc.usage?.quota ?? null,
      },
      credits: null,
    };
    const planId = acc?.plan?.id || 'free';
    return {
      role: acc?.role || 'user',
      plan: PLAN_LABEL[planId] || acc?.plan?.label || planId,
      snapshot,
    };
  } catch (e) {
    rethrowIfRedirect(e);
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) redirect('/api/auth/logout');
    throw e;
  }
});
