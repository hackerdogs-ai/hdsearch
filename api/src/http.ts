// Shared resilient HTTP client for providers: timeout (AbortController), bounded
// retries with exponential backoff + jitter, and a typed error that records which
// provider/status failed so the engine can decide whether to fall through to the
// next provider. Every outbound provider call goes through here.
import { env } from './env.js';
import { log, errFields } from './logger.js';

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
    public retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface FetchOpts extends RequestInit {
  provider: string;
  timeoutMs?: number;
  retries?: number;
  /** treat these statuses as non-retryable hard failures */
  expectJson?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

async function once(url: string, opts: FetchOpts): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? env.providerTimeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'user-agent': 'hd-search/1.0 (+https://hackerdogs.ai)', ...(opts.headers || {}) },
    });
    return res;
  } finally {
    clearTimeout(t);
  }
}

/** Fetch with retries. Returns the Response (caller reads body). Throws ProviderError. */
export async function httpFetch(url: string, opts: FetchOpts): Promise<Response> {
  const retries = opts.retries ?? env.providerRetries;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await once(url, opts);
      if (res.ok) return res;
      const retryable = RETRYABLE_STATUS.has(res.status);
      if (!retryable || attempt === retries) {
        throw new ProviderError(opts.provider, `HTTP ${res.status} from ${opts.provider}`, res.status, retryable);
      }
      lastErr = new ProviderError(opts.provider, `HTTP ${res.status}`, res.status, true);
      // honor Retry-After (seconds or HTTP-date) on 429/503 before backing off
      const ra = res.headers.get('retry-after');
      if (ra) {
        const secs = /^\d+$/.test(ra) ? parseInt(ra, 10) : Math.max(0, Math.round((Date.parse(ra) - Date.now()) / 1000));
        if (secs > 0) {
          await sleep(Math.min(secs, 8) * 1000); // cap so we don't hang a request
          continue;
        }
      }
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      const provErr =
        e instanceof ProviderError
          ? e
          : new ProviderError(opts.provider, aborted ? 'timeout' : String((e as Error).message ?? e), undefined, true);
      lastErr = provErr;
      if (e instanceof ProviderError && !e.retryable) throw e;
      if (attempt === retries) throw provErr;
    }
    const backoff = Math.min(2000, 150 * 2 ** attempt) + Math.floor(Math.random() * 100);
    log.debug('provider retry', { provider: opts.provider, attempt: attempt + 1, backoff });
    await sleep(backoff);
  }
  throw lastErr instanceof Error ? lastErr : new ProviderError(opts.provider, 'unknown error');
}

/** Convenience: fetch + parse JSON. */
export async function httpJson<T = any>(url: string, opts: FetchOpts): Promise<T> {
  const res = await httpFetch(url, opts);
  try {
    return (await res.json()) as T;
  } catch (e) {
    throw new ProviderError(opts.provider, `invalid JSON from ${opts.provider}`, res.status, false);
  }
}

/** Convenience: fetch + return text. */
export async function httpText(url: string, opts: FetchOpts): Promise<string> {
  const res = await httpFetch(url, opts);
  return res.text();
}

export function logProviderError(provider: string, e: unknown): void {
  log.warn('provider failed', { provider, ...errFields(e) });
}
