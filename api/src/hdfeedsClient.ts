// Server-to-server client for the /trends page (categorized headlines from indexed news).
import { env } from './env.js';
import { log, errFields } from './logger.js';

export interface TrendArticle {
  id: string;
  title: string;
  summary?: string;
  url?: string;
  source?: string;
  publishedAt?: string;
}

export const TREND_SECTIONS = [
  { id: 'news', label: 'News', category: 'breaking' },
  { id: 'cybersecurity', label: 'Cybersecurity', category: 'cyber' },
  { id: 'govt', label: 'Government', category: 'gov' },
  { id: 'gd', label: 'Geopolitics & defense', category: 'geopolitics' },
] as const;

interface HdFeedsSearchItem {
  title?: string;
  link?: string;
  summary?: string;
  published_at?: string;
  feed_id?: string;
  content_hash?: string;
  category?: string;
}

function hostOf(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** True when a string looks like a public news headline, not an internal catalogue slug. */
export function isNewsHeadline(title: string): boolean {
  const t = title.trim();
  if (t.length < 10) return false;
  if (/\s/.test(t)) return true;
  if (/^[\[(]/.test(t)) return true;
  if (/^[a-z0-9_-]+$/.test(t)) return false;
  return /[A-Z]/.test(t.slice(1));
}

function mapArticle(item: HdFeedsSearchItem): TrendArticle | null {
  const title = (item.title || '').trim();
  if (!isNewsHeadline(title)) return null;
  const id = [item.feed_id, item.content_hash].filter(Boolean).join(':') || title;
  const summary = (item.summary || '').trim().replace(/\s+/g, ' ');
  return {
    id,
    title,
    summary: summary ? summary.slice(0, 280) : undefined,
    url: item.link || undefined,
    source: hostOf(item.link),
    publishedAt: item.published_at || undefined,
  };
}

export function hdFeedsConfigured(): boolean {
  return !!(env.hdfeedsBaseUrl && (env.hdfeedsInternalSecret || env.hdfeedsApiKey));
}

function hdFeedsAuthHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'user-agent': 'hd-search/1.0 (+https://hackerdogs.ai)',
    accept: 'application/json',
  };
  if (env.hdfeedsInternalSecret) {
    h['x-hd-internal'] = env.hdfeedsInternalSecret;
    h['x-hd-service'] = env.hdfeedsServiceId;
  } else if (env.hdfeedsApiKey) {
    h['x-api-key'] = env.hdfeedsApiKey;
  }
  return h;
}

export async function pingHdFeeds(): Promise<boolean> {
  if (!env.hdfeedsBaseUrl) return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), env.hdfeedsTimeoutMs);
  try {
    const res = await fetch(`${env.hdfeedsBaseUrl}/v1/health`, {
      signal: ctrl.signal,
      headers: { 'user-agent': 'hd-search/1.0 (+https://hackerdogs.ai)' },
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Headlines for one category prefix (hdfeeds category filter is prefix match). */
export async function fetchCategoryHeadlines(
  category: string,
  windowHours: number,
  limit: number,
): Promise<TrendArticle[]> {
  if (!hdFeedsConfigured()) return [];
  const since = new Date(Date.now() - windowHours * 3600_000).toISOString();
  const url = new URL(`${env.hdfeedsBaseUrl}/v1/search`);
  url.searchParams.set('category', category);
  url.searchParams.set('since', since);
  url.searchParams.set('limit', String(Math.min(limit * 3, 40)));

  const maxAttempts = 3;
  const timeoutMs = Math.max(env.hdfeedsTimeoutMs, 12_000);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url.toString(), {
        signal: ctrl.signal,
        headers: hdFeedsAuthHeaders(),
      });
      if (!res.ok) {
        if (res.status >= 500 && attempt < maxAttempts) {
          log.warn('trends category fetch retry', { category, status: res.status, attempt });
          await sleep(250 * attempt);
          continue;
        }
        log.warn('trends category fetch failed', { category, status: res.status });
        return [];
      }
      const body = (await res.json()) as { data?: HdFeedsSearchItem[] };
      const out: TrendArticle[] = [];
      for (const item of body.data || []) {
        const article = mapArticle(item);
        if (!article) continue;
        out.push(article);
        if (out.length >= limit) break;
      }
      return out;
    } catch (e) {
      if (attempt < maxAttempts) {
        log.warn('trends category retry', { category, attempt, ...errFields(e) });
        await sleep(250 * attempt);
        continue;
      }
      log.warn('trends category unreachable', { category, ...errFields(e) });
      return [];
    } finally {
      clearTimeout(t);
    }
  }
  return [];
}
