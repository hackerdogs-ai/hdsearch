// Exa — neural/embeddings-based web search. Commercial: per-user key in `exa`.
// Great for "find pages like this" semantic discovery; returns scored results.
import { httpJson, ProviderError } from '../../http.js';
import { mkResult } from '../util.js';
import type { SearchProvider, ProviderContext } from '../types.js';
import type { NormalizedResult, SearchRequest } from '../../types.js';

export const exa: SearchProvider = {
  id: 'exa',
  label: 'Exa Neural Search',
  category: 'search',
  accessType: 'freemium',
  defaultPriority: 240,
  modalities: ['web'],
  requiresKeys: ['exa'],
  cacheTtlSec: 1800,
  docsUrl: 'https://docs.exa.ai',
  endpoint: 'POST https://api.exa.ai/search {query, type:neural|keyword}',
  description: 'Neural (embeddings) web search for semantic discovery; relevance-scored results.',
  async search(req: SearchRequest, ctx: ProviderContext): Promise<NormalizedResult[]> {
    const key = await ctx.getKey('exa');
    if (!key) throw new ProviderError('exa', 'no exa api key configured', 401, false);
    const data = await httpJson<any>('https://api.exa.ai/search', {
      provider: 'exa',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ query: req.q, type: 'auto', numResults: Math.min(req.limit, 25) }),
    });
    const rows: any[] = data.results || [];
    return rows.slice(0, req.limit).map((r: any, i: number) =>
      mkResult('exa', 'web', {
        title: r.title || r.url,
        url: r.url,
        snippet: r.text?.slice(0, 300),
        rank: i,
        score: typeof r.score === 'number' ? r.score : undefined,
        publishedAt: r.publishedDate,
        author: r.author,
      }),
    );
  },
};
