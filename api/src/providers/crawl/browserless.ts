// Browserless — headless-browser-as-a-service. Reuses the already-running
// `hackerdogs-browserless` container (on hdnet, :3000). It renders JS and returns
// the final HTML via its /content API; we convert that to markdown/text/links/
// images locally. A solid JS-rendering crawl fallback alongside crawl4ai.
import { env } from '../../env.js';
import { httpFetch } from '../../http.js';
import { htmlToMarkdown, htmlToText, extractLinks, extractImages, titleOf } from '../util.js';
import type { CrawlProvider } from '../types.js';
import type { CrawlRequest, CrawlResult } from '../../types.js';

export const browserless: CrawlProvider = {
  id: 'browserless',
  label: 'Browserless (self-hosted BaaS)',
  category: 'crawl',
  accessType: 'self-hosted',
  defaultPriority: 30,
  rendersJs: true,
  capabilities: { screenshot: true, pdf: true },
  cacheTtlSec: 3600,
  docsUrl: 'https://docs.browserless.io/',
  endpoint: 'POST {BROWSERLESS_URL}/content {url}',
  description: 'Self-hosted headless-browser BaaS; renders JS and returns final HTML, full-page screenshot and PDF. Reuses hackerdogs-browserless.',
  async crawl(req: CrawlRequest): Promise<CrawlResult> {
    const base = env.browserlessUrl.replace(/\/$/, '');
    const ep = (path: string) =>
      env.browserlessToken ? `${base}/${path}?token=${encodeURIComponent(env.browserlessToken)}` : `${base}/${path}`;
    const wantShot = req.formats.includes('screenshot');
    const wantPdf = req.formats.includes('pdf');
    // text-derived formats still need the HTML; only fetch /content when one is asked.
    const wantHtml = ['markdown', 'text', 'html', 'links', 'images'].some((f) => req.formats.includes(f as any));

    const out: CrawlResult = { url: req.url, finalUrl: req.url, status: 200, source: 'browserless' };

    if (wantHtml) {
      const res = await httpFetch(ep('content'), {
        provider: 'browserless',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        timeoutMs: req.timeoutMs,
        body: JSON.stringify({ url: req.url, gotoOptions: { waitUntil: 'networkidle2' } }),
      });
      const html = await res.text();
      out.status = res.status;
      out.title = titleOf(html);
      out.markdown = req.formats.includes('markdown') ? htmlToMarkdown(html) : undefined;
      out.text = req.formats.includes('text') ? htmlToText(html) : undefined;
      out.html = req.formats.includes('html') ? html : undefined;
      out.links = req.formats.includes('links') ? extractLinks(html, req.url) : undefined;
      out.images = req.formats.includes('images') ? extractImages(html, req.url) : undefined;
    }

    // Dedicated binary endpoints return the raw bytes → base64 data URL.
    if (wantShot) {
      const res = await httpFetch(ep('screenshot'), {
        provider: 'browserless',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        timeoutMs: req.timeoutMs ?? 45000,
        body: JSON.stringify({ url: req.url, options: { fullPage: true, type: 'png' }, gotoOptions: { waitUntil: 'networkidle2' } }),
      });
      if (res.ok) out.screenshot = `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    }
    if (wantPdf) {
      const res = await httpFetch(ep('pdf'), {
        provider: 'browserless',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        timeoutMs: req.timeoutMs ?? 45000,
        body: JSON.stringify({ url: req.url, options: { printBackground: true, format: 'A4' }, gotoOptions: { waitUntil: 'networkidle2' } }),
      });
      if (res.ok) out.pdf = `data:application/pdf;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    }

    return out;
  },
};
