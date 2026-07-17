// Internet Archive Wayback Machine — the largest public web archive. We query its
// CDX index for captures of a URL/host and return each capture as an `archive`
// result that links straight to the rendered snapshot on web.archive.org. Unlike
// Common Crawl, the Wayback snapshot is a hosted, browsable page (no WARC fetch
// needed), and the CDX endpoint is far more reliably reachable.
import { httpText } from '../../http.js';
import { mkResult } from '../util.js';
import type { SearchProvider } from '../types.js';
import type { NormalizedResult, SearchRequest } from '../../types.js';

const CDX = 'https://web.archive.org/cdx/search/cdx';

export const wayback: SearchProvider = {
  id: 'wayback',
  label: 'Wayback Machine (Internet Archive)',
  category: 'search',
  accessType: 'free',
  defaultPriority: 70,
  modalities: ['archive', 'web'],
  cacheTtlSec: 86400,
  docsUrl: 'https://archive.org/help/wayback_api.php',
  endpoint: 'GET https://web.archive.org/cdx/search/cdx?url={q}&output=json',
  description: 'Internet Archive Wayback Machine. Query the CDX index for captures; results link to the rendered snapshot.',
  async search(req: SearchRequest): Promise<NormalizedResult[]> {
    const u = new URL(CDX);
    // CDX works on URL patterns; a bare term is treated as a host glob.
    const pattern = /[./]/.test(req.q) ? req.q : `${req.q}*`;
    u.searchParams.set('url', pattern);
    u.searchParams.set('output', 'json');
    u.searchParams.set('filter', 'statuscode:200');
    u.searchParams.set('collapse', 'digest'); // drop identical re-captures
    u.searchParams.set('fl', 'timestamp,original,mimetype,statuscode,digest');
    u.searchParams.set('limit', String(-Math.min(req.limit, 100))); // negative → most recent first
    // the CDX index can take several seconds — give it generous headroom.
    const body = await httpText(u.toString(), { provider: 'wayback', timeoutMs: 25000 });
    let rows: string[][];
    try {
      rows = JSON.parse(body) as string[][];
    } catch {
      return [];
    }
    const header = rows?.[0];
    if (!Array.isArray(rows) || rows.length < 2 || !header) return [];
    const iTs = header.indexOf('timestamp');
    const iUrl = header.indexOf('original');
    const iMime = header.indexOf('mimetype');
    const iStatus = header.indexOf('statuscode');
    const iDigest = header.indexOf('digest');
    if (iTs < 0 || iUrl < 0) return [];
    return rows
      .slice(1)
      .filter((r) => r[iTs] && r[iUrl] && /html|text/.test((iMime >= 0 ? r[iMime] : '') || 'text/html'))
      .slice(0, req.limit)
      .map((r, i) => {
        const ts = r[iTs] as string;
        const original = r[iUrl] as string;
        const snapshotUrl = `https://web.archive.org/web/${ts}/${original}`;
        return mkResult('wayback', 'archive', {
          title: original,
          url: original,
          snippet: `Captured ${cdxDate(ts) || ts} · ${r[iMime] || 'text/html'} · HTTP ${r[iStatus] || '200'} · Internet Archive`,
          rank: i,
          publishedAt: cdxDate(ts),
          extra: {
            digest: r[iDigest],
            mime: r[iMime],
            // archive locator consumed by the web result + /v1/archive (provider=wayback).
            archive: { provider: 'wayback', url: original, timestamp: ts, snapshotUrl },
          },
        });
      });
  },
};

function cdxDate(ts?: string): string | undefined {
  if (!ts || ts.length < 14) return undefined;
  const [y, mo, d, h, mi, s] = [ts.slice(0, 4), ts.slice(4, 6), ts.slice(6, 8), ts.slice(8, 10), ts.slice(10, 12), ts.slice(12, 14)];
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}
