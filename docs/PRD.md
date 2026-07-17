# HD-Search — Product Requirements Document (PRD)

**Status:** v1 implemented (backend + web + DB + providers). **Owner:** Hackerdogs.
**Last updated:** 2026-06.

## 1. Summary

HD-Search is a **SerpAPI-style aggregator** that puts search, crawling, and vector
search behind one normalized API and a developer-facing web product. It calls a
prioritized list of search/crawl providers (free & self-hosted first, commercial
on per-user keys), returns standardized, deduplicated results, caches aggressively
in Redis to avoid upstream blocking, and exposes an MCP server for agents/IDEs.

## 2. Problem & motivation

- SERP/crawl vendors are fragmented: different schemas, auth, rate limits, and
  failure modes. Teams rewrite the same plumbing per vendor.
- Direct scraping gets blocked/captcha'd; commercial APIs are expensive at volume.
- Agentic apps need *grounding* (web + vector) behind one stable contract.

HD-Search abstracts all of this: one request shape, automatic fallback, dedup,
caching, faceting, and a plugin system so new providers are a single file.

## 3. Goals / non-goals

**Goals**
- One API for **search** (web/news/images/videos/scholar/places/shopping/code/
  social/archive/**darkweb**), **crawl** (URL → markdown/text/links/images), and
  **vector** index + KNN search.
- **Priority-ordered fallback** (default) and **aggregate fan-out** (merge+dedup).
- **Free/self-hosted first**; commercial providers use **per-user encrypted keys**
  (dev `.env` fallback only when `RUN_MODE=dev`).
- **Redis cache** with per-source TTL as the primary anti-blocking mechanism.
- **Web product**: marketing home with faceted search, local email+password login,
  dashboard, search history, account (API keys + provider keys),
  integrations (MCP/API), docs, services.
- **Metrics** in TimescaleDB; **least-privilege** DB roles; **encryption at rest**.

**Non-goals (v1)**
- Building our own web crawler/index (we aggregate existing ones).
- Full anti-bot/residential-proxy infrastructure (documented as an integration).
- Real-time streaming results (request/response only in v1).

## 4. Personas

| Persona | Need |
|---|---|
| **App developer** | One API key, predictable JSON, SDK-free `curl`, generous free tier. |
| **AI/agent builder** | MCP tools for search/crawl/vector grounding; semantic search with TTL. |
| **OSINT/research analyst** | Multi-engine + darkweb + archive coverage, faceting, dedup. |
| **Platform/ops owner** | Self-hostable, cost control via free providers + caching, observability. |

## 5. Functional requirements

1. **Search API** — `POST /v1/search` with `q`, `modality`, `engine?`,
   `mode(fallback|aggregate)`, `limit`, `page`, `country?`, `lang?`, `freshness?`,
   `facets`, `noCache`. Returns normalized `results[]`, `enginesUsed[]`, optional
   `facets[]`.
2. **Crawl API** — `POST /v1/crawl` with `url`, `formats[]`, `render`, `store`.
   Returns markdown/text/html/links/images; optional S3 archival.
3. **Vector** — `POST /v1/search/vector/index` (embed+store, TTL default 24h) and
   `POST /v1/search/vector` (KNN; optional `groundWithWeb`). Available to all users.
4. **Engine discovery** — `GET /v1/engines` (+ `/:id`): list providers, modalities,
   access type, priority, key requirements, availability for the caller.
5. **Keys** — user API keys (`sk-hds-…`, shown once, hashed) and encrypted upstream
   provider credentials, both managed in the panel and via API.
6. **Accounts/usage** — profile, usage stats, search history, dashboard
   metrics (from TimescaleDB). All features unlimited and free.
7. **MCP server** — `hd_search`, `hd_crawl`, `hd_vector_search`,
   `hd_vector_index`, `hd_list_engines`.
8. **Web UI** — see §3 Goals; faceted search like the WorldMonitor SEW pages.

## 6. Non-functional requirements

- **Resiliency:** any single dependency (Redis/Postgres/S3/provider) may be down
  and the service degrades rather than fails. Bounded retries + timeouts on every
  upstream call. Aggregate mode has a soft deadline.
- **Security:** provider secrets AES-256-GCM encrypted at rest; API keys stored as
  sha256; least-privilege DB role for the app; no secret in URLs/logs.
- **Performance:** cached queries < 50 ms; default (fallback/searxng) search ~1 s;
  aggregate bounded by deadline (~6 s).
- **Cost:** free/self-hosted providers first + caching minimize commercial spend.
- **Extensibility:** new provider = one file + registry line + priority row.

## 7. Success metrics

- p50 search latency (cached vs live), cache hit ratio, % requests served by free
  vs commercial providers, provider error rate, monthly active API keys, vector
  adoption.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Google/captcha blocks scrapers | Default to searxng + openserp→yandex/baidu; document proxy/2captcha. |
| Upstream rate limits | Redis cache w/ per-source TTL; fallback ordering; aggregate dedup. |
| Cost runaway | Free/self-hosted providers first; aggressive caching; per-key rate limits. |
| Secret leakage | AES-256-GCM at rest; sha256 API keys; least-privilege DB role. |
| Slow providers stalling UX | Per-call timeout + retries; aggregate soft deadline. |

## 9. Rollout

1. Self-host via `docker-compose.selfhost.yml` (bundles Postgres/Timescale, Redis,
   SeaweedFS, local embeddings + providers on a private network; done).
2. Create the first admin on first run (onboarding screen or
   `HDSEARCH_ADMIN_EMAIL`/`HDSEARCH_ADMIN_PASSWORD`); enter provider API keys in the UI.
3. Add residential proxy / 2captcha for Google via openserp (optional).
4. Expand provider catalog (remaining sheet entries; onion-proxied darkweb).
