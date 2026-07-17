# HD-Search — Technical Design Specification

**Scope:** architecture, data model, provider plugin system, engine algorithms,
caching, vector search, auth, billing, and the web BFF. Companion docs:
[PRD](PRD.md), [Configuration & Deployment](CONFIGURATION_DEPLOYMENT.md),
[Performance/Scale/Security](PERFORMANCE_SCALE_SECURITY.md), [OpenSERP](OPENSERP.md),
[Darkweb](DARKWEB_SEARCH.md).

## 1. System architecture

```
                         ┌──────────────────────────── hdnet (docker) ───────────────────────────┐
 Browser ──HTTP──▶ hd-search-web (Next.js, :3030)                                                  │
   │   server-side BFF (X-HD-Internal + X-HD-User)                                                 │
   ▼                       │                                                                        │
 MCP client ──stdio──▶ mcp/server.ts ──HTTP(sk-hds-)──▶ hd-search-api (Hono, :8791) ──▶ engine     │
 External dev ──HTTP(sk-hds-)──────────────────────────────▶ │            │                         │
                                                              │            ├─ providers (plugins)    │
                                                              │            │   search: searxng, openserp, duckduckgo, brave, serpapi, serper, tavily, exa, kagi, google_cse, wikipedia, gdelt, commoncrawl
                                                              │            │   darkweb: ahmia (clearnet+Tor), torch (Tor), intelx
                                                              │            │   crawl: crawl4ai, browserless, jina, firecrawl, basic
                                                              │            └─ embeddings: minilm | openai
                                                              ▼
        hdsearch-redis(:6390 db0, RediSearch)  hd-db TimescaleDB(:5432 hdsearch)  hd-seaweedfs S3(:8333)
        cache + rate limit + vectors   users/keys/history/metrics    raw crawl archive
        ┌ reused: hackerdogs-crawl4ai(:11235), hackerdogs-browserless(:3000) ┐
        └ started: hd-openserp(:7007), hd-searxng(:8899) ────────────────────┘
```

**Language/stack:** TypeScript everywhere. API = Hono + ioredis + pg + AWS S3
SDK + zod. Web = Next.js 14 App Router + Tailwind. ESM, Node 20+.

## 2. Request lifecycle (search)

1. **Auth** (`src/auth.ts`): API key (`sk-hds-…`) → principal{userId,scopes,plan}
   OR first-party header (`X-HD-Internal`+`X-HD-User`) from the web BFF. Per-key
   sliding-window rate limit (Redis).
2. **Validate** (zod `SearchRequestSchema`).
3. **Quota** (`src/plans.ts`): monthly counter vs plan; vector gated to DevTest+.
   Anonymous home/search runs as a shared `public-demo` identity that is exempt from
   the monthly quota (configurable via `HDSEARCH_DEMO_USERS`); real users get their plan quota.
4. **Resolve candidates** (`src/providers/index.ts`): providers for the modality,
   filtered by key availability, sorted by effective priority (CSV override or
   hardcoded default).
5. **Execute** (`src/engine.ts`):
   - **fallback** (default): try in order; first with results wins.
   - **aggregate**: fan out to top-N (`HDSEARCH_AGGREGATE_FANOUT`) in parallel,
     each wrapped in a **soft deadline** (`HDSEARCH_AGGREGATE_DEADLINE_MS`), merge
     + dedup + rank by cross-engine corroboration.
   Each provider call goes through the **computed cache** (per-source TTL) with
   single-flight.
6. **Dedup** (`src/normalize.ts`): canonical URL (lowercase host, strip tracking
   params, trim slash) → sha1 id; merge provenance.
7. **Facets** (`src/facets.ts`): counts by source/site/tld/modality/year.
8. **Record** (`src/metrics.ts`): history + usage_metrics + monthly counter
   (best-effort; never fails the request).

## 3. Provider plugin system

Contract (`src/providers/types.ts`):

```ts
interface SearchProvider {
  id; label; category:'search'|'darkweb'; accessType; defaultPriority;
  modalities: Modality[]; requiresKeys?: string[]; cacheTtlSec?;
  search(req, ctx): Promise<NormalizedResult[]>;
}
interface CrawlProvider { /* …; crawl(req, ctx): Promise<CrawlResult> */ }
interface ProviderContext { userId?; getKey(field): Promise<string|undefined>; }
```

- **Add a provider:** create one file under `providers/{search,crawl,darkweb}`,
  export the descriptor, register it in `providers/index.ts`, add a priority row.
- **Credential resolution** (`src/keystore.ts`): per-user encrypted key from
  Postgres → dev `.env` fallback when `RUN_MODE=dev`. Free/self-hosted need none.
- **Normalization:** providers map upstream payloads into `NormalizedResult`
  (id,title,url,snippet,modality,source,rank,media,score,extra). The engine and
  cache only ever see this shape.

## 4. Priority list

`src/priorities.csv` — `priority,provider_id,enabled`, hot-reloaded by mtime.
Lower = tried first. Free/self-hosted ranked above commercial. searxng(10) before
openserp(20) for latency. Overrides the hardcoded `defaultPriority` per provider.

## 5. Caching (`src/cache.ts`)

- **computed(namespace,key,ttl,producer):** memoize normalized provider results in
  Redis with per-source TTL + per-process single-flight (collapses concurrent
  identical calls). Cache key includes provider id, query, modality, paging, and a
  scope (`shared` for free providers, `userId` for keyed providers).
- **sendCached():** HTTP ETag/304 + `Cache-Control` for GETs.
- This layer is the **primary anti-blocking mechanism** (spec §9): repeated queries
  never hit upstreams.
- **Resiliency:** a `redisHealthy()` flag trips on error so hot paths fail fast and
  recover automatically.

## 6. Vector search (`src/vector.ts`, `src/embeddings.ts`)

- **Embeddings are pluggable**: `minilm` (self-hosted transformers-inference,
  384-dim, default) or `openai` (1536-dim). Same drop-in interface as providers.
- **Storage:** Redis HASH per doc (`hds:vec:doc:<ns>:<id>`) with a TTL (default
  24h). Namespaces are scoped per user (`<userId>:<namespace>`) — no cross-tenant
  leakage.
- **Index/search:** the bundled **`hdsearch-redis`** (redis-stack, RediSearch) is the
  default → `FT.CREATE` HNSW + `FT.SEARCH … KNN` with binary FLOAT32 vectors. If
  pointed at a plain Redis → transparent **brute-force cosine** fallback. Auto-detected
  at boot.
- **groundWithWeb:** optionally run a live aggregate web search, index the hits,
  then KNN — RAG grounding in one call.

## 7. Data model (TimescaleDB, schema `hd_search`)

| Table | Purpose | Notes |
|---|---|---|
| `users` | identity + plan + stripe customer | id = Auth0 sub |
| `user_provider_keys` | encrypted upstream creds | `secret_enc` = AES-256-GCM; unique (user, field) |
| `api_keys` | `sk-hds-` keys | sha256 hash only; scopes; rate limit |
| `search_history` | per-call log | **hypertable** (ts) |
| `usage_metrics` | time-series metrics | **hypertable** (ts) |
| `usage_counters` | monthly quota counters | (user, period, kind) |

**Roles:** `hdsearchadmin` (owner/DDL/migrations), `hdsearchrw` (app runtime, DML
only, no DDL), `hdsearchreadonly` (SELECT). See [CREDENTIALS](../api/db/CREDENTIALS.md).

## 8. AuthN/Z

- **API:** bearer `sk-hds-…` (hashed, Redis-cached verify) or first-party
  `X-HD-Internal`+`X-HD-User`. Scopes: `search:read`, `crawl:read`, `vector:read`,
  `admin:keys`. Per-key rate limit.
- **Web:** dependency-free OIDC BFF (`web/src/lib/auth.ts`) — Authorization Code
  against Auth0; identity (email/name/picture) from the id_token; signed-cookie
  session (HMAC-SHA256). Social connections (`github`, `google-oauth2`). Dev-login
  fallback when Auth0 is unconfigured. Internal redirects are relative (port-safe).
- **Secrets bootstrap** (`src/secrets.ts` / `web/src/lib/secrets.ts`): the encryption
  key + internal BFF secret are read from env, else from a shared persisted file
  (`.hdsearch-secrets.json`, or `HDSEARCH_SECRETS_FILE`), else generated once and
  written there — so API and web agree and the app works zero-config. Env always wins.

## 8a. Developer experience (web)

- **Documentation page** with copy-paste SDK snippets in **cURL, Python, Node,
  TypeScript, Go, C#** (`web/src/lib/snippets.ts`).
- **Interactive API Reference** — Swagger UI (CDN) over the API's `/openapi.json`
  with Authorize + Try-it-out (CORS `*` enables browser calls).
- **Search UX:** infinite-scroll results (BFF `/api/search?page=N` + IntersectionObserver),
  a `useTransition` top progress bar on modality/query navigation, faceted rail.

## 9. Billing (`src/routes/billing.ts`)

Stripe Checkout (subscription) → `customer.subscription.*` / `checkout.session.
completed` webhooks update `users.plan` → drives quota + vector entitlement.
Billing Portal for self-serve management. All optional (503 when unconfigured).

## 10. Web BFF (`web/src/lib/api.ts`)

The browser never holds an API key. Server components/route handlers call the API
with `X-HD-Internal` (shared secret) + `X-HD-User` (Auth0 sub). All quota/rate
limit/provider-key resolution happens server-side, identical to API-key callers.

## 11. Error handling & observability

- `src/http.ts`: timeout (AbortController) + bounded retries w/ backoff + typed
  `ProviderError(provider,status,retryable)`.
- `src/logger.ts`: structured JSON logs, request ids, never leak stacks to clients.
- `/healthz`: per-dependency liveness (redis/postgres/seaweedfs/rediSearch/embeddings).

## 12. Key directories

```
api/src/{providers,routes}  engine.ts cache.ts vector.ts embeddings.ts
        keystore.ts crypto.ts apikeys.ts auth.ts metrics.ts plans.ts normalize.ts facets.ts
api/db/{roles,schema,grants}.sql setup.sh CREDENTIALS.md
api/mcp/server.ts
web/src/{app,components,lib}
```
