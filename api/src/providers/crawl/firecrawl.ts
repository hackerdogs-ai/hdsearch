// Firecrawl (mendableai/firecrawl) — crawl/scrape API returning markdown + html
// + structured metadata. Commercial (also self-hostable). Per-user key `firecrawl`.
import { httpJson, ProviderError } from '../../http.js';
import type { CrawlProvider, ProviderContext } from '../types.js';
import type { CrawlRequest, CrawlResult } from '../../types.js';

const FIRECRAWL_BASE = process.env.HDSEARCH_FIRECRAWL_URL || 'https://api.firecrawl.dev';

export const firecrawl: CrawlProvider = {
  id: 'firecrawl',
  label: 'Firecrawl',
  category: 'crawl',
  accessType: 'freemium',
  defaultPriority: 210,
  rendersJs: true,
  requiresKeys: ['firecrawl'],
  cacheTtlSec: 3600,
  docsUrl: 'https://docs.firecrawl.dev',
  endpoint: 'POST https://api.firecrawl.dev/v1/scrape {url, formats}',
  description: 'Scrape/crawl API returning markdown + html + metadata; JS rendering. Self-hostable.',
  async crawl(req: CrawlRequest, ctx: ProviderContext): Promise<CrawlResult> {
    const key = await ctx.getKey('firecrawl');
    if (!key) throw new ProviderError('firecrawl', 'no firecrawl api key configured', 401, false);
    const formats: string[] = [];
    if (req.formats.includes('markdown')) formats.push('markdown');
    if (req.formats.includes('html')) formats.push('html');
    if (req.formats.includes('links')) formats.push('links');
    if (!formats.length) formats.push('markdown');
    const data = await httpJson<any>(`${FIRECRAWL_BASE}/v1/scrape`, {
      provider: 'firecrawl',
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      timeoutMs: req.timeoutMs,
      body: JSON.stringify({ url: req.url, formats, onlyMainContent: true }),
    });
    const d = data.data || data;
    return {
      url: req.url,
      finalUrl: d.metadata?.sourceURL || req.url,
      status: d.metadata?.statusCode || 200,
      title: d.metadata?.title,
      markdown: d.markdown,
      text: req.formats.includes('text') ? (d.markdown || '').replace(/[#*_>`]/g, '').trim() : undefined,
      html: d.html,
      links: d.links,
      metadata: d.metadata,
      source: 'firecrawl',
    };
  },
};
