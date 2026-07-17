// Core domain types: the standardized request/result shapes every provider must
// speak, regardless of the upstream API. This is the contract that makes the
// aggregator possible — providers normalize INTO these, the engine dedups and
// caches OVER these, and the API serializes THESE to clients.
import { z } from 'zod';

// ---- modalities & categories -------------------------------------------------

export const MODALITIES = [
  'web',
  'news',
  'images',
  'videos',
  'maps',
  'scholar',
  'places',
  'shopping',
  'code',
  'social',
  'archive',
  'darkweb',
] as const;
export type Modality = (typeof MODALITIES)[number];

export const PROVIDER_CATEGORIES = ['search', 'crawl', 'darkweb', 'vector'] as const;
export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

// free | self-hosted are preferred by default; commercial needs a key.
export const ACCESS_TYPES = ['free', 'self-hosted', 'freemium', 'commercial'] as const;
export type AccessType = (typeof ACCESS_TYPES)[number];

// ---- normalized result -------------------------------------------------------

export interface NormalizedResult {
  /** stable dedup id = sha1(normalized-url || title) */
  id: string;
  title: string;
  url: string;
  snippet?: string;
  /** content type of this hit */
  modality: Modality;
  /** which provider produced it (e.g. "brave", "openserp") */
  source: string;
  /** rank within the provider's own result set (0-based) */
  rank?: number;
  publishedAt?: string;
  /** media */
  thumbnail?: string;
  imageUrl?: string;
  videoUrl?: string;
  durationSec?: number;
  author?: string;
  /** anything provider-specific we don't model (kept for power users) */
  extra?: Record<string, unknown>;
  /** for aggregate mode: how many providers returned this same result */
  mergedFrom?: string[];
  /** vector-search score when applicable (0..1, higher = closer) */
  score?: number;
}

// ---- crawl result ------------------------------------------------------------

export interface CrawlResult {
  url: string;
  finalUrl?: string;
  status: number;
  title?: string;
  /** cleaned, readable markdown (LLM-friendly) */
  markdown?: string;
  /** cleaned plain text */
  text?: string;
  /** raw html if requested */
  html?: string;
  links?: string[];
  images?: string[];
  videos?: string[];
  /** full-page screenshot as a data URL (data:image/png;base64,…) */
  screenshot?: string;
  /** rendered PDF of the page as a data URL (data:application/pdf;base64,…) */
  pdf?: string;
  metadata?: Record<string, unknown>;
  source: string;
  /** s3 key if the raw payload was archived */
  storageKey?: string;
}

// ---- request schemas (zod) ---------------------------------------------------

export const SearchRequestSchema = z.object({
  q: z.string().min(1).max(2048),
  /** restrict to a content type; defaults to 'web' */
  modality: z.enum(MODALITIES).default('web'),
  /** call a specific engine (e.g. "brave"); else priority-ordered selection */
  engine: z.string().optional(),
  /**
   * fallback  — try engines in priority order, return first that yields results (default)
   * aggregate — fan out to top-N engines in parallel, merge + dedup
   */
  mode: z.enum(['fallback', 'aggregate']).default('fallback'),
  /** Breadth of engine fanout: low = single engine (fallback), medium = 2, high = 5. */
  searchDepth: z.enum(['low', 'medium', 'high']).optional(),
  /** When true, skip server-side history recording for this query. */
  temporary: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  page: z.number().int().min(1).max(50).default(1),
  /** geo / locale hints passed through to providers that support them */
  country: z.string().length(2).optional(),
  lang: z.string().min(2).max(5).optional(),
  /** freshness window for news (e.g. 'd','w','m','y') */
  freshness: z.string().optional(),
  /** safe search */
  safe: z.boolean().default(true),
  /** include faceted aggregations in the response */
  facets: z.boolean().default(false),
  /** bypass cache for this call */
  noCache: z.boolean().default(false),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const CrawlRequestSchema = z.object({
  url: z.string().url(),
  engine: z.string().optional(),
  /** what to extract */
  formats: z.array(z.enum(['markdown', 'text', 'html', 'links', 'images', 'screenshot', 'pdf'])).default(['markdown', 'text']),
  /** render JS via a headless browser if the provider supports it */
  render: z.boolean().default(false),
  /** archive the raw payload to S3 */
  store: z.boolean().default(false),
  noCache: z.boolean().default(false),
  /** When true, provider failures log at debug without stack (AI RAG enrichment). */
  quiet: z.boolean().default(false),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
});
export type CrawlRequest = z.infer<typeof CrawlRequestSchema>;

export const VectorIndexRequestSchema = z.object({
  /** documents to embed + index */
  documents: z
    .array(
      z.object({
        id: z.string().optional(),
        text: z.string().min(1),
        url: z.string().optional(),
        title: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(256),
  /** namespace partitions the vector space per use-case/user */
  namespace: z.string().default('default'),
  /** seconds; default 24h */
  ttl: z.number().int().min(60).max(60 * 60 * 24 * 30).optional(),
});
export type VectorIndexRequest = z.infer<typeof VectorIndexRequestSchema>;

export const VectorSearchRequestSchema = z.object({
  q: z.string().min(1).max(4096),
  namespace: z.string().default('default'),
  k: z.number().int().min(1).max(100).default(10),
  /** also pull live web results and index them before searching */
  groundWithWeb: z.boolean().default(false),
});
export type VectorSearchRequest = z.infer<typeof VectorSearchRequestSchema>;

// ---- engine response ---------------------------------------------------------

export interface Facet {
  field: string;
  values: { value: string; count: number }[];
}

export interface SearchResponse {
  query: string;
  modality: Modality;
  mode: string;
  /** providers actually consulted, in order, with outcome */
  enginesUsed: { engine: string; ok: boolean; count: number; ms: number; cached: boolean; error?: string }[];
  results: NormalizedResult[];
  facets?: Facet[];
  total: number;
  cached: boolean;
  tookMs: number;
}
