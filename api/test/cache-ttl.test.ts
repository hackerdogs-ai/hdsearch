import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CACHE_TTL_SEC,
  DEFAULT_MAX_CACHE_TTL_SEC,
  normalizeCacheTtlSec,
  resolveRequestCacheTtlSec,
  resolveUserCacheTtlSec,
} from '../src/cache-ttl.js';
import { CrawlRequestSchema, SearchRequestSchema } from '../src/types.js';

describe('resolveRequestCacheTtlSec', () => {
  const limits = { defaultSec: 900, maxSec: 3600 };

  it('uses default when ttl is omitted', () => {
    expect(resolveRequestCacheTtlSec(undefined, limits)).toBe(900);
    expect(resolveRequestCacheTtlSec(null, limits)).toBe(900);
  });

  it('uses requested ttl when within max', () => {
    expect(resolveRequestCacheTtlSec(1800, limits)).toBe(1800);
    expect(resolveRequestCacheTtlSec(3600, limits)).toBe(3600);
  });

  it('uses default when ttl is greater than hard max', () => {
    expect(resolveRequestCacheTtlSec(3601, limits)).toBe(900);
    expect(resolveRequestCacheTtlSec(86400, limits)).toBe(900);
  });

  it('uses default when ttl is non-positive', () => {
    expect(resolveRequestCacheTtlSec(0, limits)).toBe(900);
    expect(resolveRequestCacheTtlSec(-5, limits)).toBe(900);
  });

  it('floors fractional seconds', () => {
    expect(resolveRequestCacheTtlSec(1800.9, limits)).toBe(1800);
  });

  it('never returns a default above max', () => {
    expect(resolveRequestCacheTtlSec(undefined, { defaultSec: 86400, maxSec: 1800 })).toBe(1800);
  });

  it('built-in defaults are 15 min / 24 hr', () => {
    expect(DEFAULT_CACHE_TTL_SEC).toBe(900);
    expect(DEFAULT_MAX_CACHE_TTL_SEC).toBe(86400);
  });
});

describe('resolveUserCacheTtlSec / normalize (admin-bound, no per-plan clamp)', () => {
  it('normalize keeps every allowed option value (default admin max = 24 hr)', () => {
    expect(normalizeCacheTtlSec(900)).toBe(900);
    expect(normalizeCacheTtlSec(1800)).toBe(1800);
    expect(normalizeCacheTtlSec(3600)).toBe(3600);
    expect(normalizeCacheTtlSec(86400)).toBe(86400);
  });

  it('normalize falls back to the default for non-allowed values', () => {
    expect(normalizeCacheTtlSec(1234)).toBe(DEFAULT_CACHE_TTL_SEC);
    expect(normalizeCacheTtlSec('nope')).toBe(DEFAULT_CACHE_TTL_SEC);
  });

  it('resolveUser passes through a valid ttl and defaults when omitted', () => {
    expect(resolveUserCacheTtlSec(1800)).toBe(1800);
    expect(resolveUserCacheTtlSec(undefined)).toBe(DEFAULT_CACHE_TTL_SEC);
  });
});

describe('SearchRequestSchema ttl + noCache', () => {
  it('accepts optional ttl', () => {
    const parsed = SearchRequestSchema.safeParse({ q: 'cats', ttl: 1800 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.ttl).toBe(1800);
  });

  it('defaults noCache to false and omits ttl', () => {
    const parsed = SearchRequestSchema.safeParse({ q: 'cats' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.noCache).toBe(false);
      expect(parsed.data.ttl).toBeUndefined();
    }
  });

  it('rejects ttl below 1', () => {
    const parsed = SearchRequestSchema.safeParse({ q: 'cats', ttl: 0 });
    expect(parsed.success).toBe(false);
  });

  it('accepts noCache true alongside ttl', () => {
    const parsed = SearchRequestSchema.safeParse({ q: 'cats', ttl: 900, noCache: true });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.noCache).toBe(true);
      expect(parsed.data.ttl).toBe(900);
    }
  });
});

describe('CrawlRequestSchema ttl', () => {
  it('accepts optional ttl', () => {
    const parsed = CrawlRequestSchema.safeParse({ url: 'https://example.com', ttl: 600 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.ttl).toBe(600);
  });
});
