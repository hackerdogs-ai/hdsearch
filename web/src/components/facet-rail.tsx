import Link from 'next/link';
import { searchHref } from '@/lib/search-routes';

// Google/Amazon-style facet rail (spec §12). Each facet value is a toggle link
// that adds/removes a `field:value` filter in the URL; the results page applies
// the active filters in-memory over the fetched result set.
export interface Facet {
  field: string;
  values: { value: string; count: number }[];
}

const LABELS: Record<string, string> = {
  source: 'Engine',
  modality: 'Type',
  site: 'Site',
  tld: 'Domain',
  year: 'Year',
};

function toggle(active: string[], token: string): string[] {
  return active.includes(token) ? active.filter((t) => t !== token) : [...active, token];
}

export function FacetRail({
  facets,
  baseParams,
  active,
}: {
  facets: Facet[];
  baseParams: Record<string, string>;
  active: string[]; // tokens like "site:example.com"
}) {
  function hrefFor(field: string, value: string): string {
    const token = `${field}:${value}`;
    const next = toggle(active, token);
    const sp = new URLSearchParams(baseParams);
    sp.delete('f');
    for (const t of next) sp.append('f', t);
    return searchHref(sp);
  }

  const clearAll = new URLSearchParams(baseParams).toString();

  return (
    <aside className="w-full shrink-0 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-700">Filters</h2>
        {active.length > 0 && (
          <Link href={searchHref(new URLSearchParams(clearAll))} className="text-sm text-brand-600 hover:underline">
            Clear ({active.length})
          </Link>
        )}
      </div>
      {facets.map((f) => (
        <div key={f.field}>
          <h3 className="label">{LABELS[f.field] || f.field}</h3>
          <ul className="space-y-1">
            {f.values.slice(0, 10).map((v) => {
              const token = `${f.field}:${v.value}`;
              const on = active.includes(token);
              return (
                <li key={v.value}>
                  <Link
                    href={hrefFor(f.field, v.value)}
                    className={`flex items-center justify-between rounded-md px-2 py-1 text-sm ${
                      on ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${
                          on ? 'border-brand-500 bg-brand-500 text-white' : 'border-ink-300'
                        }`}
                      >
                        {on && <span className="text-sm leading-none">✓</span>}
                      </span>
                      <span className="truncate" title={v.value}>{v.value}</span>
                    </span>
                    <span className="ml-2 shrink-0 text-sm text-ink-400">{v.count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </aside>
  );
}
