// Ahmia — the de-facto free darkweb search engine. It indexes Tor hidden services
// and is reachable over the CLEARNET (ahmia.fi). As of 2026 Ahmia's search form
// carries a hidden anti-bot token (a randomized name/value per page load); a bare
// /search/?q=… now 302-redirects to the home page. So we:
//   1. GET the home page, extract the hidden <input> token,
//   2. GET /search/?q=…&<token-name>=<token-value> to retrieve real results.
// If the clearnet path yields nothing and a Tor proxy is configured, we retry the
// same flow against Ahmia's .onion mirror over Tor (src/tor.ts).
import { env } from '../../env.js';
import { httpText } from '../../http.js';
import { torEnabled, torGet } from '../../tor.js';
import { mkResult, decodeEntities, stripHtml } from '../util.js';
import { log } from '../../logger.js';
import type { SearchProvider } from '../types.js';
import type { NormalizedResult, SearchRequest } from '../../types.js';

/** Extract the hidden anti-bot token (name + value) from the search form HTML. */
function extractToken(html: string): { name: string; value: string } | null {
  // the real token is the hidden input that is NOT the visible query field
  const re = /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1] && m[1] !== 'q') return { name: m[1], value: m[2] || '' };
  }
  return null;
}

function parseResults(html: string, limit: number): NormalizedResult[] {
  const out: NormalizedResult[] = [];
  const blockRe = /<li class="result"[\s\S]*?<\/li>/gi;
  let block: RegExpExecArray | null;
  let i = 0;
  while ((block = blockRe.exec(html)) && out.length < limit) {
    const seg = block[0];
    const titleM = seg.match(/<h4>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    const citeM = seg.match(/<cite>([\s\S]*?)<\/cite>/i);
    const descM = seg.match(/<p>([\s\S]*?)<\/p>/i);
    const onion = citeM ? stripHtml(citeM[1] || '') : '';
    const onionUrl = onion ? (onion.startsWith('http') ? onion : `http://${onion}`) : '';
    if (!onionUrl) continue;
    out.push(
      mkResult('ahmia', 'darkweb', {
        title: titleM ? decodeEntities(stripHtml(titleM[1] || '')) : onion,
        url: onionUrl,
        snippet: descM ? decodeEntities(stripHtml(descM[1] || '')) : undefined,
        rank: i++,
        extra: {
          network: 'tor',
          clearnetRedirect: `${env.ahmiaUrl}/search/redirect?redirect_url=${encodeURIComponent(onionUrl)}`,
        },
      }),
    );
  }
  return out;
}

async function searchClearnet(q: string, limit: number): Promise<NormalizedResult[]> {
  const home = await httpText(`${env.ahmiaUrl}/`, { provider: 'ahmia', retries: 1 });
  const tok = extractToken(home);
  const u = new URL('/search/', env.ahmiaUrl);
  u.searchParams.set('q', q);
  if (tok) u.searchParams.set(tok.name, tok.value);
  const html = await httpText(u.toString(), { provider: 'ahmia' });
  return parseResults(html, limit);
}

async function searchOnionViaTor(q: string, limit: number): Promise<NormalizedResult[]> {
  const home = await torGet(`${env.ahmiaOnion}/`, { timeoutMs: 60000 });
  const tok = extractToken(home.body);
  const u = new URL('/search/', env.ahmiaOnion);
  u.searchParams.set('q', q);
  if (tok) u.searchParams.set(tok.name, tok.value);
  const res = await torGet(u.toString(), { timeoutMs: 90000 });
  return parseResults(res.body, limit);
}

export const ahmia: SearchProvider = {
  id: 'ahmia',
  label: 'Ahmia (darkweb, free)',
  category: 'darkweb',
  accessType: 'free',
  defaultPriority: 100,
  modalities: ['darkweb'],
  cacheTtlSec: 1800,
  docsUrl: 'https://ahmia.fi/documentation/',
  endpoint: 'GET https://ahmia.fi/  (token) → /search/?q={q}&{token}  (+ .onion via Tor fallback)',
  description: 'Free Tor hidden-service search via clearnet (anti-bot token handled); falls back to the .onion mirror over Tor.',
  async search(req: SearchRequest): Promise<NormalizedResult[]> {
    // 1) clearnet with token
    try {
      const r = await searchClearnet(req.q, req.limit);
      if (r.length) return r;
    } catch (e) {
      log.debug('ahmia clearnet failed', { error: (e as Error).message });
    }
    // 2) Tor onion fallback
    if (torEnabled()) {
      try {
        return await searchOnionViaTor(req.q, req.limit);
      } catch (e) {
        log.warn('ahmia onion (tor) failed', { error: (e as Error).message });
      }
    }
    return [];
  },
};
