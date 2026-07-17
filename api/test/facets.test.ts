import { describe, it, expect } from 'vitest';
import { computeFacets } from '../src/facets.js';
import type { NormalizedResult } from '../src/types.js';

const r = (url: string, source: string, modality: any, publishedAt?: string): NormalizedResult => ({
  id: url,
  title: url,
  url,
  modality,
  source,
  publishedAt,
});

describe('computeFacets', () => {
  const results = [
    r('https://a.com/1', 'searxng', 'web', '2025-03-01'),
    r('https://a.com/2', 'searxng', 'web', '2025-06-01'),
    r('https://b.org/1', 'brave', 'news', '2024-01-01'),
  ];
  const facets = computeFacets(results);
  const byField = Object.fromEntries(facets.map((f) => [f.field, f]));

  it('counts sources', () => {
    const searxng = byField.source!.values.find((v) => v.value === 'searxng');
    expect(searxng!.count).toBe(2);
  });
  it('counts sites by host', () => {
    const a = byField.site!.values.find((v) => v.value === 'a.com');
    expect(a!.count).toBe(2);
  });
  it('extracts tld', () => {
    expect(byField.tld!.values.map((v) => v.value)).toEqual(expect.arrayContaining(['com', 'org']));
  });
  it('extracts year facet when dates present', () => {
    expect(byField.year!.values.map((v) => v.value)).toEqual(expect.arrayContaining(['2025', '2024']));
  });
});
