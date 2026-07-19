// SearXNG — self-hosted privacy meta-search over 50+ engines, JSON API. Free, no
// key. Excellent breadth across modalities (web/news/images/videos). High prio.
import { env } from '../../env.js';
import { httpJson } from '../../http.js';
import { mkResult, stripHtml } from '../util.js';
import type { SearchProvider } from '../types.js';
import type { Modality, NormalizedResult, SearchRequest } from '../../types.js';

const CATEGORY: Record<Modality, string> = {
  web: 'general',
  news: 'news',
  images: 'images',
  videos: 'videos',
  maps: 'map',
  scholar: 'science',
  places: 'map',
  code: 'it',
  social: 'social media',
  archive: 'general',
  darkweb: 'general',
};

interface SearxResult {
  url: string;
  title: string;
  content?: string;
  img_src?: string;
  thumbnail?: string;
  thumbnail_src?: string;
  publishedDate?: string;
  author?: string;
  length?: string;
}

export const searxng: SearchProvider = {
  id: 'searxng',
  label: 'SearXNG (self-hosted meta-search)',
  category: 'search',
  accessType: 'self-hosted',
  defaultPriority: 20,
  modalities: ['web', 'news', 'images', 'videos', 'scholar', 'social', 'code'],
  cacheTtlSec: 1800,
  docsUrl: 'https://github.com/searxng/searxng',
  endpoint: 'GET {SEARXNG_URL}/search?q={q}&format=json&categories={cat}',
  description: 'Self-hosted meta-search aggregating 50+ engines with a JSON API. Free, no key.',
  async search(req: SearchRequest): Promise<NormalizedResult[]> {
    const url = new URL('/search', env.searxngUrl);
    url.searchParams.set('q', req.q);
    url.searchParams.set('format', 'json');
    url.searchParams.set('categories', CATEGORY[req.modality] || 'general');
    if (req.page > 1) url.searchParams.set('pageno', String(req.page));
    if (req.lang) url.searchParams.set('language', req.lang);
    if (req.safe) url.searchParams.set('safesearch', '1');
    if (req.freshness) url.searchParams.set('time_range', mapFreshness(req.freshness));
    const data = await httpJson<{ results?: SearxResult[] }>(url.toString(), { provider: 'searxng' });
    const rows = data.results || [];
    return rows.slice(0, req.limit).map((r, i) =>
      mkResult('searxng', req.modality, {
        title: r.title || r.url,
        url: r.url,
        snippet: r.content ? stripHtml(r.content) : undefined,
        rank: i,
        publishedAt: r.publishedDate,
        author: r.author,
        imageUrl: r.img_src,
        thumbnail: r.thumbnail_src || r.thumbnail,
        durationSec: parseDuration(r.length),
      }),
    );
  },
};

function mapFreshness(f: string): string {
  const m: Record<string, string> = { d: 'day', w: 'week', m: 'month', y: 'year' };
  return m[f[0]?.toLowerCase() || ''] || '';
}
function parseDuration(s?: unknown): number | undefined {
  if (s == null) return undefined;
  if (typeof s === 'number') return Number.isFinite(s) ? s : undefined; // already seconds
  if (typeof s !== 'string') return undefined; // searxng sometimes sends non-string lengths
  const parts = s.split(':').map(Number);
  if (parts.some(Number.isNaN)) return undefined;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
