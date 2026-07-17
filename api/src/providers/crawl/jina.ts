// Jina Reader (r.jina.ai) — turns any URL into clean LLM-ready markdown. Free
// without a key (rate-limited); higher limits with an optional `jina` key.
import { httpText } from '../../http.js';
import { titleOf } from '../util.js';
import type { CrawlProvider, ProviderContext } from '../types.js';
import type { CrawlRequest, CrawlResult } from '../../types.js';

export const jina: CrawlProvider = {
  id: 'jina_reader',
  label: 'Jina AI Reader',
  category: 'crawl',
  accessType: 'free',
  defaultPriority: 40,
  rendersJs: true,
  cacheTtlSec: 3600,
  docsUrl: 'https://jina.ai/reader/',
  endpoint: 'GET https://r.jina.ai/{url}  (X-Return-Format: markdown)',
  description: 'Free URL→markdown reader for LLM grounding; optional key raises rate limits.',
  async crawl(req: CrawlRequest, ctx: ProviderContext): Promise<CrawlResult> {
    const key = await ctx.getKey('jina'); // optional
    const headers: Record<string, string> = {
      'X-Return-Format': req.formats.includes('html') ? 'html' : 'markdown',
    };
    if (key) headers.Authorization = `Bearer ${key}`;
    const body = await httpText(`https://r.jina.ai/${req.url}`, {
      provider: 'jina_reader',
      headers,
      timeoutMs: req.timeoutMs,
    });
    return {
      url: req.url,
      status: 200,
      title: titleOf(body),
      markdown: req.formats.includes('markdown') ? body : undefined,
      text: req.formats.includes('text') ? body.replace(/[#*_>`]/g, '').trim() : undefined,
      html: req.formats.includes('html') ? body : undefined,
      source: 'jina_reader',
    };
  },
};
