import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { api, ApiError } from '@/lib/api';
import { SystemDefaultKeys } from '@/components/system-default-keys';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const user = getSession();
  if (!user) redirect('/login');

  let acc: any = null;
  try {
    acc = await api.account();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/api/auth/logout');
  }

  const role = acc?.role || 'user';
  if (role !== 'admin') {
    return (
      <div className="card p-8 text-center">
        <h1 className="text-xl font-bold text-ink-900">Access Denied</h1>
        <p className="mt-2 text-sm text-ink-500">System Administration is restricted to super users.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">System Administration</h1>
        <p className="mt-1 text-sm text-ink-500">
          Manage default provider keys, plan-to-model mappings, and system-wide LLM configuration.
          Only super users can access this page.
        </p>
      </div>

      <SystemDefaultKeys />
    </div>
  );
}
