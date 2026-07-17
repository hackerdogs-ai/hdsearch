// The plugin contract. Adding a new search/crawl/darkweb service = drop one file
// in providers/search|crawl|darkweb exporting a descriptor and register it in
// providers/index.ts. Nothing else in the engine needs to change (spec §7).
import type {
  AccessType,
  CrawlRequest,
  CrawlResult,
  Modality,
  NormalizedResult,
  ProviderCategory,
  SearchRequest,
} from '../types.js';

/** Resolves credentials for a provider at call time: per-user encrypted key from
 *  Postgres if present, else the .env dev key when RUN_MODE=dev (spec §7). */
export interface ProviderContext {
  userId?: string;
  /** Returns the decrypted credential for `field`, or undefined if none available. */
  getKey(field: string): Promise<string | undefined>;
}

interface ProviderBase {
  id: string; // stable slug, e.g. "brave", "openserp"
  label: string; // human name
  category: ProviderCategory;
  accessType: AccessType;
  /** lower number = higher priority. Overridable via priorities.csv. */
  defaultPriority: number;
  /** credential fields this provider needs; empty/absent = no key required. */
  requiresKeys?: string[];
  /** per-source cache TTL (seconds); falls back to env.defaultCacheTtlSec. */
  cacheTtlSec?: number;
  docsUrl?: string;
  description?: string;
  /** validated endpoint/notes from the research sheet, for the Services page. */
  endpoint?: string;
}

export interface SearchProvider extends ProviderBase {
  category: 'search' | 'darkweb';
  /** content types this provider can return. */
  modalities: Modality[];
  search(req: SearchRequest, ctx: ProviderContext): Promise<NormalizedResult[]>;
}

export interface CrawlProvider extends ProviderBase {
  category: 'crawl';
  /** does this provider render JS (headless browser)? */
  rendersJs?: boolean;
  /** optional capture capabilities beyond text extraction. */
  capabilities?: { screenshot?: boolean; pdf?: boolean };
  crawl(req: CrawlRequest, ctx: ProviderContext): Promise<CrawlResult>;
}

export type AnyProvider = SearchProvider | CrawlProvider;

export const isSearch = (p: AnyProvider): p is SearchProvider =>
  p.category === 'search' || p.category === 'darkweb';
export const isCrawl = (p: AnyProvider): p is CrawlProvider => p.category === 'crawl';
