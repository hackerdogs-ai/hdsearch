// Serper.dev — fast Google SERP optimized for LLMs. Commercial: per-user key in
// `serper`. POST JSON. Most generous free tier of the commercial SERP APIs.
import { httpJson, ProviderError } from '../../http.js';
import { mkResult } from '../util.js';
import type { SearchProvider, ProviderContext } from '../types.js';
import type { Modality, NormalizedResult, SearchRequest } from '../../types.js';

const PATH: Record<string, { path: string; key: string; norm: Modality }> = {
  web: { path: 'search', key: 'organic', norm: 'web' },
  news: { path: 'news', key: 'news', norm: 'news' },
  images: { path: 'images', key: 'images', norm: 'images' },
  videos: { path: 'videos', key: 'videos', norm: 'videos' },
  places: { path: 'places', key: 'places', norm: 'places' },
  shopping: { path: 'shopping', key: 'shopping', norm: 'shopping' },
  scholar: { path: 'scholar', key: 'organic', norm: 'scholar' },
};

export const serper: SearchProvider = {
  id: 'serper',
  label: 'Serper.dev',
  category: 'search',
  accessType: 'freemium',
  defaultPriority: 220,
  modalities: ['web', 'news', 'images', 'videos', 'places', 'shopping', 'scholar'],
  requiresKeys: ['serper'],
  cacheTtlSec: 3600,
  docsUrl: 'https://serper.dev',
  endpoint: 'POST https://google.serper.dev/{search|news|images|videos} {q}',
  description: 'Fast LLM-optimized Google SERP: organic, news, images, videos, places, shopping.',
  async search(req: SearchRequest, ctx: ProviderContext): Promise<NormalizedResult[]> {
    const key = await ctx.getKey('serper');
    if (!key) throw new ProviderError('serper', 'no serper api key configured', 401, false);
    const conf = PATH[req.modality] || PATH.web!;
    const body: Record<string, unknown> = { q: req.q, num: Math.min(req.limit, 100) };
    if (req.country) body.gl = req.country.toLowerCase();
    if (req.lang) body.hl = req.lang;
    if (req.page > 1) body.page = req.page;
    const data = await httpJson<any>(`https://google.serper.dev/${conf.path}`, {
      provider: 'serper',
      method: 'POST',
      headers: { 'X-API-KEY': key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const rows: any[] = data[conf.key] || [];
    const isPlaces = conf.norm === 'places';
    return rows.slice(0, req.limit).map((r: any, i: number) =>
      mkResult('serper', conf.norm, {
        title: r.title || r.url || 'result',
        url: r.website || r.link || r.url || '',
        snippet: isPlaces ? r.address || r.snippet : r.snippet || r.description,
        rank: r.position ?? i,
        publishedAt: r.date,
        thumbnail: r.imageUrl || r.thumbnailUrl,
        imageUrl: conf.norm === 'images' ? r.imageUrl : undefined,
        videoUrl: conf.norm === 'videos' ? r.link : undefined,
        durationSec: undefined,
        extra: isPlaces
          ? {
              source: r.source,
              rating: r.rating,
              ratingCount: r.ratingCount,
              category: r.category,
              phone: r.phoneNumber,
              address: r.address,
              website: r.website,
              geo: r.latitude && r.longitude ? { lat: r.latitude, lon: r.longitude, label: r.title, kind: r.category } : undefined,
            }
          : { source: r.source, price: r.price, rating: r.rating },
      }),
    );
  },
};
