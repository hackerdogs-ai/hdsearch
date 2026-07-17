// Faceted aggregation over a normalized result set — the same concept used on the
// WorldMonitor SEW search pages (spec §12). We compute counts for a few useful
// dimensions so the UI can render Google/Amazon-style facet rails.
import type { Facet, NormalizedResult } from './types.js';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function tldOf(host: string): string {
  const parts = host.split('.');
  return parts.length > 1 ? parts[parts.length - 1]! : '';
}

function yearOf(d?: string): string | undefined {
  if (!d) return undefined;
  const m = d.match(/(\d{4})/);
  return m ? m[1] : undefined;
}

function topN(counts: Map<string, number>, n: number): { value: string; count: number }[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

export function computeFacets(results: NormalizedResult[]): Facet[] {
  const sources = new Map<string, number>();
  const modalities = new Map<string, number>();
  const sites = new Map<string, number>();
  const tlds = new Map<string, number>();
  const years = new Map<string, number>();

  for (const r of results) {
    bump(sources, r.source);
    bump(modalities, r.modality);
    const host = hostOf(r.url);
    bump(sites, host);
    const tld = tldOf(host);
    if (tld) bump(tlds, tld);
    const y = yearOf(r.publishedAt);
    if (y) bump(years, y);
  }

  const facets: Facet[] = [
    { field: 'source', values: topN(sources, 20) },
    { field: 'modality', values: topN(modalities, 12) },
    { field: 'site', values: topN(sites, 20) },
    { field: 'tld', values: topN(tlds, 12) },
  ];
  if (years.size) facets.push({ field: 'year', values: topN(years, 12) });
  return facets;
}

function bump(m: Map<string, number>, key: string): void {
  m.set(key, (m.get(key) || 0) + 1);
}
