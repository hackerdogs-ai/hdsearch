import { api, ApiError, rethrowIfRedirect } from '@/lib/api';
import { getSession } from '@/lib/session';
import { ApiKeysManager } from '@/components/api-keys-manager';
import { CacheTtlSettings } from '@/components/cache-ttl-settings';
import { ProviderKeysManager } from '@/components/provider-keys-manager';

export async function AccountKeysSection({
  keysCategory,
}: {
  keysCategory: 'search' | 'llm';
}) {
  const user = getSession();
  let apiKeys: any[] = [];
  let providerKeys: any[] = [];
  let encryptionAvailable = false;
  let searchProviders: { id: string; label: string; requiresKeys: string[] }[] = [];
  let llmProviders: { id: string; label: string; requiresKeys: string[] }[] = [];
  let errors: string[] = [];

  await Promise.all([
    api.apiKeys().then((r) => (apiKeys = r.keys || [])).catch((e) => {
      rethrowIfRedirect(e);
      errors.push(`keys: ${(e as ApiError).message}`);
    }),
    api.providerKeys().then((r) => {
      providerKeys = r.keys || [];
      encryptionAvailable = !!r.encryptionAvailable;
    }).catch((e) => {
      rethrowIfRedirect(e);
      errors.push(`provider keys: ${(e as ApiError).message}`);
    }),
    api.engines().then((r) => {
      searchProviders = (r.engines || [])
        .filter((e: any) => e.requiresKeys?.length > 0)
        .map((e: any) => ({ id: e.id, label: e.label, requiresKeys: e.requiresKeys }));
    }).catch(() => {}),
    api.aiProviders().then((r) => {
      llmProviders = (r.providers || []).map((p: any) => ({
        id: p.id,
        label: p.label,
        requiresKeys: p.requiresKeys || [],
      }));
    }).catch(() => {}),
  ]);

  return (
    <>
      {errors.length > 0 && (
        <div className="card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Some data couldn’t load (API/DB may be down): {errors.join('; ')}
        </div>
      )}

      <div className="card p-6">
        <h2 className="text-lg font-semibold text-ink-900">Profile</h2>
        <div className="mt-4 flex items-center gap-4">
          {user?.picture && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.picture} alt="" className="h-16 w-16 rounded-full bg-ink-100" referrerPolicy="no-referrer" />
          )}
          <div>
            <div className="text-lg font-medium text-ink-900">{user?.name}</div>
            <div className="text-sm text-ink-500">{user?.email}</div>
          </div>
        </div>
      </div>

      <CacheTtlSettings />

      <ApiKeysManager initial={apiKeys} initialNewKey={user?.nk} />
      <ProviderKeysManager
        initial={providerKeys}
        searchProviders={searchProviders}
        llmProviders={llmProviders}
        encryptionAvailable={encryptionAvailable}
        initialCategory={keysCategory}
      />
    </>
  );
}

export function AccountKeysFallback() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="card h-36 rounded-xl bg-white" />
      <div className="card h-48 rounded-xl bg-white" />
      <div className="card h-64 rounded-xl bg-white" />
    </div>
  );
}
