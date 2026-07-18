import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { ProfileMenu } from '@/components/profile-menu';
import { trySearchHref } from '@/lib/default-search-query';
import { api, ApiError, rethrowIfRedirect } from '@/lib/api';
import type { SessionData } from '@/lib/session';

/** Account-backed chrome (role) — streamed via Suspense so the shell paints first. */
export async function DashboardHeader({ user }: { user: SessionData }) {
  let role = 'user';

  try {
    const acc = await api.account();
    role = acc?.role || 'user';
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
          Start Searching
        </Link>
        <ProfileMenu
          name={user.name}
          email={user.email}
          picture={user.picture}
          role={role}
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
          Start Searching
        </Link>
        <ProfileMenu name={user.name} email={user.email} picture={user.picture} />
      </div>
    </div>
  );
}
