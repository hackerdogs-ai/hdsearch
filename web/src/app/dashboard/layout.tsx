import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { DashboardHeader, DashboardHeaderFallback } from '@/components/dashboard-header';
import { DashboardNavFallback, DashboardNavGate } from '@/components/dashboard-nav-gate';
import { getSession } from '@/lib/session';
import { ensureDisclaimerGate } from '@/lib/disclaimer-gate';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = getSession();
  if (!user) redirect('/login');
  if (user.ev === false) redirect('/verify-email');
  await ensureDisclaimerGate(user);

  return (
    <div className="min-h-screen bg-ink-50">
      <div className="sticky top-0 z-20 border-b border-ink-100 bg-white">
        <Suspense fallback={<DashboardHeaderFallback user={user} />}>
          <DashboardHeader user={user} />
        </Suspense>
      </div>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <aside className="hidden w-60 shrink-0 lg:block">
          <Suspense fallback={<DashboardNavFallback />}>
            <DashboardNavGate />
          </Suspense>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
