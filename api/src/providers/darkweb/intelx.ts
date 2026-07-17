// Intelligence X — commercial darkweb / leak / paste / breach search with a real
// JSON API. Per-user key `intelx`. Two-phase API: POST a search → poll for
// results. We do a single bounded poll to keep latency sane for an API call.
import { httpJson, ProviderError } from '../../http.js';
import { mkResult } from '../util.js';
import type { SearchProvider, ProviderContext } from '../types.js';
import type { NormalizedResult, SearchRequest } from '../../types.js';

const INTELX_BASE = process.env.HDSEARCH_INTELX_URL || 'https://2.intelx.io';

export const intelx: SearchProvider = {
  id: 'intelx',
  label: 'Intelligence X (darkweb/leaks)',
  category: 'darkweb',
  accessType: 'commercial',
  defaultPriority: 300,
  modalities: ['darkweb'],
  requiresKeys: ['intelx'],
  cacheTtlSec: 1800,
  docsUrl: 'https://intelx.io/product',
  endpoint: 'POST {INTELX}/intelligent/search  then GET .../result',
  description: 'Commercial darkweb/leak/paste/breach intelligence search with a JSON API.',
  async search(req: SearchRequest, ctx: ProviderContext): Promise<NormalizedResult[]> {
    const key = await ctx.getKey('intelx');
    if (!key) throw new ProviderError('intelx', 'no intelx api key configured', 401, false);
    const headers = { 'x-key': key, 'content-type': 'application/json' };

    const started = await httpJson<{ id: string }>(`${INTELX_BASE}/intelligent/search`, {
      provider: 'intelx',
      method: 'POST',
      headers,
      body: JSON.stringify({ term: req.q, maxresults: Math.min(req.limit, 50), media: 0, timeout: 5 }),
    });
    if (!started.id) return [];

    const resUrl = new URL(`${INTELX_BASE}/intelligent/search/result`);
    resUrl.searchParams.set('id', started.id);
    resUrl.searchParams.set('limit', String(Math.min(req.limit, 50)));
    const data = await httpJson<any>(resUrl.toString(), { provider: 'intelx', headers });
    const records: any[] = data.records || [];
    return records.slice(0, req.limit).map((r: any, i: number) =>
      mkResult('intelx', 'darkweb', {
        title: r.name || r.systemid || 'record',
        url: r.systemid ? `https://intelx.io/?did=${r.systemid}` : r.name,
        snippet: `${r.bucket || ''} ${r.media ? `media:${r.media}` : ''}`.trim() || undefined,
        rank: i,
        publishedAt: r.date,
        extra: { bucket: r.bucket, type: r.type, systemid: r.systemid, network: 'darkweb' },
      }),
    );
  },
};
