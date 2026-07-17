// Per-provider credit cost map (retained for display/telemetry only). In the
// open-source build credits are NOT charged — chargeUserCredits() is a no-op.
// See docs/OPEN_SOURCE_MIGRATION.md.
//
// Pricing rationale: free/self-hosted providers cost 1 credit (infra overhead);
// commercial providers are priced to cover their retail API cost + margin.
// AI mode uses dynamic per-turn metering (see credits.ts).

export type OpKind = 'search' | 'crawl' | 'vector_index' | 'vector_search' | 'ai';

const SEARCH_CREDITS: Record<string, number> = {
  // free / self-hosted (infra-only cost)
  openserp: 1,
  searxng: 1,
  duckduckgo: 1,
  wikipedia: 1,
  gdelt: 1,
  maps: 1,
  wayback: 1,
  commoncrawl: 1,

  // commercial — priced to cover upstream API cost + margin
  serper: 2,    // $1/1K queries
  brave: 3,     // $5/1K queries
  tavily: 3,    // ~$6.67/1K queries
  exa: 3,       // $7/1K queries
  kagi: 4,      // $12/1K queries
  google_cse: 3, // $5/1K queries
  serpapi: 5,   // ~$10/1K queries

  // darkweb
  ahmia: 2,
  torch: 2,
  intelx: 10,   // ~$2,500/year subscription
};

const CRAWL_CREDITS: Record<string, number> = {
  basic: 1,       // simple HTTP fetch
  crawl4ai: 2,    // self-hosted headless browser
  browserless: 2, // self-hosted headless browser
  jina: 2,        // freemium, token-based
  firecrawl: 2,   // commercial, ~$0.83/1K pages
};

const VECTOR_CREDITS: Record<string, number> = {
  vector_index: 5,
  vector_search: 3,
};

const DEFAULT_SEARCH_CREDIT = 1;
const DEFAULT_CRAWL_CREDIT = 2;

/** Credits for a single provider call. */
export function providerCredits(providerId: string, kind: OpKind): number {
  switch (kind) {
    case 'search':
      return SEARCH_CREDITS[providerId] ?? DEFAULT_SEARCH_CREDIT;
    case 'crawl':
      return CRAWL_CREDITS[providerId] ?? DEFAULT_CRAWL_CREDIT;
    case 'vector_index':
      return VECTOR_CREDITS.vector_index!;
    case 'vector_search':
      return VECTOR_CREDITS.vector_search!;
    case 'ai':
      return 1; // AI uses dynamic metering via credits.ts, this is the minimum
  }
}

/**
 * Total credits for a query that used one or more providers.
 *
 * Billing rule:
 * - Fallback mode → charge for the ONE provider that returned results.
 * - Aggregate mode → charge for ALL providers that were queried (we consumed
 *   their API regardless of whether they returned results).
 * - Cached responses → 0 credits (don't double-charge).
 */
export function queryCredits(
  providers: string[],
  kind: OpKind,
  cached = false,
): number {
  if (cached) return 0;
  if (providers.length === 0) return providerCredits('unknown', kind);
  return providers.reduce((sum, p) => sum + providerCredits(p, kind), 0);
}

/** The full cost map, for surfacing in docs/UI. vector_index is internal
 *  (embedding + indexing overhead) and not shown to users. */
export const CREDIT_MAP = {
  search: SEARCH_CREDITS,
  crawl: CRAWL_CREDITS,
  vector: { query: VECTOR_CREDITS.vector_search } as Record<string, number>,
  ai: { 'per-turn (dynamic)': 1 } as Record<string, number>,
};
