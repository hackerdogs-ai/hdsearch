import { redirect } from 'next/navigation';
import { api, ApiError, rethrowIfRedirect } from '@/lib/api';

export const dynamic = 'force-dynamic';

interface AccountResp {
  profile: { email?: string };
  usage: { search: number; crawl: number; vector: number; total: number };
}

async function load() {
  try {
    const [account, dash] = await Promise.all([api.account(), api.dashboard(30)]);
    return { account: account as AccountResp, dash, error: null as string | null };
  } catch (e) {
    rethrowIfRedirect(e);
    if (e instanceof ApiError && e.status === 401) redirect('/api/auth/logout');
    return { account: null, dash: null, error: e instanceof ApiError ? e.message : 'failed to load' };
  }
}

export default async function DashboardPage() {
  const { account, dash, error } = await load();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink-900">Dashboard</h1>
      </div>

      {error && (
        <div className="card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Couldn’t reach the API ({error}). Metrics will appear once the hd-search API and database are up.
        </div>
      )}

      {account && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Searches (mo)" value={account.usage.search} />
            <Stat label="Crawls (mo)" value={account.usage.crawl} />
            <Stat label="Vector ops (mo)" value={account.usage.vector} />
          </div>

          <ActivityChart byDay={(dash as any)?.byDay || []} />
          <EngineBreakdown byEngine={(dash as any)?.byEngine || []} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="card p-5">
      <div className="text-sm uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 text-3xl font-bold text-ink-900">{value.toLocaleString()}</div>
      {sub && <div className="text-sm text-ink-400">{sub}</div>}
    </div>
  );
}

function ActivityChart({ byDay }: { byDay: { day: string; metric: string; n: number }[] }) {
  // aggregate per-day totals
  const totals = new Map<string, number>();
  for (const r of byDay) {
    const d = String(r.day).slice(0, 10);
    totals.set(d, (totals.get(d) || 0) + Number(r.n));
  }
  const days = [...totals.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-30);
  const max = Math.max(1, ...days.map((d) => d[1]));
  const hasActivity = days.some(([, n]) => n > 0);
  return (
    <div className="card p-5">
      <h2 className="mb-4 text-sm font-semibold text-ink-700">Activity (30 days)</h2>
      {!hasActivity ? (
        <p className="py-8 text-center text-sm text-ink-400">No activity yet — run a search.</p>
      ) : (
        <>
          <div className="flex h-32 gap-[2px]">
            {days.map(([d, n]) => (
              <div key={d} className="group relative flex h-full flex-1 flex-col justify-end">
                <div
                  className="w-full rounded-t bg-brand-400 transition group-hover:bg-brand-500"
                  style={{ height: `${(n / max) * 100}%`, minHeight: n > 0 ? '2px' : '0' }}
                />
                <div className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink-800 px-2 py-1 text-sm text-white group-hover:block">
                  {d}: {n}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-sm text-ink-400">
            <span>{days[0][0]}</span>
            <span>{days[days.length - 1][0]}</span>
          </div>
        </>
      )}
    </div>
  );
}

function EngineBreakdown({ byEngine }: { byEngine: { engine: string; n: number }[] }) {
  const max = Math.max(1, ...byEngine.map((e) => Number(e.n)));
  return (
    <div className="card p-5">
      <h2 className="mb-4 text-sm font-semibold text-ink-700">Top engines</h2>
      {byEngine.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-400">No engine usage yet.</p>
      ) : (
        <ul className="space-y-2">
          {byEngine.map((e) => (
            <li key={e.engine} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-sm text-ink-600">{e.engine}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${(Number(e.n) / max) * 100}%` }} />
              </div>
              <span className="w-10 text-right text-sm text-ink-400">{e.n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
