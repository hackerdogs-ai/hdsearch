// Common Crawl — free, petabyte-scale open web crawl (spec §6). We query the CDX
// index for captured URLs matching a domain/prefix. Best used with a domain or
// url-prefix query (e.g. "example.com/*"); returns archived captures as results.
import { httpText } from '../../http.js';
import { mkResult } from '../util.js';
import type { SearchProvider } from '../types.js';
import type { NormalizedResult, SearchRequest } from '../../types.js';

// Latest stable index collection. Override with HDSEARCH_CC_INDEX if needed.
const CC_INDEX = process.env.HDSEARCH_CC_INDEX || 'CC-MAIN-2025-08';

interface CdxRow {
  url: string;
  timestamp: string;
  status: string;
  mime: string;
  digest: string;
  /** WARC locator — needed to fetch the archived capture itself. */
  filename: string;
  offset: string;
  length: string;
}

export const commoncrawl: SearchProvider = {
  id: 'commoncrawl',
  label: 'Common Crawl (free archive)',
  category: 'search',
  accessType: 'free',
  defaultPriority: 80,
  modalities: ['archive', 'web'],
  cacheTtlSec: 86400,
  docsUrl: 'https://commoncrawl.org/',
  endpoint: 'GET https://index.commoncrawl.org/{index}-index?url={q}&output=json',
  description:
    'Free petabyte-scale web crawl. Query a domain/url-prefix against the CDX index; returns archived captures.',
  async search(req: SearchRequest): Promise<NormalizedResult[]> {
    const url = new URL(`https://index.commoncrawl.org/${CC_INDEX}-index`);
    // CC works on URL patterns; if the user gave a bare term, treat it as a host glob.
    const pattern = /[./]/.test(req.q) ? req.q : `${req.q}*`;
    url.searchParams.set('url', pattern);
    url.searchParams.set('output', 'json');
    // over-fetch so we can drop redirect/diagnostic captures and still fill the page.
    url.searchParams.set('limit', String(Math.min(req.limit * 4, 200)));
    const body = await httpText(url.toString(), { provider: 'commoncrawl' });
    const parsed: CdxRow[] = body
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as CdxRow;
        } catch {
          return null;
        }
      })
      .filter((r): r is CdxRow => !!r);
    // Prefer real page captures: HTTP 200 with an HTML mime and a WARC (not the
    // crawldiagnostics 3xx redirect records, which have no archived body to view).
    const isPage = (r: CdxRow) =>
      r.status === '200' && /warc\//.test(r.filename || '') && /html|text\/plain|xml/.test(r.mime || '');
    const pages = parsed.filter(isPage);
    const rows = (pages.length ? pages : parsed.filter((r) => /warc\//.test(r.filename || ''))).slice(0, req.limit);
    return rows.map((r, i) =>
      mkResult('commoncrawl', 'archive', {
        title: r.url,
        url: r.url,
        snippet: `Captured ${cdxDate(r.timestamp) || r.timestamp} · ${r.mime} · HTTP ${r.status}`,
        rank: i,
        publishedAt: cdxDate(r.timestamp),
        extra: {
          index: CC_INDEX,
          digest: r.digest,
          mime: r.mime,
          // locator the /v1/archive endpoint uses to fetch THIS capture (not the live page).
          archive: {
            provider: 'commoncrawl',
            url: r.url,
            timestamp: r.timestamp,
            filename: r.filename,
            offset: r.offset,
            length: r.length,
          },
        },
      }),
    );
  },
};

function cdxDate(ts?: string): string | undefined {
  if (!ts || ts.length < 14) return undefined;
  const [y, mo, d, h, mi, s] = [ts.slice(0, 4), ts.slice(4, 6), ts.slice(6, 8), ts.slice(8, 10), ts.slice(10, 12), ts.slice(12, 14)];
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}
