// GDELT 2.0 Doc API — free, no key. Global news monitoring across 100+ languages.
// Strong 'news' modality with image extraction. No account required.
import { httpJson } from '../../http.js';
import { mkResult } from '../util.js';
import type { SearchProvider } from '../types.js';
import type { NormalizedResult, SearchRequest } from '../../types.js';

interface GdeltArticle {
  url: string;
  title: string;
  seendate?: string;
  socialimage?: string;
  domain?: string;
  language?: string;
}

export const gdelt: SearchProvider = {
  id: 'gdelt',
  label: 'GDELT Project (free news)',
  category: 'search',
  accessType: 'free',
  defaultPriority: 65,
  modalities: ['news'],
  cacheTtlSec: 900,
  docsUrl: 'https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/',
  endpoint: 'GET https://api.gdeltproject.org/api/v2/doc/doc?query={q}&mode=ArtList&format=json',
  description: 'Free global news search (100+ languages) via the GDELT Doc 2.0 API. No key.',
  async search(req: SearchRequest): Promise<NormalizedResult[]> {
    const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    url.searchParams.set('query', req.q);
    url.searchParams.set('mode', 'ArtList');
    url.searchParams.set('format', 'json');
    url.searchParams.set('maxrecords', String(Math.min(req.limit, 75)));
    url.searchParams.set('sort', 'DateDesc');
    if (req.freshness) url.searchParams.set('timespan', mapTimespan(req.freshness));
    // GDELT rate-limits aggressively (429); allow extra retries (Retry-After is
    // honored by httpFetch when present) before falling through to other engines.
    const data = await httpJson<{ articles?: GdeltArticle[] }>(url.toString(), { provider: 'gdelt', retries: 3 });
    return (data.articles || []).map((a, i) =>
      mkResult('gdelt', 'news', {
        title: a.title || a.url,
        url: a.url,
        rank: i,
        publishedAt: a.seendate,
        thumbnail: a.socialimage,
        extra: { domain: a.domain, language: a.language },
      }),
    );
  },
};

function mapTimespan(f: string): string {
  const m: Record<string, string> = { d: '1d', w: '1w', m: '1m', y: '12m' };
  return m[f[0]?.toLowerCase() || ''] || '1w';
}
