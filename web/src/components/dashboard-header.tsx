import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { ProfileMenu } from '@/components/profile-menu';
import { trySearchHref } from '@/lib/default-search-query';
import { api, ApiError, rethrowIfRedirect } from '@/lib/api';
import { PLAN_LABEL } from '@/lib/plans-static';
import type { SessionData } from '@/lib/session';

/** Account-backed chrome (role, plan) — streamed via Suspense so the shell paints first. */
export async function DashboardHeader({ user }: { user: SessionData }) {
  let role = 'user';
  let planLabel = PLAN_LABEL.free || 'Public 360';

  try {
    const acc = await api.account();
    role = acc?.role || 'user';
    const planId = acc?.plan?.id || 'free';
    planLabel = PLAN_LABEL[planId] || acc?.plan?.label || planId;
  } catch (e) {
    rethrowIfRedirect(e);
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) redirect('/api/auth/logout');
  }

  const searchHref = trySearchHref();

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <Brand />
      <div className="flex items-center gap-3">
        <Link href={searchHref} className="btn-ghost hidden sm:inline-flex">
          Try search
        </Link>
        <ProfileMenu
          name={user.name}
          email={user.email}
          picture={user.picture}
          role={role}
          plan={planLabel}
        />
      </div>
    </div>
  );
}

export function DashboardHeaderFallback({ user }: { user: SessionData }) {
  const searchHref = trySearchHref();
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <Brand />
      <div className="flex items-center gap-3">
        <Link href={searchHref} className="btn-ghost hidden sm:inline-flex">
          Try search
        </Link>
        <ProfileMenu name={user.name} email={user.email} picture={user.picture} plan={PLAN_LABEL.free || 'Public 360'} />
      </div>
    </div>
  );
}
