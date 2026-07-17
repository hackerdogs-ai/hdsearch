import { describe, it, expect } from 'vitest';
import { canonicalUrl, dedupId, dedupe, rankAggregate } from '../src/normalize.js';
import type { NormalizedResult } from '../src/types.js';

describe('canonicalUrl', () => {
  it('lowercases host, strips www, default port, trailing slash', () => {
    expect(canonicalUrl('HTTPS://WWW.Example.com:443/Path/')).toBe('https://example.com/Path');
  });
  it('drops tracking params but keeps real ones, sorted', () => {
    const out = canonicalUrl('https://x.com/p?b=2&utm_source=g&a=1&fbclid=z');
    expect(out).toBe('https://x.com/p?a=1&b=2');
  });
  it('returns input on garbage', () => {
    expect(canonicalUrl('not a url')).toBe('not a url');
  });
});

describe('dedupId', () => {
  it('is stable across equivalent URLs (www/trailing-slash/case)', () => {
    expect(dedupId('https://www.example.com/a/')).toBe(dedupId('https://example.com/a'));
  });
  it('differs for different URLs', () => {
    expect(dedupId('https://a.com')).not.toBe(dedupId('https://b.com'));
  });
});

describe('dedupe', () => {
  const mk = (url: string, source: string, rank: number): NormalizedResult => ({
    id: dedupId(url),
    title: url,
    url,
    modality: 'web',
    source,
    rank,
  });
  it('merges duplicates and records provenance', () => {
    const res = dedupe([mk('https://x.com/a', 'searxng', 1), mk('https://www.x.com/a/', 'brave', 0)]);
    expect(res).toHaveLength(1);
    expect(res[0]!.mergedFrom?.sort()).toEqual(['brave', 'searxng']);
    expect(res[0]!.rank).toBe(0); // keeps better (lower) rank
  });
});

describe('rankAggregate', () => {
  it('boosts results corroborated by more engines', () => {
    const a: NormalizedResult = { id: 'a', title: 'a', url: 'https://a', modality: 'web', source: 's1', rank: 5, mergedFrom: ['s1', 's2'] };
    const b: NormalizedResult = { id: 'b', title: 'b', url: 'https://b', modality: 'web', source: 's1', rank: 0, mergedFrom: ['s1'] };
    const out = rankAggregate([b, a]);
    expect(out[0]!.id).toBe('a'); // 2 engines beats better rank from 1 engine
  });
});
