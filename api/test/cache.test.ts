import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRequestCacheTtlSec } from '../src/cache-ttl.js';

type Entry = { value: string; expiresAt: number };

const mem = new Map<string, Entry>();
const setCalls: Array<{ key: string; ttl: number; value: string }> = [];

const fakeRedis = {
  async get(key: string) {
    const e = mem.get(key);
    if (!e) return null;
    if (Date.now() >= e.expiresAt) {
      mem.delete(key);
      return null;
    }
    return e.value;
  },
  async set(key: string, value: string, mode?: string, ttl?: number) {
    const ttlSec = mode === 'EX' && typeof ttl === 'number' ? ttl : 60;
    setCalls.push({ key, ttl: ttlSec, value });
    mem.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
    return 'OK';
  },
};

vi.mock('../src/store.js', () => ({
  redis: fakeRedis,
  redisHealthy: () => true,
  markRedisDown: () => {},
  k: (...parts: string[]) => ['hds', ...parts].join(':'),
}));

const { computed, cacheGet, cacheSet } = await import('../src/cache.js');

beforeEach(() => {
  mem.clear();
  setCalls.length = 0;
});

describe('computed() Redis result cache', () => {
  it('misses then hits, writing EX ttl from resolved request TTL', async () => {
    const ttl = resolveRequestCacheTtlSec(1800, { defaultSec: 900, maxSec: 3600 });
    expect(ttl).toBe(1800);

    let calls = 0;
    const producer = async () => {
      calls += 1;
      return [{ id: '1', title: 'a' }];
    };

    const first = await computed('search', 'q=cats', ttl, producer);
    expect(first.hit).toBe(false);
    expect(first.value).toEqual([{ id: '1', title: 'a' }]);
    expect(calls).toBe(1);
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]!.ttl).toBe(1800);

    const second = await computed('search', 'q=cats', ttl, producer);
    expect(second.hit).toBe(true);
    expect(second.value).toEqual([{ id: '1', title: 'a' }]);
    expect(calls).toBe(1); // producer not called again
  });

  it('uses admin default TTL when requested ttl exceeds hard max', async () => {
    const ttl = resolveRequestCacheTtlSec(99999, { defaultSec: 900, maxSec: 3600 });
    expect(ttl).toBe(900);

    await computed('search', 'q=dogs', ttl, async () => [{ id: '2' }]);
    expect(setCalls[0]!.ttl).toBe(900);
  });

  it('does not cache empty results when shouldCache is false', async () => {
    let calls = 0;
    const producer = async () => {
      calls += 1;
      return [] as unknown[];
    };

    const a = await computed('search', 'q=empty', 900, producer, {
      shouldCache: (rows) => rows.length > 0,
    });
    expect(a.hit).toBe(false);
    expect(setCalls).toHaveLength(0);

    const b = await computed('search', 'q=empty', 900, producer, {
      shouldCache: (rows) => rows.length > 0,
    });
    expect(b.hit).toBe(false);
    expect(calls).toBe(2);
  });

  it('cacheGet / cacheSet round-trip', async () => {
    cacheSet('search', 'round', { ok: true }, 60);
    await Promise.resolve();
    const got = await cacheGet<{ ok: boolean }>('search', 'round');
    expect(got).toEqual({ ok: true });
  });

  it('single-flight collapses concurrent identical producers', async () => {
    let calls = 0;
    const producer = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return { n: calls };
    };

    const [a, b] = await Promise.all([
      computed('search', 'q=sf', 900, producer),
      computed('search', 'q=sf', 900, producer),
    ]);
    expect(calls).toBe(1);
    expect(a.value).toEqual(b.value);
    expect(a.hit).toBe(false);
    expect(b.hit).toBe(false);
  });
});
