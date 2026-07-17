// Wikipedia REST search — free, no key. Authoritative reference hits; great for
// grounding and entity lookups. Maps to 'web' modality.
import { httpJson } from '../../http.js';
import { mkResult } from '../util.js';
import type { SearchProvider } from '../types.js';
import type { NormalizedResult, SearchRequest } from '../../types.js';

interface WikiPage {
  key: string;
  title: string;
  description?: string;
  excerpt?: string;
  thumbnail?: { url?: string };
}

export const wikipedia: SearchProvider = {
  id: 'wikipedia',
  label: 'Wikipedia (free)',
  category: 'search',
  accessType: 'free',
  defaultPriority: 60,
  modalities: ['web'],
  cacheTtlSec: 86400,
  docsUrl: 'https://www.mediawiki.org/wiki/API:REST_API',
  endpoint: 'GET https://{lang}.wikipedia.org/w/rest.php/v1/search/page?q={q}',
  description: 'Free Wikipedia full-text search via the REST API. Authoritative reference snippets.',
  async search(req: SearchRequest): Promise<NormalizedResult[]> {
    const lang = (req.lang || 'en').slice(0, 2);
    const url = new URL(`https://${lang}.wikipedia.org/w/rest.php/v1/search/page`);
    url.searchParams.set('q', req.q);
    url.searchParams.set('limit', String(Math.min(req.limit, 50)));
    const data = await httpJson<{ pages?: WikiPage[] }>(url.toString(), { provider: 'wikipedia' });
    return (data.pages || []).map((p, i) =>
      mkResult('wikipedia', 'web', {
        title: p.title,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.key)}`,
        snippet: (p.excerpt || p.description || '').replace(/<[^>]+>/g, ''),
        rank: i,
        thumbnail: p.thumbnail?.url ? `https:${p.thumbnail.url}` : undefined,
      }),
    );
  },
};
