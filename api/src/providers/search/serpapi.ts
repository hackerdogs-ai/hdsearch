// SerpAPI — broadest engine coverage (80+ engines). Commercial: per-user key in
// `serpapi`. We map our modalities onto SerpAPI's `tbm`/engine params and
// normalize the heterogeneous result arrays it returns.
import { httpJson, ProviderError } from '../../http.js';
import { mkResult } from '../util.js';
import type { SearchProvider, ProviderContext } from '../types.js';
import type { Modality, NormalizedResult, SearchRequest } from '../../types.js';

// modality → SerpAPI engine/tbm + the result array key to read
const MAP: Record<string, { params: Record<string, string>; key: string; norm: Modality }> = {
  web: { params: { engine: 'google' }, key: 'organic_results', norm: 'web' },
  news: { params: { engine: 'google', tbm: 'nws' }, key: 'news_results', norm: 'news' },
  images: { params: { engine: 'google', tbm: 'isch' }, key: 'images_results', norm: 'images' },
  videos: { params: { engine: 'google', tbm: 'vid' }, key: 'video_results', norm: 'videos' },
  scholar: { params: { engine: 'google_scholar' }, key: 'organic_results', norm: 'scholar' },
  places: { params: { engine: 'google_maps', type: 'search' }, key: 'local_results', norm: 'places' },
};

export const serpapi: SearchProvider = {
  id: 'serpapi',
  label: 'SerpAPI',
  category: 'search',
  accessType: 'freemium',
  defaultPriority: 210,
  modalities: ['web', 'news', 'images', 'videos', 'scholar', 'places'],
  requiresKeys: ['serpapi'],
  cacheTtlSec: 3600,
  docsUrl: 'https://serpapi.com/search-api',
  endpoint: 'GET https://serpapi.com/search.json?engine=google&q={q}&api_key={key}',
  description: 'Structured SERP from 80+ engines incl. Scholar, Maps, News, Images, Videos.',
  async search(req: SearchRequest, ctx: ProviderContext): Promise<NormalizedResult[]> {
    const key = await ctx.getKey('serpapi');
    if (!key) throw new ProviderError('serpapi', 'no serpapi api key configured', 401, false);
    const conf = MAP[req.modality] || MAP.web!;
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('q', req.q);
    url.searchParams.set('api_key', key);
    url.searchParams.set('num', String(Math.min(req.limit, 100)));
    for (const [k, v] of Object.entries(conf.params)) url.searchParams.set(k, v);
    if (req.country) url.searchParams.set('gl', req.country.toLowerCase());
    if (req.lang) url.searchParams.set('hl', req.lang);
    if (req.page > 1) url.searchParams.set('start', String((req.page - 1) * req.limit));

    const data = await httpJson<any>(url.toString(), { provider: 'serpapi' });
    if (data.error) throw new ProviderError('serpapi', String(data.error), 400, false);
    const rows: any[] = data[conf.key] || [];
    const isPlaces = conf.norm === 'places';
    return rows.slice(0, req.limit).map((r: any, i: number) =>
      mkResult('serpapi', conf.norm, {
        title: r.title || r.name || r.url || 'result',
        url: r.website || r.link || r.url || r.product_link || r.original || '',
        snippet: isPlaces ? r.address || r.snippet : r.snippet || r.description || r.address,
        rank: r.position ?? i,
        publishedAt: r.date,
        thumbnail: r.thumbnail,
        imageUrl: r.original || (conf.norm === 'images' ? r.thumbnail : undefined),
        videoUrl: conf.norm === 'videos' ? r.link : undefined,
        extra: isPlaces
          ? {
              source: r.source,
              rating: r.rating,
              ratingCount: r.reviews,
              category: r.type,
              phone: r.phone,
              address: r.address,
              hours: r.hours || r.operating_hours,
              website: r.website,
              geo: r.gps_coordinates ? { lat: r.gps_coordinates.latitude, lon: r.gps_coordinates.longitude, label: r.title, kind: r.type } : undefined,
            }
          : { price: r.price, rating: r.rating, source: r.source },
      }),
    );
  },
};
