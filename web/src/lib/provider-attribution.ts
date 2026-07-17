/**
 * Upstream attribution rules for search results (TOS §6).
 * Shown in the UI when matching providers contributed to a response.
 */

export interface ProviderAttribution {
  id: string;
  label: string;
  href?: string;
}

const GOOGLE_POWERED = new Set(['serpapi', 'serper', 'google_cse', 'openserp', 'searxng']);
const BRAVE_POWERED = new Set(['brave']);
const KAGI_POWERED = new Set(['kagi']);
const WIKI_POWERED = new Set(['wikipedia']);
const ARCHIVE_WAYBACK = new Set(['wayback']);
const ARCHIVE_CC = new Set(['commoncrawl']);

function anyIn(set: Set<string>, ids: string[]): boolean {
  return ids.some((id) => set.has(id));
}

/** Collect attributions for engines used and per-result source labels. */
export function collectProviderAttributions(
  enginesUsed: { engine: string; ok: boolean }[],
  resultSources: string[] = [],
  modality?: string,
): ProviderAttribution[] {
  const okEngines = enginesUsed.filter((e) => e.ok).map((e) => e.engine);
  const ids = [...new Set([...okEngines, ...resultSources])];
  const out: ProviderAttribution[] = [];

  if (anyIn(GOOGLE_POWERED, ids)) {
    out.push({
      id: 'google',
      label: 'Powered by Google',
      href: 'https://www.google.com',
    });
  }
  if (anyIn(BRAVE_POWERED, ids)) {
    out.push({
      id: 'brave',
      label: 'Results from Brave Search',
      href: 'https://search.brave.com',
    });
  }
  if (anyIn(KAGI_POWERED, ids)) {
    out.push({
      id: 'kagi',
      label: 'Results from Kagi Search',
      href: 'https://kagi.com',
    });
  }
  if (anyIn(WIKI_POWERED, ids)) {
    out.push({
      id: 'wikipedia',
      label: 'Content from Wikipedia (CC BY-SA)',
      href: 'https://www.wikipedia.org',
    });
  }
  if (anyIn(ARCHIVE_WAYBACK, ids) || (modality === 'archive' && ids.includes('wayback'))) {
    out.push({
      id: 'wayback',
      label: 'Internet Archive Wayback Machine',
      href: 'https://archive.org',
    });
  }
  if (anyIn(ARCHIVE_CC, ids) || (modality === 'archive' && ids.includes('commoncrawl'))) {
    out.push({
      id: 'commoncrawl',
      label: 'Common Crawl',
      href: 'https://commoncrawl.org',
    });
  }
  if (modality === 'maps' || ids.includes('maps')) {
    out.push({
      id: 'osm',
      label: '© OpenStreetMap contributors',
      href: 'https://www.openstreetmap.org/copyright',
    });
  }

  return out;
}
