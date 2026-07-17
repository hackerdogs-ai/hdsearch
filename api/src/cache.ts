// Caching for the search engine. The Redis cache is load-bearing here: it is the
// primary defense against getting rate-limited or blocked by upstream search
// providers (spec §9). Two layers:
//   1. computed() — memoize a provider's normalized results per (engine,query)
//      with a per-source TTL. Single-flight collapses concurrent identical calls.
//   2. sendCached() — HTTP conditional caching (ETag/304, Cache-Control) for GETs.
import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import { redis, redisHealthy, markRedisDown, k } from './store.js';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');
const etagOf = (body: string) => `"${sha256(body).slice(0, 32)}"`;

interface HttpCacheOpts {
  maxAge: number;
  swr?: number;
  sie?: number;
  lastModified?: string | null;
}

export function sendCached(c: Context, data: unknown, opts: HttpCacheOpts): Response {
  const body = JSON.stringify(data);
  const etag = etagOf(body);
  const lastMod = opts.lastModified ? new Date(opts.lastModified).toUTCString() : undefined;
  const swr = opts.swr ?? Math.max(30, Math.floor(opts.maxAge / 2));
  const sie = opts.sie ?? 86400;

  c.header('ETag', etag);
  if (lastMod) c.header('Last-Modified', lastMod);
  c.header('Cache-Control', `public, max-age=${opts.maxAge}, stale-while-revalidate=${swr}, stale-if-error=${sie}`);
  c.header('Vary', 'Accept-Encoding');

  const inm = c.req.header('if-none-match');
  const ims = c.req.header('if-modified-since');
  const notModified =
    (inm && inm.split(/,\s*/).includes(etag)) ||
    (!inm && ims && lastMod && Date.parse(ims) >= Date.parse(lastMod));
  if (notModified) return c.body(null, 304);

  c.header('Content-Type', 'application/json; charset=utf-8');
  return c.body(body);
}

// ---- single-flight (per-process) ----
const inflight = new Map<string, Promise<any>>();
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Read a cached value (or null) without producing. */
export async function cacheGet<T>(namespace: string, key: string): Promise<T | null> {
  if (!redisHealthy()) return null;
  const rkey = k('cache', namespace, sha256(key).slice(0, 24));
  const cached = await redis.get(rkey).catch((e) => {
    markRedisDown(e);
    return null;
  });
  return cached ? (JSON.parse(cached) as T) : null;
}

/** Write a value with a TTL. Fire-and-forget; never blocks the caller. */
export function cacheSet(namespace: string, key: string, value: unknown, ttlSec: number): void {
  if (!redisHealthy()) return;
  const rkey = k('cache', namespace, sha256(key).slice(0, 24));
  redis.set(rkey, JSON.stringify(value), 'EX', Math.max(1, ttlSec)).catch((e) => markRedisDown(e));
}

export interface ComputedOpts<T> {
  /** When false, the value is neither read from nor written to Redis (e.g. empty search hits). */
  shouldCache?: (value: T) => boolean;
}

/** Memoize producer under (namespace,key) with a TTL + single-flight. */
export async function computed<T>(
  namespace: string,
  key: string,
  ttlSec: number,
  producer: () => Promise<T>,
  opts?: ComputedOpts<T>,
): Promise<{ value: T; hit: boolean }> {
  if (!redisHealthy()) return { value: await producer(), hit: false };
  const rkey = k('cache', namespace, sha256(key).slice(0, 24));
  const cacheable = (v: T) => !opts?.shouldCache || opts.shouldCache(v);
  const cached = await redis.get(rkey).catch((e) => {
    markRedisDown(e);
    return null;
  });
  if (cached) {
    const parsed = JSON.parse(cached) as T;
    if (cacheable(parsed)) return { value: parsed, hit: true };
  }
  const value = await singleFlight(rkey, async () => {
    const v = await producer();
    if (cacheable(v)) {
      redis.set(rkey, JSON.stringify(v), 'EX', Math.max(1, ttlSec)).catch((e) => markRedisDown(e));
    }
    return v;
  });
  return { value, hit: false };
}
