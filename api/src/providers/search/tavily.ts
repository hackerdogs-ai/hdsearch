// Tavily — AI-native search built for agent grounding. Commercial: per-user key
// in `tavily`. Returns ranked web results with relevance scores + optional answer.
import { httpJson, ProviderError } from '../../http.js';
import { mkResult } from '../util.js';
import type { SearchProvider, ProviderContext } from '../types.js';
import type { NormalizedResult, SearchRequest } from '../../types.js';

export const tavily: SearchProvider = {
  id: 'tavily',
  label: 'Tavily AI Search',
  category: 'search',
  accessType: 'freemium',
  defaultPriority: 230,
  modalities: ['web', 'news'],
  requiresKeys: ['tavily'],
  cacheTtlSec: 1800,
  docsUrl: 'https://docs.tavily.com',
  endpoint: 'POST https://api.tavily.com/search {query, search_depth, topic}',
  description: 'AI-native search optimized for LLM grounding; relevance-scored results + answer.',
  async search(req: SearchRequest, ctx: ProviderContext): Promise<NormalizedResult[]> {
    const key = await ctx.getKey('tavily');
    if (!key) throw new ProviderError('tavily', 'no tavily api key configured', 401, false);
    const data = await httpJson<any>('https://api.tavily.com/search', {
      provider: 'tavily',
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query: req.q,
        topic: req.modality === 'news' ? 'news' : 'general',
        search_depth: 'basic',
        max_results: Math.min(req.limit, 20),
        include_images: req.modality === 'images',
      }),
    });
    const rows: any[] = data.results || [];
    return rows.slice(0, req.limit).map((r: any, i: number) =>
      mkResult('tavily', req.modality === 'news' ? 'news' : 'web', {
        title: r.title || r.url,
        url: r.url,
        snippet: r.content,
        rank: i,
        score: typeof r.score === 'number' ? r.score : undefined,
        publishedAt: r.published_date,
      }),
    );
  },
};
