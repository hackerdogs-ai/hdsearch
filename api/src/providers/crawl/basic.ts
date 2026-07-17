// Built-in fetch crawler — last-resort fallback that needs no external service.
// Plain HTTP GET + local readability extraction. No JS rendering, but guarantees
// the crawl endpoint always returns *something* when self-hosted/commercial
// crawlers are unavailable. Lowest priority.
import { httpFetch } from '../../http.js';
import { htmlToMarkdown, htmlToText, extractLinks, extractImages, titleOf } from '../util.js';
import type { CrawlProvider } from '../types.js';
import type { CrawlRequest, CrawlResult } from '../../types.js';

export const basicCrawler: CrawlProvider = {
  id: 'basic',
  label: 'Built-in fetch crawler',
  category: 'crawl',
  accessType: 'self-hosted',
  defaultPriority: 990,
  rendersJs: false,
  cacheTtlSec: 1800,
  docsUrl: '',
  endpoint: 'internal',
  description: 'Dependency-free HTTP fetch + local readability extraction. Always-available fallback.',
  async crawl(req: CrawlRequest): Promise<CrawlResult> {
    const res = await httpFetch(req.url, { provider: 'basic', timeoutMs: req.timeoutMs, retries: 1 });
    const html = await res.text();
    const base = res.url || req.url;
    return {
      url: req.url,
      finalUrl: base,
      status: res.status,
      title: titleOf(html),
      markdown: req.formats.includes('markdown') ? htmlToMarkdown(html) : undefined,
      text: req.formats.includes('text') ? htmlToText(html) : undefined,
      html: req.formats.includes('html') ? html : undefined,
      links: req.formats.includes('links') ? extractLinks(html, base) : undefined,
      images: req.formats.includes('images') ? extractImages(html, base) : undefined,
      source: 'basic',
    };
  },
};
