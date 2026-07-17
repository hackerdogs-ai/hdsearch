import { api, ApiError, rethrowIfRedirect } from '@/lib/api';
import { ProviderRanking } from '@/components/provider-ranking';
import type { Engine } from '@/components/content/services-content';

export const dynamic = 'force-dynamic';

export default async function RankingPage() {
  let engines: Engine[] = [];
  let error: string | null = null;
  try {
    const r = await api.engines();
    engines = (r.engines || []) as Engine[];
  } catch (e) {
    rethrowIfRedirect(e);
    error = e instanceof ApiError ? e.message : 'failed to load';
  }
  return (
    <div className="space-y-6">
      {error && (
        <div className="card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Couldn't load engines ({error}).
        </div>
      )}
      <ProviderRanking engines={engines} />
    </div>
  );
}
