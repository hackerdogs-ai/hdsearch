// DuckDuckGo — free, no key. Two surfaces:
//   • Instant Answer API (api.duckduckgo.com) for zero-click answers/entities.
//   • HTML lite endpoint (html.duckduckgo.com/html) for organic web results.
// Used as a free fallback that needs no account. Be polite (DDG throttles).
import { httpJson, httpText } from '../../http.js';
import { mkResult, decodeEntities, stripHtml } from '../util.js';
import type { SearchProvider } from '../types.js';
import type { NormalizedResult, SearchRequest } from '../../types.js';

interface DdgInstant {
  AbstractText?: string;
  AbstractURL?: string;
  Heading?: string;
  RelatedTopics?: { Text?: string; FirstURL?: string }[];
}

export const duckduckgo: SearchProvider = {
  id: 'duckduckgo',
  label: 'DuckDuckGo (free, no key)',
  category: 'search',
  accessType: 'free',
  defaultPriority: 30,
  modalities: ['web'],
  cacheTtlSec: 3600,
  docsUrl: 'https://duckduckgo.com',
  endpoint: 'GET https://html.duckduckgo.com/html/?q={q}  (+ api.duckduckgo.com instant answers)',
  description: 'Free DuckDuckGo web results + instant answers. No key, unofficial, rate-limited.',
  async search(req: SearchRequest): Promise<NormalizedResult[]> {
    const out: NormalizedResult[] = [];

    // 1) instant answer (cheap, gives an authoritative top hit when present)
    try {
      const ia = new URL('https://api.duckduckgo.com/');
      ia.searchParams.set('q', req.q);
      ia.searchParams.set('format', 'json');
      ia.searchParams.set('no_html', '1');
      ia.searchParams.set('no_redirect', '1');
      const data = await httpJson<DdgInstant>(ia.toString(), { provider: 'duckduckgo', retries: 1 });
      if (data.AbstractText && data.AbstractURL) {
        out.push(
          mkResult('duckduckgo', 'web', {
            title: data.Heading || req.q,
            url: data.AbstractURL,
            snippet: data.AbstractText,
            rank: 0,
            extra: { type: 'instant_answer' },
          }),
        );
      }
    } catch {
      /* instant answers are best-effort */
    }

    // 2) organic web results from the HTML lite endpoint
    const html = new URL('https://html.duckduckgo.com/html/');
    html.searchParams.set('q', req.q);
    if (req.country) html.searchParams.set('kl', req.country.toLowerCase());
    const body = await httpText(html.toString(), {
      provider: 'duckduckgo',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    let i = out.length;
    while ((m = re.exec(body)) && out.length < req.limit) {
      const url = unwrapDdg(m[1]!);
      const title = decodeEntities(stripHtml(m[2] || ''));
      if (!url || !title) continue;
      out.push(mkResult('duckduckgo', 'web', { title, url, rank: i++ }));
    }
    return out.slice(0, req.limit);
  },
};

// DDG wraps result links as /l/?uddg=<encoded-url>
function unwrapDdg(href: string): string {
  try {
    if (href.startsWith('//')) href = 'https:' + href;
    const u = new URL(href, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : u.toString();
  } catch {
    return href;
  }
}
