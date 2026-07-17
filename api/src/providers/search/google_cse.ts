// Google Programmable Search (CSE) JSON API. Commercial/freemium: needs both a
// `google_cse` API key and a `google_cse_cx` engine id. Supports web + image.
import { httpJson, ProviderError } from '../../http.js';
import { mkResult } from '../util.js';
import type { SearchProvider, ProviderContext } from '../types.js';
import type { NormalizedResult, SearchRequest } from '../../types.js';

export const googleCse: SearchProvider = {
  id: 'google_cse',
  label: 'Google Programmable Search',
  category: 'search',
  accessType: 'freemium',
  defaultPriority: 250,
  modalities: ['web', 'images'],
  requiresKeys: ['google_cse', 'google_cse_cx'],
  cacheTtlSec: 3600,
  docsUrl: 'https://developers.google.com/custom-search/v1/overview',
  endpoint: 'GET https://www.googleapis.com/customsearch/v1?key={key}&cx={cx}&q={q}',
  description: 'Google Custom/Programmable Search JSON API. 100 free queries/day; web + images.',
  async search(req: SearchRequest, ctx: ProviderContext): Promise<NormalizedResult[]> {
    const key = await ctx.getKey('google_cse');
    const cx = await ctx.getKey('google_cse_cx');
    if (!key || !cx) throw new ProviderError('google_cse', 'missing google_cse key/cx', 401, false);
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', key);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', req.q);
    url.searchParams.set('num', String(Math.min(req.limit, 10)));
    if (req.modality === 'images') url.searchParams.set('searchType', 'image');
    if (req.country) url.searchParams.set('gl', req.country.toLowerCase());
    if (req.lang) url.searchParams.set('hl', req.lang);
    if (req.page > 1) url.searchParams.set('start', String((req.page - 1) * Math.min(req.limit, 10) + 1));
    const data = await httpJson<any>(url.toString(), { provider: 'google_cse' });
    const rows: any[] = data.items || [];
    return rows.slice(0, req.limit).map((r: any, i: number) =>
      mkResult('google_cse', req.modality, {
        title: r.title || r.link,
        url: r.link,
        snippet: r.snippet,
        rank: i,
        imageUrl: req.modality === 'images' ? r.link : undefined,
        thumbnail: r.image?.thumbnailLink || r.pagemap?.cse_thumbnail?.[0]?.src,
      }),
    );
  },
};
