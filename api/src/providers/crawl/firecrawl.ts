// Firecrawl (mendableai/firecrawl) — crawl/scrape API returning markdown + html
// + structured metadata. Commercial (also self-hostable). Per-user key `firecrawl`.
import { env } from '../../env.js';
import { httpJson, ProviderError } from '../../http.js';
import type { CrawlProvider, ProviderContext } from '../types.js';
import type { CrawlRequest, CrawlResult } from '../../types.js';

// Point HDSEARCH_FIRECRAWL_URL (or the setup wizard) at a self-hosted instance —
// see docker-compose-firecrawl.yml. A self-hosted Firecrawl runs with
// USE_DB_AUTHENTICATION=false and needs NO api key, so we only demand the
// credential when talking to the hosted service.
const CLOUD_BASE = 'https://api.firecrawl.dev';
const FIRECRAWL_BASE = env.firecrawlUrl || CLOUD_BASE;
const SELF_HOSTED = FIRECRAWL_BASE !== CLOUD_BASE;

export const firecrawl: CrawlProvider = {
  id: 'firecrawl',
  label: 'Firecrawl',
  category: 'crawl',
  accessType: SELF_HOSTED ? 'self-hosted' : 'freemium',
  defaultPriority: 210,
  rendersJs: true,
  // Self-hosted needs no credential, so it also shows as available in /v1/engines.
  requiresKeys: SELF_HOSTED ? [] : ['firecrawl'],
  cacheTtlSec: 3600,
  docsUrl: 'https://docs.firecrawl.dev',
  endpoint: 'POST {FIRECRAWL_URL}/v1/scrape {url, formats}',
  description: 'Scrape/crawl API returning markdown + html + metadata; JS rendering. Self-hostable.',
  async crawl(req: CrawlRequest, ctx: ProviderContext): Promise<CrawlResult> {
    const key = await ctx.getKey('firecrawl');
    if (!key && !SELF_HOSTED) {
      throw new ProviderError('firecrawl', 'no firecrawl api key configured', 401, false);
    }
    const formats: string[] = [];
    if (req.formats.includes('markdown')) formats.push('markdown');
    if (req.formats.includes('html')) formats.push('html');
    if (req.formats.includes('links')) formats.push('links');
    if (!formats.length) formats.push('markdown');
    const data = await httpJson<any>(`${FIRECRAWL_BASE}/v1/scrape`, {
      provider: 'firecrawl',
      method: 'POST',
      // A self-hosted instance ignores auth; still send it when a key is present.
      headers: {
        'content-type': 'application/json',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
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
