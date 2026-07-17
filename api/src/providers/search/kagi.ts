// Kagi Search API — premium independent index. Commercial: per-user key in `kagi`.
// API v1: POST https://kagi.com/api/v1/search with Bearer auth (see OpenAPI client).
import { httpJson, ProviderError } from '../../http.js';
import { mkResult } from '../util.js';
import type { SearchProvider, ProviderContext } from '../types.js';
import type { Modality, NormalizedResult, SearchRequest } from '../../types.js';

const WORKFLOW: Partial<Record<Modality, { workflow: string; dataKey: string; norm: Modality }>> = {
  web: { workflow: 'search', dataKey: 'search', norm: 'web' },
  news: { workflow: 'news', dataKey: 'news', norm: 'news' },
  images: { workflow: 'images', dataKey: 'image', norm: 'images' },
  videos: { workflow: 'videos', dataKey: 'video', norm: 'videos' },
};

export const kagi: SearchProvider = {
  id: 'kagi',
  label: 'Kagi Search',
  category: 'search',
  accessType: 'freemium',
  defaultPriority: 245,
  modalities: ['web', 'news', 'images', 'videos'],
  requiresKeys: ['kagi'],
  cacheTtlSec: 3600,
  docsUrl: 'https://help.kagi.com/kagi/api/search.html',
  endpoint: 'POST https://kagi.com/api/v1/search {query, workflow}',
  description:
    'Premium independent search index — web, news, images, videos; lenses, region filters, and account personalization.',
  async search(req: SearchRequest, ctx: ProviderContext): Promise<NormalizedResult[]> {
    const key = await ctx.getKey('kagi');
    if (!key) throw new ProviderError('kagi', 'no kagi api key configured', 401, false);
    const conf = WORKFLOW[req.modality] || WORKFLOW.web!;
    const body: Record<string, unknown> = {
      query: req.q,
      workflow: conf.workflow,
      limit: Math.min(req.limit, 1024),
      format: 'json',
      safe_search: req.safe !== false,
    };
    if (req.page > 1) body.page = Math.min(req.page, 10);
    if (req.country) body.filters = { region: req.country.toUpperCase() };

    const data = await httpJson<any>('https://kagi.com/api/v1/search', {
      provider: 'kagi',
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });

    const errMsg = data?.error?.message || data?.error || data?.meta?.error;
    if (errMsg) throw new ProviderError('kagi', String(errMsg), 400, false);

    const rows: any[] = data.data?.[conf.dataKey] || [];
    return rows.slice(0, req.limit).map((r: any, i: number) =>
      mkResult('kagi', conf.norm, {
        title: r.title || r.url,
        url: r.url,
        snippet: r.snippet,
        rank: i,
        publishedAt: r.time,
        thumbnail: r.image?.url || r.image?.thumbnail,
        imageUrl: conf.norm === 'images' ? r.url || r.image?.url : undefined,
        videoUrl: conf.norm === 'videos' ? r.url : undefined,
      }),
    );
  },
};
