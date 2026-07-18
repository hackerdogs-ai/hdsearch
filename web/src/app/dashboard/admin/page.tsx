import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { api, ApiError } from '@/lib/api';
import { SystemDefaultKeys } from '@/components/system-default-keys';
import { SignupPolicy } from '@/components/signup-policy';
import { CacheTtlPolicy } from '@/components/cache-ttl-policy';
import { ProviderRegistryManager } from '@/components/provider-registry-manager';
import { ModelRegistryManager } from '@/components/model-registry-manager';

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
        <p className="mt-2 text-sm text-ink-500">System Administration is restricted to administrators.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">System Administration</h1>
        <p className="mt-1 text-sm text-ink-500">
          Manage system-wide default provider keys. Only administrators can access this page.
        </p>
      </div>

      <SignupPolicy />

      <CacheTtlPolicy />

      <ProviderRegistryManager />

      <ModelRegistryManager />

      <a
        href="/dashboard/admin/infrastructure"
        className="flex items-center justify-between rounded-lg border border-ink-100 bg-white px-4 py-3 hover:border-brand-300"
      >
        <span>
          <span className="block text-sm font-semibold text-ink-900">Infrastructure endpoints</span>
          <span className="block text-sm text-ink-500">Edit datastore & provider connections set during first-run setup.</span>
        </span>
        <span className="text-ink-400">→</span>
      </a>

      <SystemDefaultKeys />
    </div>
  );
}
