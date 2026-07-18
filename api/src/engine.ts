// The aggregation engine. Implements spec §1 + §7:
//   • fallback mode (default): try providers in priority order; return the first
//     that yields results. On failure/empty, fall through to the next.
//   • aggregate mode: fan out to the top-N providers in parallel, merge + dedup,
//     boosting results corroborated by multiple engines.
// Every provider call is wrapped by the Redis computed-cache (per-source TTL) so
// repeated queries don't hammer (or get blocked by) upstreams (spec §2, §9).
// Empty provider results are not cached — a transient upstream miss must not
// block retries for up to 24h.
import { env } from './env.js';
import { log, errFields } from './logger.js';
import { computed } from './cache.js';
import { resolveRequestCacheTtlSec, resolveUserCacheTtlSec } from './cache-ttl.js';
import { isDemoUser } from './auth.js';
import { getProviderPrefs } from './provider-prefs.js';
import { dedupe, rankAggregate } from './normalize.js';
import { computeFacets } from './facets.js';
import { contextFor } from './keystore.js';
import {
  resolveSearchCandidates,
  resolveCrawlCandidates,
  effectivePriority,
} from './providers/index.js';
import type { SearchProvider, CrawlProvider } from './providers/types.js';
import type {
  CrawlRequest,
  CrawlResult,
  NormalizedResult,
  SearchRequest,
  SearchResponse,
} from './types.js';

function effectiveSearchMode(req: SearchRequest): 'fallback' | 'aggregate' {
  if (req.engine) return 'fallback';
  if (req.searchDepth === 'low') return 'fallback';
  if (req.searchDepth === 'medium' || req.searchDepth === 'high') return 'aggregate';
  return req.mode;
}

function aggregateFanoutFor(req: SearchRequest): number {
  if (req.searchDepth === 'high') return 5;
  if (req.searchDepth === 'medium') return 2;
  return env.aggregateFanout;
}

interface EngineOutcome {
  engine: string;
  ok: boolean;
  count: number;
  ms: number;
  cached: boolean;
  error?: string;
}

const ttlFor = (_p: SearchProvider | CrawlProvider, cacheTtlSec: number) => cacheTtlSec;

/** Per-request `ttl` wins; otherwise account pref / admin default (over-max → default). */
async function cacheTtlForRequest(reqTtl: number | undefined, userId?: string): Promise<number> {
  if (reqTtl != null) return resolveRequestCacheTtlSec(reqTtl);
  if (!userId || isDemoUser(userId)) return resolveRequestCacheTtlSec(undefined);
  const prefs = await getProviderPrefs(userId);
  return resolveUserCacheTtlSec(prefs.cacheTtlSec);
}

function cacheKeyForSearch(p: SearchProvider, req: SearchRequest, userId?: string): string {
  // user id only matters when the provider needs a key (per-user results); for
  // free providers the cache is shared across users.
  const scope = p.requiresKeys?.length ? userId || 'anon' : 'shared';
  return JSON.stringify([p.id, scope, req.q, req.modality, req.limit, req.page, req.country, req.lang, req.freshness, req.safe]);
}

/** Run one provider through the cache, timing + classifying the outcome. */
async function runSearchProvider(
  p: SearchProvider,
  req: SearchRequest,
  userId: string | undefined,
  cacheTtlSec: number,
): Promise<{ results: NormalizedResult[]; outcome: EngineOutcome }> {
  const t0 = Date.now();
  try {
    const exec = async () => {
      const ctx = contextFor(userId);
      const r = await p.search(req, ctx);
      return r.slice(0, req.limit);
    };
    const { value, hit } = req.noCache
      ? { value: await exec(), hit: false }
      : await computed('search', cacheKeyForSearch(p, req, userId), ttlFor(p, cacheTtlSec), exec, {
          // Empty provider results are often transient (timeout, rate limit) — don't poison the cache.
          shouldCache: (rows) => rows.length > 0,
        });
    return {
      results: value,
      outcome: { engine: p.id, ok: true, count: value.length, ms: Date.now() - t0, cached: hit },
    };
  } catch (e) {
    log.warn('search provider failed', { provider: p.id, ...errFields(e) });
    return {
      results: [],
      outcome: { engine: p.id, ok: false, count: 0, ms: Date.now() - t0, cached: false, error: (e as Error).message },
    };
  }
}

export async function runSearch(req: SearchRequest, userId?: string): Promise<SearchResponse> {
  const t0 = Date.now();
  const cacheTtlSec = await cacheTtlForRequest(req.ttl, userId);
  const mode = effectiveSearchMode(req);
  const { usable, skipped } = await resolveSearchCandidates(req.modality, userId, req.engine);
  const enginesUsed: EngineOutcome[] = [];
  let results: NormalizedResult[] = [];

  if (usable.length === 0) {
    return {
      query: req.q,
      modality: req.modality,
      mode,
      enginesUsed: skipped.map((s) => ({ engine: s.id, ok: false, count: 0, ms: 0, cached: false, error: s.reason })),
      results: [],
      total: 0,
      cached: false,
      tookMs: Date.now() - t0,
    };
  }

  if (mode === 'aggregate') {
    const fanout = usable.slice(0, aggregateFanoutFor(req));
    // soft deadline: a straggling provider resolves to an empty/timeout outcome so
    // the response isn't held hostage by the slowest engine.
    const deadline = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
      new Promise((resolve) => {
        let done = false;
        const t = setTimeout(() => {
          if (!done) {
            done = true;
            resolve(fallback);
          }
        }, env.aggregateDeadlineMs);
        p.then((v) => {
          if (!done) {
            done = true;
            clearTimeout(t);
            resolve(v);
          }
        });
      });
    const settled = await Promise.all(
      fanout.map((p) =>
        deadline(runSearchProvider(p, req, userId, cacheTtlSec), {
          results: [] as NormalizedResult[],
          outcome: { engine: p.id, ok: false, count: 0, ms: env.aggregateDeadlineMs, cached: false, error: 'deadline' },
        }),
      ),
    );
    for (const s of settled) {
      enginesUsed.push(s.outcome);
      results.push(...s.results);
    }
    results = rankAggregate(dedupe(results)).slice(0, req.limit);
  } else {
    // fallback: first provider that returns results wins
    for (const p of usable) {
      const s = await runSearchProvider(p, req, userId, cacheTtlSec);
      enginesUsed.push(s.outcome);
      if (s.results.length > 0) {
        results = dedupe(s.results).slice(0, req.limit);
        break;
      }
    }
  }

  const anyCached = enginesUsed.some((e) => e.cached);
  const resp: SearchResponse = {
    query: req.q,
    modality: req.modality,
    mode,
    enginesUsed,
    results,
    total: results.length,
    cached: anyCached,
    tookMs: Date.now() - t0,
  };
  if (req.facets) resp.facets = computeFacets(results);
  return resp;
}

// ---- crawl ----

function cacheKeyForCrawl(p: CrawlProvider, req: CrawlRequest, userId?: string): string {
  const scope = p.requiresKeys?.length ? userId || 'anon' : 'shared';
  return JSON.stringify([p.id, scope, req.url, req.formats, req.render]);
}

export interface CrawlEngineResponse {
  url: string;
  enginesUsed: EngineOutcome[];
  result: CrawlResult | null;
  cached: boolean;
  tookMs: number;
}

export async function runCrawl(req: CrawlRequest, userId?: string): Promise<CrawlEngineResponse> {
  const t0 = Date.now();
  const cacheTtlSec = await cacheTtlForRequest(req.ttl, userId);
  const { usable, skipped } = await resolveCrawlCandidates(userId, req.engine);
  const enginesUsed: EngineOutcome[] = [];

  // screenshot/pdf need a capture-capable provider; drop the rest so we don't waste
  // a fallback hop on a crawler that can only return text.
  const wantShot = req.formats.includes('screenshot');
  const wantPdf = req.formats.includes('pdf');
  let candidates = usable;
  if (wantShot || wantPdf) {
    candidates = usable.filter((p) => (wantShot ? p.capabilities?.screenshot : true) && (wantPdf ? p.capabilities?.pdf : true));
    for (const p of usable) {
      if (!candidates.includes(p)) skipped.push({ id: p.id, reason: `does not support ${wantShot ? 'screenshot' : ''}${wantShot && wantPdf ? '/' : ''}${wantPdf ? 'pdf' : ''}` });
    }
  }

  // prefer JS-rendering providers when render=true
  const ordered = req.render
    ? [...candidates].sort((a, b) => Number(!!b.rendersJs) - Number(!!a.rendersJs) || effectivePriority(a) - effectivePriority(b))
    : candidates;

  for (const p of ordered) {
    const t1 = Date.now();
    try {
      const exec = () => p.crawl(req, contextFor(userId));
      const { value, hit } = req.noCache
        ? { value: await exec(), hit: false }
        : await computed('crawl', cacheKeyForCrawl(p, req, userId), ttlFor(p, cacheTtlSec), exec);
      const ok = !!(value && (value.markdown || value.text || value.html || value.screenshot || value.pdf || (value.links && value.links.length)));
      enginesUsed.push({ engine: p.id, ok, count: ok ? 1 : 0, ms: Date.now() - t1, cached: hit });
      if (ok) {
        return { url: req.url, enginesUsed, result: value, cached: hit, tookMs: Date.now() - t0 };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (req.quiet) {
        log.debug('crawl provider failed', { provider: p.id, url: req.url, error: msg });
      } else {
        log.warn('crawl provider failed', { provider: p.id, ...errFields(e) });
      }
      enginesUsed.push({ engine: p.id, ok: false, count: 0, ms: Date.now() - t1, cached: false, error: msg });
    }
  }

  for (const s of skipped) enginesUsed.push({ engine: s.id, ok: false, count: 0, ms: 0, cached: false, error: s.reason });
  if (req.quiet) {
    log.debug('crawl exhausted', { url: req.url, tried: enginesUsed.length, tookMs: Date.now() - t0 });
  }
  return { url: req.url, enginesUsed, result: null, cached: false, tookMs: Date.now() - t0 };
}
