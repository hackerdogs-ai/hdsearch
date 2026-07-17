import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { SearchHistoryPanel } from '@/components/search-history-panel';

export const dynamic = 'force-dynamic';

interface Row {
  ts: string;
  kind: string;
  query: string;
  modality: string;
  engine_used: string;
  result_count: number;
  cached: boolean;
  took_ms: number;
}

export default async function HistoryPage() {
  let rows: Row[] = [];
  let error: string | null = null;
  try {
    const r = await api.history(100, 0);
    rows = (r.history || []) as Row[];
  } catch (e) {
    error = e instanceof ApiError ? e.message : 'failed to load';
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Search History</h1>
        <p className="mt-1 text-sm text-ink-500">
          Recent searches are kept in <span className="font-medium">this browser</span> by default; signed in, they sync to a
          <span className="font-medium"> 3-day server history</span>, and paid plans add a durable archive.
        </p>
      </div>

      <SearchHistoryPanel />

      <h2 className="pt-2 text-sm font-semibold uppercase tracking-wide text-ink-500">Detailed activity log</h2>
      {error && <div className="card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Couldn’t load history ({error}).</div>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-sm uppercase tracking-wide text-ink-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Kind</th>
              <th className="px-4 py-3">Query</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Engine</th>
              <th className="px-4 py-3 text-right">Results</th>
              <th className="px-4 py-3 text-right">ms</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-400">
                  No history yet. <Link href="/search" className="text-brand-600 underline">Run a search →</Link>
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="hover:bg-ink-50">
                  <td className="whitespace-nowrap px-4 py-2 text-ink-500">{new Date(r.ts).toLocaleString()}</td>
                  <td className="px-4 py-2"><span className="chip py-0.5">{r.kind}</span></td>
                  <td className="max-w-xs truncate px-4 py-2 text-ink-900">{r.query}</td>
                  <td className="px-4 py-2 capitalize text-ink-600">{r.modality || '—'}</td>
                  <td className="px-4 py-2 text-ink-600">{r.engine_used || '—'}{r.cached ? ' (cached)' : ''}</td>
                  <td className="px-4 py-2 text-right text-ink-600">{r.result_count}</td>
                  <td className="px-4 py-2 text-right text-ink-400">{r.took_ms}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
