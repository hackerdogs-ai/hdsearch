import Link from 'next/link';
import { InfiniteResults } from '@/components/infinite-results';
import { type Facet } from '@/components/facet-rail';
import { ResizableFacetPanel } from '@/components/resizable-facet-panel';
import { ResultList, type Result } from '@/components/results';
import { MapResults } from '@/components/map-results';
import { PlacesList } from '@/components/places-list';
import { ProviderAttributionBar } from '@/components/provider-attribution';
import { SearchExperienceShell } from '@/components/search-experience-shell';
import { isAiModality } from '@/lib/ai-routes';
import { collectProviderAttributions } from '@/lib/provider-attribution';
import { parseSearchDepth, searchDepthToMode } from '@/lib/search-depth';
import { searchHref } from '@/lib/search-routes';
import { apiCall, ApiError, rethrowIfRedirect } from '@/lib/api';
import { config } from '@/lib/config';
import { getSession } from '@/lib/session';

function searchErrorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : (e as Error)?.message || 'search failed';
}

export const dynamic = 'force-dynamic';

const MODALITIES = ['web', 'news', 'images', 'videos', 'maps', 'scholar', 'places', 'code', 'social', 'archive', 'darkweb', 'semantic', 'ai'];

const NEEDS_KEY: Record<string, string> = {
};
const ARCHIVE_HINT =
  'Archive (Common Crawl) searches by domain or URL prefix, not keywords — try a domain like "example.com".';

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function facetsFrom(results: Result[]): Facet[] {
  const site = new Map<string, number>(),
    tld = new Map<string, number>(),
    year = new Map<string, number>();
  for (const r of results) {
    const h = hostOf(r.url);
    if (h) site.set(h, (site.get(h) || 0) + 1);
    const t = h.split('.').pop() || '';
    if (t) tld.set(t, (tld.get(t) || 0) + 1);
    const y = r.publishedAt?.match(/(\d{4})/)?.[1];
    if (y) year.set(y, (year.get(y) || 0) + 1);
  }
  const top = (m: Map<string, number>) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([value, count]) => ({ value, count }));
  const out: Facet[] = [
    { field: 'site', values: top(site) },
    { field: 'tld', values: top(tld) },
  ];
  if (year.size) out.push({ field: 'year', values: top(year) });
  return out;
}

export type SearchPageParams = {
  q?: string;
  modality?: string;
  mode?: string;
  depth?: string;
  engine?: string;
  temporary?: string;
  f?: string | string[];
  view?: string;
};

export default async function SearchPage({ searchParams }: { searchParams: SearchPageParams }) {
  const q = (searchParams.q || '').trim();
  let modality = MODALITIES.includes(searchParams.modality || '') ? searchParams.modality! : 'web';
  let mapsView = searchParams.view === 'list' ? 'list' : 'map';
  if (modality === 'places') {
    modality = 'maps';
    mapsView = 'list';
  }
  const isAi = isAiModality(modality);
  const depth = parseSearchDepth(searchParams.depth);
  const engine = (searchParams.engine || '').trim() || undefined;
  const temporary = searchParams.temporary === '1' || searchParams.temporary === 'true';
  const legacyMode = searchParams.mode === 'aggregate' ? 'aggregate' : undefined;
  const mode = legacyMode || searchDepthToMode(depth);
  const isSemantic = modality === 'semantic';
  const active = ([] as string[]).concat(searchParams.f || []);
  const session = getSession();

  let results: Result[] = [];
  let facets: Facet[] = [];
  let enginesUsed: { engine: string; ok: boolean; count: number; cached: boolean; error?: string }[] = [];
  let tookMs = 0;
  let error: string | null = null;

  if (q && !isAi && isSemantic) {
    try {
      const resp = await apiCall('/v1/search/vector', {
        method: 'POST',
        asUser: session?.sub || 'public-demo',
        body: { q, k: 24, groundWithWeb: true, namespace: 'open-search' },
      });
      tookMs = resp.tookMs || 0;
      results = (resp.results || []).map((r: any) => ({
        id: r.id,
        title: r.title || r.url || (r.text ? r.text.slice(0, 80) : 'result'),
        url: r.url || '#',
        snippet: r.text,
        modality: 'web',
        source: 'semantic',
        score: r.score,
      }));
      facets = facetsFrom(results);
    } catch (e) {
      rethrowIfRedirect(e);
      error = searchErrorMessage(e);
    }
  } else if (q && !isAi) {
    try {
      const resp = await apiCall('/v1/search', {
        method: 'POST',
        asUser: session?.sub || 'public-demo',
        body: {
          q,
          modality,
          mode,
          searchDepth: depth,
          engine,
          temporary,
          limit: 20,
          page: 1,
          facets: true,
        },
      });
      results = resp.results || [];
      facets = resp.facets || [];
      enginesUsed = resp.enginesUsed || [];
      tookMs = resp.tookMs || 0;
    } catch (e) {
      rethrowIfRedirect(e);
      error = searchErrorMessage(e);
    }
  }

  const baseParams: Record<string, string> = {
    q,
    modality,
    ...(depth !== 'low' ? { depth } : {}),
    ...(engine ? { engine } : {}),
    ...(temporary ? { temporary: '1' } : {}),
  };
  // Engines that were attempted but failed, with the provider's own reason.
  const failedEngines = enginesUsed.filter((e) => !e.ok);
  // "Needs a key" is only true when nothing ran at all. If engines DID run, an
  // empty result is a provider problem (quota, credits, outage) — telling the user
  // to add a key they already have sends them the wrong way.
  const noFreeEngine =
    results.length === 0 && !error && enginesUsed.length === 0 && NEEDS_KEY[modality];
  const attributions = collectProviderAttributions(
    enginesUsed,
    results.flatMap((r) => [r.source, ...(r.mergedFrom || [])]),
    modality,
  );

  const resultsPane = (
    <div className="flex flex-col gap-8 lg:flex-row">
      {q && facets.length > 0 && (
        <ResizableFacetPanel facets={facets} baseParams={baseParams} active={active} />
      )}

      <section className="min-w-0 flex-1">
        {q && isSemantic && !error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">
            <span aria-hidden>✨</span>
            <span>
              <strong>Semantic results</strong> — ranked by meaning, grounded with live web.
            </span>
          </div>
        )}

        {error && (
          <div className="card border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}{' '}
            {!session && (
              <a href="/login" className="font-semibold underline">
                Sign in
              </a>
            )}
          </div>
        )}

        {q && !error && (
          <>
            <p className="mb-3 text-sm text-ink-500">
              {tookMs} ms ·{' '}
              {isSemantic ? (
                <span>vector KNN · grounded with live web</span>
              ) : (
                <>
                  engines:{' '}
                  {enginesUsed.length === 0 && <span className="text-ink-400">none available</span>}
                  {enginesUsed.map((e, i) => (
                    <span key={e.engine}>
                      {i > 0 && ', '}
                      <span className={e.ok ? 'text-brand-700' : 'text-ink-400 line-through'}>{e.engine}</span>
                      {e.cached ? ' (cached)' : ''}
                    </span>
                  ))}
                </>
              )}
            </p>

            {results.length === 0 ? (
              <div className="card p-6 text-sm text-ink-600">
                <p className="font-medium text-ink-900">No results for this type.</p>
                {failedEngines.length > 0 && (
                  <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-amber-900">
                    <p className="font-medium">
                      {failedEngines.length === enginesUsed.length
                        ? 'Every engine for this modality failed:'
                        : 'Some engines failed:'}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {failedEngines.map((e) => (
                        <li key={e.engine}>
                          <code>{e.engine}</code> — {e.error || 'request failed'}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-amber-800">
                      Check the provider&apos;s quota or credit balance, then retry.
                    </p>
                  </div>
                )}
                <p className="mt-1 text-ink-500">
                  {noFreeEngine || (modality === 'archive' ? ARCHIVE_HINT : 'Try a different query or modality, or switch to ')}
                  {!noFreeEngine && modality !== 'archive' && (
                    <Link href={searchHref({ q, modality: 'web' })} className="text-brand-600 underline">
                      web
                    </Link>
                  )}
                  {!noFreeEngine && modality !== 'archive' && '.'}
                </p>
              </div>
            ) : modality === 'maps' ? (
              <div className="space-y-3">
                <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5 text-sm">
                  {(['map', 'list'] as const).map((v) => (
                    <Link
                      key={v}
                      href={searchHref({
                        q,
                        modality: 'maps',
                        ...(v === 'list' ? { view: 'list' } : {}),
                      })}
                      className={`rounded-md px-3 py-1 capitalize ${mapsView === v ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100'}`}
                    >
                      {v === 'map' ? 'Map view' : 'List view'}
                    </Link>
                  ))}
                </div>
                {mapsView === 'list' ? <PlacesList results={results} q={q} /> : <MapResults results={results} />}
              </div>
            ) : isSemantic ? (
              <ResultList results={results.filter((r) => filterByFacets(r, active))} modality="web" />
            ) : (
              <InfiniteResults
                q={q}
                modality={modality}
                mode={mode}
                depth={depth}
                engine={engine}
                temporary={temporary}
                initial={results}
                active={active}
              />
            )}
            <ProviderAttributionBar items={attributions} />
          </>
        )}
      </section>
    </div>
  );

  return (
    <SearchExperienceShell
      modality={modality}
      q={q}
      depth={depth}
      engine={engine}
      temporary={temporary}
      signedIn={!!session}
      signInRequiredForAi={config.signInRequiredForAi}
      user={
        session
          ? { name: session.name, email: session.email, picture: session.picture }
          : undefined
      }
      initialQuery={q}
    >
      {resultsPane}
    </SearchExperienceShell>
  );
}

function filterByFacets(r: Result, active: string[]): boolean {
  if (!active.length) return true;
  for (const tok of active) {
    const i = tok.indexOf(':');
    if (i < 0) continue;
    const field = tok.slice(0, i),
      val = tok.slice(i + 1);
    const v =
      field === 'site'
        ? hostOf(r.url)
        : field === 'tld'
          ? hostOf(r.url).split('.').pop() || ''
          : field === 'source'
            ? r.source
            : field === 'year'
              ? r.publishedAt?.match(/(\d{4})/)?.[1] || ''
              : '';
    if (v !== val) return false;
  }
  return true;
}
