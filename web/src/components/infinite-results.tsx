'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResultList, type Result } from './results';

// Infinite-scroll results: seeded with the server-rendered first page, then loads
// more pages from the BFF (/api/search) as a sentinel scrolls into view. Replaces
// Next/Prev paging. Active facet filters (field:value tokens) are applied
// client-side over everything loaded so far.

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
const tldOf = (h: string) => (h.split('.').length > 1 ? h.split('.').pop()! : '');
const yearOf = (d?: string) => d?.match(/(\d{4})/)?.[1] || '';

function applyFacets(results: Result[], active: string[]): Result[] {
  if (!active.length) return results;
  const byField = new Map<string, Set<string>>();
  for (const tok of active) {
    const i = tok.indexOf(':');
    if (i < 0) continue;
    const f = tok.slice(0, i);
    const v = tok.slice(i + 1);
    if (!byField.has(f)) byField.set(f, new Set());
    byField.get(f)!.add(v);
  }
  return results.filter((r) => {
    for (const [field, vals] of byField) {
      const v =
        field === 'source' ? r.source :
        field === 'modality' ? r.modality :
        field === 'site' ? hostOf(r.url) :
        field === 'tld' ? tldOf(hostOf(r.url)) :
        field === 'year' ? yearOf(r.publishedAt) : '';
      if (!vals.has(v)) return false;
    }
    return true;
  });
}

export function InfiniteResults({
  q,
  modality,
  mode,
  depth,
  engine,
  temporary,
  initial,
  active,
  disablePagination = false,
}: {
  q: string;
  modality: string;
  mode?: string;
  depth?: string;
  engine?: string;
  temporary?: boolean;
  initial: Result[];
  active: string[];
  /** Medium/High aggregate runs are expensive; only page 1 is loaded. */
  disablePagination?: boolean;
}) {
  const [pages, setPages] = useState<Result[]>(initial);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  // Only stop up-front when paging is disabled or the first page was truly empty.
  // Do NOT infer "end" from initial.length < PAGE_SIZE — the backend returns VARIABLE
  // page sizes (e.g. 18 on p1, 20 fresh on p2), so a short page is not the end.
  const [done, setDone] = useState(disablePagination || initial.length === 0);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const seenIds = useRef<Set<string>>(new Set(initial.map((r) => r.id)));

  // reset when the query / modality / mode changes (new server render)
  useEffect(() => {
    setPages(initial);
    setPage(1);
    setDone(disablePagination || initial.length === 0);
    setError(null);
    seenIds.current = new Set(initial.map((r) => r.id));
  }, [q, modality, mode, depth, engine, temporary, initial, disablePagination]);

  const loadMore = useCallback(async () => {
    if (loading || done) return;
    setLoading(true);
    setError(null);
    try {
      const next = page + 1;
      const sp = new URLSearchParams({ q, modality, page: String(next) });
      if (mode) sp.set('mode', mode);
      if (depth) sp.set('depth', depth);
      if (engine) sp.set('engine', engine);
      if (temporary) sp.set('temporary', '1');
      const res = await fetch(`/api/search?${sp.toString()}`);
      if (res.status === 401) {
        window.location.href = '/api/auth/logout';
        return;
      }
      const ct = res.headers.get('content-type') || '';
      let data: { results?: Result[]; error?: string };
      if (ct.includes('application/json')) {
        data = await res.json();
      } else {
        const text = (await res.text()).trim();
        throw new Error(
          res.ok
            ? 'Search returned an unexpected response'
            : text || `Search failed (${res.status})`,
        );
      }
      if (!res.ok) {
        throw new Error(data.error || `Search failed (${res.status})`);
      }
      const fresh: Result[] = (data.results || []).filter((r: Result) => !seenIds.current.has(r.id));
      fresh.forEach((r) => seenIds.current.add(r.id));
      setPages((prev) => [...prev, ...fresh]);
      setPage(next);
      // Stop ONLY when a page returns nothing at all, or nothing NEW (upstream exhausted
      // or aggregate/high re-served the same ids). A short-but-nonempty page is NOT the
      // end — the next page can still bring fresh results.
      if (!data.results || data.results.length === 0 || fresh.length === 0) setDone(true);
    } catch (e: any) {
      setError(e?.message || 'Failed to load more results');
      setDone(true);
    } finally {
      setLoading(false);
    }
  }, [loading, done, page, q, modality, mode, depth, engine, temporary]);

  useEffect(() => {
    if (disablePagination) return;
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, disablePagination]);

  const filtered = useMemo(() => applyFacets(pages, active), [pages, active]);

  return (
    <div>
      <p className="mb-4 text-sm text-ink-500">
        {filtered.length} result{filtered.length === 1 ? '' : 's'}
        {active.length > 0 && ` (filtered from ${pages.length})`} loaded
      </p>
      <ResultList results={filtered} modality={modality} />

      <div ref={sentinel} className="h-10" />
      {loading && (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-ink-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink-300 border-t-brand-500" />
          Loading more…
        </div>
      )}
      {error && <p className="py-4 text-center text-sm text-red-600">{error}</p>}
      {done && filtered.length > 0 && !loading && (
        <p className="py-6 text-center text-sm text-ink-400">— end of results —</p>
      )}
    </div>
  );
}
