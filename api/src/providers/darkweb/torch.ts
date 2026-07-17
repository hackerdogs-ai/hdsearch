// Torch — one of the oldest Tor hidden-service search engines. Onion-only, so it
// REQUIRES the Tor proxy (HDSEARCH_TOR_PROXY). Onion addresses rot, so the address
// is configurable (HDSEARCH_TORCH_ONION) and the provider fails soft (returns []).
// Parsing is intentionally generic (anchor tags → .onion links) since Torch's
// markup changes; this gives breadth without brittle structure assumptions.
import { env } from '../../env.js';
import { torEnabled, torGet } from '../../tor.js';
import { mkResult, decodeEntities, stripHtml } from '../util.js';
import { log } from '../../logger.js';
import type { SearchProvider } from '../types.js';
import type { NormalizedResult, SearchRequest } from '../../types.js';

const ONION_RE = /([a-z2-7]{56}\.onion)/i;

export const torch: SearchProvider = {
  id: 'torch',
  label: 'Torch (darkweb, Tor-only)',
  category: 'darkweb',
  accessType: 'free',
  defaultPriority: 110,
  modalities: ['darkweb'],
  cacheTtlSec: 1800,
  docsUrl: 'https://en.wikipedia.org/wiki/Torch_(search_engine)',
  endpoint: 'GET {TORCH_ONION}/search?query={q}  (requires HDSEARCH_TOR_PROXY)',
  description: 'Classic Tor search engine (onion-only). Requires the Tor proxy; configurable onion address.',
  async search(req: SearchRequest): Promise<NormalizedResult[]> {
    if (!torEnabled()) return []; // onion-only; no Tor → nothing to do
    const u = new URL('/search', env.torchOnion);
    u.searchParams.set('query', req.q);
    u.searchParams.set('action', 'search');
    let html = '';
    try {
      const res = await torGet(u.toString(), { timeoutMs: 90000 });
      html = res.body;
    } catch (e) {
      log.warn('torch (tor) failed', { error: (e as Error).message });
      return [];
    }

    const out: NormalizedResult[] = [];
    const seen = new Set<string>();
    // generic: each <a href> whose target is an .onion becomes a result
    const re = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(html)) && out.length < req.limit) {
      const href = m[1] || '';
      if (!ONION_RE.test(href)) continue;
      const url = href.startsWith('http') ? href : `http://${href.replace(/^\/+/, '')}`;
      const title = decodeEntities(stripHtml(m[2] || '')).trim();
      if (!title || title.length < 2) continue;
      const key = url.replace(/\/+$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(mkResult('torch', 'darkweb', { title, url, rank: i++, extra: { network: 'tor' } }));
    }
    return out;
  },
};
