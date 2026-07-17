// Tor egress for .onion (darkweb) providers. Routes requests through the running
// SOCKS5 proxy (hackerdogs-tor-proxy :9050) using socks5h so DNS — including
// .onion names — is resolved at the proxy. Disabled (no-op) when HDSEARCH_TOR_PROXY
// is unset. Uses node http/https directly since global fetch (undici) has no SOCKS.
import http from 'node:http';
import https from 'node:https';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { env } from './env.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

let agent: SocksProxyAgent | null = null;
function torAgent(): SocksProxyAgent | null {
  if (!env.torProxy) return null;
  if (!agent) agent = new SocksProxyAgent(env.torProxy);
  return agent;
}

export function torEnabled(): boolean {
  return !!env.torProxy;
}

export interface TorResponse {
  status: number;
  body: string;
  url: string;
}

/** GET a URL (clearnet or .onion) over Tor. Follows up to `maxRedirects` hops. */
export function torGet(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; maxRedirects?: number } = {},
): Promise<TorResponse> {
  const a = torAgent();
  if (!a) return Promise.reject(new Error('tor proxy not configured (HDSEARCH_TOR_PROXY)'));
  const timeoutMs = opts.timeoutMs ?? 60000;
  const maxRedirects = opts.maxRedirects ?? 4;

  return new Promise<TorResponse>((resolve, reject) => {
    const go = (target: string, hops: number) => {
      let u: URL;
      try {
        u = new URL(target);
      } catch (e) {
        return reject(e);
      }
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(
        target,
        { agent: a, method: 'GET', headers: { 'user-agent': UA, accept: 'text/html', ...(opts.headers || {}) }, timeout: timeoutMs },
        (res) => {
          const code = res.statusCode || 0;
          // follow redirects (resolving relative Location against current url)
          if (code >= 300 && code < 400 && res.headers.location && hops < maxRedirects) {
            res.resume();
            return go(new URL(res.headers.location, target).toString(), hops + 1);
          }
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: code, body: data, url: target }));
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('tor request timeout')));
      req.end();
    };
    go(url, 0);
  });
}
