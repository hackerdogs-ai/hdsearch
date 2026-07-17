// URL canonicalization + dedup id. Two results from different engines pointing
// at the same page must collapse to one. We normalize aggressively but safely:
// lowercase host, strip default ports, drop tracking params, trim trailing slash.
import { sha1 } from './cache.js';
import type { NormalizedResult } from './types.js';

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|igshid$|spm$|_hsenc|_hsmi)/i;

export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) {
      u.port = '';
    }
    const keep: [string, string][] = [];
    for (const [key, val] of u.searchParams.entries()) {
      if (!TRACKING_PARAMS.test(key)) keep.push([key, val]);
    }
    keep.sort((a, b) => a[0].localeCompare(b[0]));
    u.search = '';
    for (const [key, val] of keep) u.searchParams.append(key, val);
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

export function dedupId(url: string, title?: string): string {
  const basis = url ? canonicalUrl(url) : (title || '').toLowerCase().trim();
  return sha1(basis).slice(0, 16);
}

/** Merge duplicate results across providers, keeping the best-ranked instance and
 *  recording which providers agreed (a relevance signal for aggregate mode). */
export function dedupe(results: NormalizedResult[]): NormalizedResult[] {
  const byId = new Map<string, NormalizedResult>();
  for (const r of results) {
    const id = r.id || dedupId(r.url, r.title);
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, { ...r, id, mergedFrom: [r.source] });
      continue;
    }
    // keep the one with the better (lower) rank; merge provenance
    const merged = new Set([...(existing.mergedFrom || []), r.source]);
    const keep =
      (r.rank ?? Number.MAX_SAFE_INTEGER) < (existing.rank ?? Number.MAX_SAFE_INTEGER) ? r : existing;
    byId.set(id, {
      ...keep,
      id,
      snippet: keep.snippet || existing.snippet || r.snippet,
      thumbnail: keep.thumbnail || existing.thumbnail || r.thumbnail,
      mergedFrom: [...merged],
    });
  }
  return [...byId.values()];
}

/** Boost results corroborated by multiple engines, then by original rank. */
export function rankAggregate(results: NormalizedResult[]): NormalizedResult[] {
  return results.sort((a, b) => {
    const ac = a.mergedFrom?.length ?? 1;
    const bc = b.mergedFrom?.length ?? 1;
    if (ac !== bc) return bc - ac;
    return (a.rank ?? 999) - (b.rank ?? 999);
  });
}
