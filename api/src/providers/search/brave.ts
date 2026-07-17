// Brave Search API — independent index (not a Google/Bing reseller). Commercial
// (freemium): needs a per-user key in `brave` field. Rich modalities: web/news/
// images/videos. Lower priority than free/self-hosted by default (spec §7).
import { httpJson } from '../../http.js';
import { ProviderError } from '../../http.js';
import { mkResult, stripHtml } from '../util.js';
import type { SearchProvider, ProviderContext } from '../types.js';
import type { Modality, NormalizedResult, SearchRequest } from '../../types.js';

const ENDPOINT: Record<string, string> = {
  web: 'https://api.search.brave.com/res/v1/web/search',
  news: 'https://api.search.brave.com/res/v1/news/search',
  images: 'https://api.search.brave.com/res/v1/images/search',
  videos: 'https://api.search.brave.com/res/v1/videos/search',
};

export const brave: SearchProvider = {
  id: 'brave',
  label: 'Brave Search API',
  category: 'search',
  accessType: 'freemium',
  defaultPriority: 200,
  modalities: ['web', 'news', 'images', 'videos'],
  requiresKeys: ['brave'],
  cacheTtlSec: 3600,
  docsUrl: 'https://brave.com/search/api/',
  endpoint: 'GET https://api.search.brave.com/res/v1/{web|news|images|videos}/search?q={q}',
  description: 'Independent privacy-preserving index with full SERP across web/news/images/videos.',
  async search(req: SearchRequest, ctx: ProviderContext): Promise<NormalizedResult[]> {
    const key = await ctx.getKey('brave');
    if (!key) throw new ProviderError('brave', 'no brave api key configured', 401, false);
    const modality: Modality = ENDPOINT[req.modality] ? req.modality : 'web';
    const url = new URL(ENDPOINT[modality]!);
    url.searchParams.set('q', req.q);
    url.searchParams.set('count', String(Math.min(req.limit, 20)));
    if (req.country) url.searchParams.set('country', req.country.toUpperCase());
    if (req.lang) url.searchParams.set('search_lang', req.lang);
    url.searchParams.set('safesearch', req.safe ? 'moderate' : 'off');
    if (req.freshness && modality !== 'images') url.searchParams.set('freshness', req.freshness[0]!.toLowerCase());

    const data = await httpJson<any>(url.toString(), {
      provider: 'brave',
      headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
    });

    const rows: any[] =
      data.web?.results || data.results || data.news?.results || [];
    return rows.slice(0, req.limit).map((r: any, i: number) =>
      mkResult('brave', modality, {
        title: r.title || r.url,
        url: r.url || r.link,
        snippet: stripHtml(r.description || r.snippet || ''),
        rank: i,
        publishedAt: r.age || r.page_age,
        thumbnail: r.thumbnail?.src || r.thumbnail,
        imageUrl: modality === 'images' ? r.properties?.url || r.image : undefined,
        videoUrl: modality === 'videos' ? r.url : undefined,
      }),
    );
  },
};
