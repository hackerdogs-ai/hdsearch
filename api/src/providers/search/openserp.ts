// OpenSERP (karust/openserp) v2.x — self-hosted SERP scraper that drives a real
// headless browser against Google / Yandex / Baidu. Free, no key → high priority.
//
// Important operational notes (see docs/OPENSERP.md):
//   • Google reliably serves a CAPTCHA to datacenter IPs, so by default we route
//     to engines that work unauthenticated from a server: Yandex + Baidu. Override
//     with HDSEARCH_OPENSERP_ENGINE / HDSEARCH_OPENSERP_ENGINES.
//   • openserp is run with --allow_endpoint_fallback, so even a /google call will
//     fall back to a working engine; we still prefer hitting a good engine directly
//     to avoid the wasted ~6s captcha round-trip.
//   • Response shape (v2.1): { query, meta, results: [{rank,title,url,snippet,...}] }.
import { env } from '../../env.js';
import { httpJson } from '../../http.js';
import { mkResult } from '../util.js';
import type { SearchProvider } from '../types.js';
import type { Modality, NormalizedResult, SearchRequest } from '../../types.js';

interface OpenSerpV2Hit {
  rank?: number;
  type?: string;
  title: string;
  url: string;
  snippet?: string;
  domain?: string;
  favicon?: string;
  thumbnail?: string;
  image?: string;
  engine?: string;
}
interface OpenSerpV2Resp {
  results?: OpenSerpV2Hit[];
}

// engine(s) to use, in order. Default to the captcha-free ones.
function engineList(): string[] {
  if (env.openserpEngines) return env.openserpEngines.split(',').map((s) => s.trim()).filter(Boolean);
  return [env.openserpEngine || 'yandex'];
}

async function queryEngine(engine: string, path: 'search' | 'image', req: SearchRequest): Promise<OpenSerpV2Hit[]> {
  const url = new URL(`/${engine}/${path}`, env.openserpUrl);
  url.searchParams.set('text', req.q);
  url.searchParams.set('limit', String(req.limit));
  if (req.lang) url.searchParams.set('lang', req.lang.toUpperCase());
  // openserp drives a real browser (~5–7s/engine) and serializes concurrent
  // requests, so give each engine a generous timeout and no retries.
  const data = await httpJson<OpenSerpV2Resp>(url.toString(), {
    provider: 'openserp',
    timeoutMs: env.openserpTimeoutMs,
    retries: 0,
  });
  // tolerate both v2 ({results:[]}) and legacy (bare array)
  if (Array.isArray(data)) return data as OpenSerpV2Hit[];
  return data.results || [];
}

export const openserp: SearchProvider = {
  id: 'openserp',
  label: 'OpenSERP (self-hosted)',
  category: 'search',
  accessType: 'self-hosted',
  defaultPriority: 20,
  modalities: ['web', 'images'],
  cacheTtlSec: 3600,
  docsUrl: 'https://github.com/karust/openserp',
  endpoint: 'GET {OPENSERP_URL}/{yandex|baidu|google}/search?text={q}&limit=N',
  description:
    'Self-hosted headless-browser SERP scraper (Google/Yandex/Baidu). Free, no key. Defaults to Yandex/Baidu (Google captchas datacenter IPs).',
  async search(req: SearchRequest): Promise<NormalizedResult[]> {
    const path: 'search' | 'image' = req.modality === 'images' ? 'image' : 'search';
    const engines = engineList();

    const toResults = (rows: OpenSerpV2Hit[], engine: string): NormalizedResult[] =>
      rows.map((h, i) =>
        mkResult('openserp', req.modality, {
          title: h.title || h.url,
          url: h.url,
          snippet: h.snippet,
          rank: h.rank ?? i,
          thumbnail: h.thumbnail || h.favicon,
          imageUrl: req.modality === 'images' ? h.image || h.url : undefined,
          extra: { engine: h.engine || engine, domain: h.domain },
        }),
      );

    if (env.openserpMerge && engines.length > 1) {
      // MAX BREADTH: fan out to every engine concurrently, merge + dedupe by URL.
      const settled = await Promise.allSettled(engines.map((eng) => queryEngine(eng, path, req)));
      const seen = new Set<string>();
      const merged: NormalizedResult[] = [];
      settled.forEach((s, idx) => {
        if (s.status !== 'fulfilled') return;
        for (const r of toResults(s.value, engines[idx]!)) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          merged.push(r);
        }
      });
      // re-rank: keep best original rank, but interleave engines for diversity
      return merged.slice(0, req.limit);
    }

    // FALLBACK: try engines in order; first with results wins.
    for (const engine of engines) {
      try {
        const rows = await queryEngine(engine, path, req);
        if (rows.length) return toResults(rows, engine).slice(0, req.limit);
      } catch {
        /* try the next engine */
      }
    }
    return [];
  },
};
