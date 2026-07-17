'use client';

import type { Result } from './results';

// Places = local-listing view: the same geo results as the Maps tab, but rendered as
// detail cards (category, address, rating, phone, hours) rather than on a map. Rich
// fields appear when a Google Places key (serper/serpapi) is configured; the free OSM
// path still shows name, category, and address. Each card links over to the map.
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span className="text-amber-500" aria-label={`${rating} stars`}>
      {'★'.repeat(Math.min(5, full))}
      <span className="text-ink-300">{'★'.repeat(Math.max(0, 5 - full))}</span>
    </span>
  );
}

export function PlacesList({ results }: { results: Result[]; q?: string }) {
  if (results.length === 0) {
    return <p className="py-16 text-center text-ink-500">No places found. Try a place, address, or “&lt;category&gt; in &lt;city&gt;”.</p>;
  }
  return (
    <div className="space-y-4">
      <ul className="space-y-3">
        {results.map((r) => {
          const e = r.extra || {};
          const category = e.category || e.geo?.kind;
          const rating = typeof e.rating === 'number' ? e.rating : Number(e.rating) || null;
          return (
            <li key={r.id} className="card p-4">
              <div className="min-w-0">
                <h3 className="truncate text-base font-medium text-ink-900">{r.title}</h3>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-500">
                  {category && <span className="chip py-0.5 capitalize">{String(category).replace(/_/g, ' ')}</span>}
                  {rating != null && (
                    <span className="inline-flex items-center gap-1">
                      <Stars rating={rating} />
                      <span className="text-ink-600">{rating.toFixed(1)}</span>
                      {e.ratingCount ? <span className="text-ink-400">({e.ratingCount})</span> : null}
                    </span>
                  )}
                </div>
              </div>

              {(r.snippet || e.address) && <p className="mt-2 text-sm text-ink-600">{r.snippet || e.address}</p>}

              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-500">
                {e.phone && <span>📞 {e.phone}</span>}
                {typeof e.hours === 'string' && <span>🕒 {e.hours}</span>}
                {/^https?:\/\//.test(r.url) && (
                  <a href={r.url} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">
                    {e.website ? 'Website' : hostOf(r.url) || 'Open'} ↗
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
