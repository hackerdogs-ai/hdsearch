// Crawl4AI (unclecode/crawl4ai) — self-hosted LLM-friendly crawler. Free, no key
// → highest crawl priority. Renders JS, returns clean markdown + media. Talks to
// the crawl4ai REST server (default :11235).
import { env } from '../../env.js';
import { httpJson } from '../../http.js';
import type { CrawlProvider, ProviderContext } from '../types.js';
import type { CrawlRequest, CrawlResult } from '../../types.js';

export const crawl4ai: CrawlProvider = {
  id: 'crawl4ai',
  label: 'Crawl4AI (self-hosted)',
  category: 'crawl',
  accessType: 'self-hosted',
  defaultPriority: 10,
  rendersJs: true,
  capabilities: { screenshot: true, pdf: true },
  cacheTtlSec: 3600,
  docsUrl: 'https://github.com/unclecode/crawl4ai',
  endpoint: 'POST {CRAWL4AI_URL}/crawl {urls:[...]}',
  description: 'Self-hosted JS-rendering crawler returning LLM-ready markdown, links, media, full-page screenshot and PDF.',
  async crawl(req: CrawlRequest): Promise<CrawlResult> {
    const wantShot = req.formats.includes('screenshot');
    const wantPdf = req.formats.includes('pdf');
    const data = await httpJson<any>(`${env.crawl4aiUrl.replace(/\/$/, '')}/crawl`, {
      provider: 'crawl4ai',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // capturing a screenshot/PDF needs a full render — give it more headroom.
      timeoutMs: req.timeoutMs ?? (wantShot || wantPdf ? 45000 : undefined),
      body: JSON.stringify({
        urls: [req.url],
        crawler_config: {
          type: 'CrawlerRunConfig',
          params: {
            cache_mode: req.noCache ? 'BYPASS' : 'ENABLED',
            ...(wantShot ? { screenshot: true } : {}),
            ...(wantPdf ? { pdf: true } : {}),
          },
        },
      }),
    });
    // crawl4ai returns { results: [ { markdown, html, links, media, metadata, status_code, screenshot, pdf } ] }
    // screenshot is base64 PNG; pdf is base64 bytes.
    const r = data.results?.[0] || data;
    const md = typeof r.markdown === 'string' ? r.markdown : r.markdown?.raw_markdown;
    return {
      url: req.url,
      finalUrl: r.url || req.url,
      status: r.status_code || 200,
      title: r.metadata?.title,
      markdown: req.formats.includes('markdown') ? md : undefined,
      text: req.formats.includes('text') ? (r.cleaned_text || stripMd(md)) : undefined,
      html: req.formats.includes('html') ? r.html : undefined,
      links: req.formats.includes('links') ? extractLinkUrls(r.links) : undefined,
      images: req.formats.includes('images') ? (r.media?.images || []).map((m: any) => m.src).filter(Boolean) : undefined,
      videos: (r.media?.videos || []).map((m: any) => m.src).filter(Boolean),
      screenshot: wantShot && r.screenshot ? asDataUrl(r.screenshot, 'image/png') : undefined,
      pdf: wantPdf && r.pdf ? asDataUrl(r.pdf, 'application/pdf') : undefined,
      metadata: r.metadata,
      source: 'crawl4ai',
    };
  },
};

// crawl4ai returns base64 strings; tolerate an already-formed data URL too.
function asDataUrl(b64: string, mime: string): string {
  return b64.startsWith('data:') ? b64 : `data:${mime};base64,${b64}`;
}

function stripMd(md?: string): string | undefined {
  return md ? md.replace(/[#*_>`\[\]()]/g, ' ').replace(/\s+/g, ' ').trim() : undefined;
}
function extractLinkUrls(links: any): string[] {
  if (Array.isArray(links)) return links.map((l) => (typeof l === 'string' ? l : l.href)).filter(Boolean);
  if (links?.internal || links?.external) {
    return [...(links.internal || []), ...(links.external || [])].map((l: any) => l.href || l).filter(Boolean);
  }
  return [];
}
