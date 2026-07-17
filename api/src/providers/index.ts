// Provider registry. To add a new search/crawl/darkweb service: implement the
// SearchProvider/CrawlProvider interface in a file under search|crawl|darkweb and
// add it to the arrays below. The engine discovers everything from here (spec §7).
import type { AnyProvider, SearchProvider, CrawlProvider } from './types.js';
import { isSearch, isCrawl } from './types.js';
import { priorityOf, isEnabled } from '../priorities.js';
import { hasKeysFor } from '../keystore.js';
import { getProviderPrefs, isProviderDisabled, userPriority, type ProviderPrefs } from '../provider-prefs.js';
import type { Modality } from '../types.js';

// ---- search + darkweb providers ----
import { openserp } from './search/openserp.js';
import { searxng } from './search/searxng.js';
import { duckduckgo } from './search/duckduckgo.js';
import { wikipedia } from './search/wikipedia.js';
import { gdelt } from './search/gdelt.js';
import { commoncrawl } from './search/commoncrawl.js';
import { wayback } from './search/wayback.js';
import { maps } from './search/maps.js';
import { brave } from './search/brave.js';
import { serpapi } from './search/serpapi.js';
import { serper } from './search/serper.js';
import { tavily } from './search/tavily.js';
import { exa } from './search/exa.js';
import { kagi } from './search/kagi.js';
import { googleCse } from './search/google_cse.js';
import { ahmia } from './darkweb/ahmia.js';
import { torch } from './darkweb/torch.js';
import { intelx } from './darkweb/intelx.js';

// ---- crawl providers ----
import { crawl4ai } from './crawl/crawl4ai.js';
import { browserless } from './crawl/browserless.js';
import { jina } from './crawl/jina.js';
import { firecrawl } from './crawl/firecrawl.js';
import { basicCrawler } from './crawl/basic.js';

const SEARCH_PROVIDERS: SearchProvider[] = [
  openserp,
  searxng,
  duckduckgo,
  wikipedia,
  gdelt,
  maps,
  wayback,
  commoncrawl,
  ahmia,
  torch,
  intelx,
  brave,
  serpapi,
  serper,
  tavily,
  exa,
  kagi,
  googleCse,
];

const CRAWL_PROVIDERS: CrawlProvider[] = [crawl4ai, browserless, jina, firecrawl, basicCrawler];

const ALL: AnyProvider[] = [...SEARCH_PROVIDERS, ...CRAWL_PROVIDERS];
const BY_ID = new Map<string, AnyProvider>(ALL.map((p) => [p.id, p]));

export function getProvider(id: string): AnyProvider | undefined {
  return BY_ID.get(id.toLowerCase());
}

export function effectivePriority(p: AnyProvider): number {
  return priorityOf(p.id, p.defaultPriority);
}

/** All providers of a category, sorted by effective priority (asc), enabled only. */
function byCategory<T extends AnyProvider>(list: T[]): T[] {
  return list
    .filter((p) => isEnabled(p.id))
    .sort((a, b) => effectivePriority(a) - effectivePriority(b));
}

/** Search/darkweb providers that can serve `modality`, priority-ordered. */
export function searchProvidersFor(modality: Modality): SearchProvider[] {
  return byCategory(SEARCH_PROVIDERS).filter((p) => p.modalities.includes(modality));
}

/** Crawl providers, priority-ordered. */
export function crawlProviders(): CrawlProvider[] {
  return byCategory(CRAWL_PROVIDERS);
}

/** Resolve a candidate list for an engine request, honoring an explicit engine
 *  pick, key availability, user prefs (disabled/ranking), and priority ordering. */
export async function resolveSearchCandidates(
  modality: Modality,
  userId: string | undefined,
  explicitEngine?: string,
): Promise<{ usable: SearchProvider[]; skipped: { id: string; reason: string }[] }> {
  const skipped: { id: string; reason: string }[] = [];
  let pool = searchProvidersFor(modality);
  const prefs = userId ? await getProviderPrefs(userId) : null;

  if (explicitEngine) {
    const p = getProvider(explicitEngine);
    if (!p || !isSearch(p)) return { usable: [], skipped: [{ id: explicitEngine, reason: 'unknown engine' }] };
    if (!p.modalities.includes(modality)) {
      return { usable: [], skipped: [{ id: p.id, reason: `does not support modality '${modality}'` }] };
    }
    pool = [p];
  }

  const usable: SearchProvider[] = [];
  for (const p of pool) {
    if (prefs && isProviderDisabled(prefs, p.id)) {
      skipped.push({ id: p.id, reason: 'disabled by user' });
      continue;
    }
    if (await hasKeysFor(userId, p.requiresKeys)) usable.push(p);
    else skipped.push({ id: p.id, reason: 'no credentials configured' });
  }
  if (prefs) {
    usable.sort((a, b) =>
      userPriority(prefs, a.id, effectivePriority(a), modality) -
      userPriority(prefs, b.id, effectivePriority(b), modality),
    );
  }
  return { usable, skipped };
}

export async function resolveCrawlCandidates(
  userId: string | undefined,
  explicitEngine?: string,
): Promise<{ usable: CrawlProvider[]; skipped: { id: string; reason: string }[] }> {
  const skipped: { id: string; reason: string }[] = [];
  let pool = crawlProviders();
  const prefs = userId ? await getProviderPrefs(userId) : null;
  if (explicitEngine) {
    const p = getProvider(explicitEngine);
    if (!p || !isCrawl(p)) return { usable: [], skipped: [{ id: explicitEngine, reason: 'unknown crawl engine' }] };
    pool = [p];
  }
  const usable: CrawlProvider[] = [];
  for (const p of pool) {
    if (prefs && isProviderDisabled(prefs, p.id)) {
      skipped.push({ id: p.id, reason: 'disabled by user' });
      continue;
    }
    if (await hasKeysFor(userId, p.requiresKeys)) usable.push(p);
    else skipped.push({ id: p.id, reason: 'no credentials configured' });
  }
  if (prefs) {
    usable.sort((a, b) =>
      userPriority(prefs, a.id, effectivePriority(a)) -
      userPriority(prefs, b.id, effectivePriority(b)),
    );
  }
  return { usable, skipped };
}

/** Catalog for the /v1/engines endpoint and the Services UI page. */
export interface EngineInfo {
  id: string;
  label: string;
  category: string;
  accessType: string;
  modalities?: Modality[];
  priority: number;
  enabled: boolean;
  requiresKeys: string[];
  rendersJs?: boolean;
  capabilities?: { screenshot?: boolean; pdf?: boolean };
  cacheTtlSec?: number;
  docsUrl?: string;
  endpoint?: string;
  description?: string;
}

export function catalog(): EngineInfo[] {
  return ALL.map((p) => ({
    id: p.id,
    label: p.label,
    category: p.category,
    accessType: p.accessType,
    modalities: isSearch(p) ? p.modalities : undefined,
    priority: effectivePriority(p),
    enabled: isEnabled(p.id),
    requiresKeys: p.requiresKeys || [],
    rendersJs: isCrawl(p) ? p.rendersJs : undefined,
    capabilities: isCrawl(p) ? p.capabilities : undefined,
    cacheTtlSec: p.cacheTtlSec,
    docsUrl: p.docsUrl,
    endpoint: p.endpoint,
    description: p.description,
  })).sort((a, b) => a.priority - b.priority);
}

export { SEARCH_PROVIDERS, CRAWL_PROVIDERS, ALL };
