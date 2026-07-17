# HD-Search × HD-Feeds Trends Integration — PRD

**Status:** Phase 1 implemented (direct server-to-server call)  
**Owner:** HD-Search  
**Related:** [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md), [hd-feeds DEVELOPER_GUIDE](../../hd-feeds/docs/DEVELOPER_GUIDE.md)

---

## 1. Problem

The `/search` empty state (`http://localhost:3030/search` with no `q=`) should suggest what to search without scraping Google Trends or other engines whose terms prohibit republishing “trending searches.” Users clicking **Try search** from the dashboard land here with no guidance.

## 2. Goals

| Goal | Metric |
|------|--------|
| Show compliant trend suggestions on empty search | Panel visible when `q` is empty |
| Protect user privacy | No per-user queries in public trends; k-anonymity floor |
| Degrade gracefully | hd-feeds offline → platform trends only; warning in **server logs only** |
| Low upstream load | Redis cache (default 10 min); hd-feeds health probe before fetch |

## 3. Non-goals

- Google/Bing “trending searches” scraping or autocomplete mining
- Showing hd-feeds outage messages in the UI
- Personal search history in the public trends panel (that remains in recents / dashboard history)

---

## 4. Architecture

```
Browser (/search, q empty)
    │
    ▼
hd-search-web (SSR fetchTrends)
    │
    ▼
GET /v1/trends  ──► Redis cache (namespace: trends, TTL 600s)
    │
    ├─► TimescaleDB search_history  →  platform[]  (always attempted)
    │
    └─► hd-feeds GET /v1/health
            │ ok
            └─► hd-feeds GET /v1/search?since=…&limit=12  →  feeds[]
                (x-api-key: service key, feeds:read)
```

### Response shape

```json
{
  "platform": [
    { "q": "ransomware healthcare", "modality": "news", "users": 5, "searches": 12 }
  ],
  "feeds": [
    { "label": "data breach", "q": "data breach", "modality": "news", "count": 88, "kind": "category" },
    { "label": "Ransomware disrupts…", "q": "Ransomware disrupts…", "modality": "news", "kind": "event" }
  ],
  "feedsAvailable": true,
  "windowHours": 24,
  "cached": true,
  "generatedAt": "2026-06-25T12:00:00.000Z"
}
```

---

## 5. Platform trends (source #2 — always on)

**Table:** `hd_search.search_history` (Timescale hypertable, already written by `recordUsage`)

**Aggregation rules:**

1. Window: `HDSEARCH_TRENDS_WINDOW_HOURS` (default 24h)
2. Dedup key: `lower(trim(collapse_whitespace(query)))` + `modality`
3. Exclude demo identities (`HDSEARCH_DEMO_USERS`, default `public-demo`)
4. **K-anonymity:** `count(distinct user_id) >= HDSEARCH_TRENDS_MIN_USERS` (default 3)
5. Post-filter with `normalizeTrendQuery()` — drop emails, IPv4, credential-like terms, low-alnum blobs
6. Sort: distinct users DESC, total searches DESC
7. Never expose `user_id` or raw query variants in the API

**Privacy copy in UI:** “Anonymized searches · at least 3 distinct users per query”

---

## 6. HD-Feeds trends (source #1 — optional enrichment)

**When shown:** `feedsAvailable === true` and `feeds.length > 0`

**When skipped (UI shows platform only):**

| Condition | Server log |
|-----------|------------|
| No base URL or no auth (internal secret **or** public key) | (no call; feeds section hidden) |
| `/v1/health` fails or times out | `warn: hdfeeds is offline — showing platform trends only` |
| Search fetch fails after healthy probe | `warn: hdfeeds is configured but trend fetch failed — showing platform trends only` |

**Endpoints used:**

| Call | Auth | Purpose |
|------|------|---------|
| `GET {HDFEEDS}/v1/health` | none | Liveness |
| `GET {HDFEEDS}/v1/search?since=<ISO>&limit=12` | service trust **or** `x-api-key` | Facet categories + recent events |

**Service trust (preferred — no user-visible API key):**

```http
x-hd-internal: <HDFEEDS_INTERNAL_SECRET>
x-hd-service: hdsearch
```

hdfeeds accepts this on `feeds:read` routes when `HDFEEDS_TRUSTED_SERVICES` includes `hdsearch` (default).

**Mapping:**

- Top 6 `facets.category` → chip with `kind: category`, `modality: news`
- Up to 12 `data[]` event titles → `kind: event`, clickable → `/search?q=<title>&modality=news`

---

## 7. Configuration

### URL convention (fixed — not configurable in docker)

| Environment | hdfeeds URL |
|-------------|-------------|
| Terminal | `http://localhost:8787` in `api/.env` (`HDSEARCH_HDFEEDS_BASE_URL`) |
| Docker | `http://hdfeeds:8787` hardcoded in `docker-compose.yml` |

### Auth — copy internal secret once

hdfeeds generates `HDFEEDS_INTERNAL_SECRET` in `n8n/hd-feeds.env` when you run `start_hdfeeds.sh`. Copy that **same string** into hdsearch `api/.env`:

```
HDSEARCH_HDFEEDS_INTERNAL_SECRET=<paste from hdfeeds>
```

That is a shared server password (like `HDSEARCH_INTERNAL_SECRET` for the hdsearch web BFF). hdsearch sends it as `x-hd-internal`; hdfeeds verifies it and allows the trends call. End users never see it.

Optional fallback: `HDSEARCH_HDFEEDS_API_KEY=sk-hdf-…` (a `feeds:read` key from hdfeeds) instead of the internal secret.

### Other knobs

| Variable | Default | Description |
|----------|---------|-------------|
| `HDSEARCH_HDFEEDS_TIMEOUT_MS` | `5000` | Health + search timeout |
| `HDSEARCH_TRENDS_WINDOW_HOURS` | `24` | Lookback window |
| `HDSEARCH_TRENDS_LIMIT` | `12` | Max items per section |
| `HDSEARCH_TRENDS_CACHE_TTL` | `600` | Redis cache seconds |
| `HDSEARCH_TRENDS_MIN_USERS` | `3` | K-anonymity floor |
| `HDFEEDS_TRUSTED_SERVICES` | `hdsearch` | On hdfeeds — allowed `x-hd-service` ids |

---

## 8. UI behavior (`/search`)

| State | Display |
|-------|---------|
| `q` present | Normal search results (unchanged) |
| `q` empty, feeds online | **Trending in OSINT feeds** + **Popular on Hackerdogs** |
| `q` empty, feeds offline | **Popular on Hackerdogs** only |
| No platform data yet | Fallback copy: “Type a query…” |

---

## 9. Phase 2 (future — not in scope)

- [ ] Shared internal-trust path (hd-search → hd-feeds without service key, mirror web BFF pattern)
- [ ] Category-scoped trends aligned with user role / tenant (core RBAC)
- [ ] “Trending” sparkline from `usage_metrics` time series
- [ ] MCP tool `get_trends` for AI Mode grounding
- [ ] Cross-link hd-feeds event → hd-search `?like=` similar-events pivot (unified pivot UX)

---

## 10. Compliance notes

- Platform trends are **first-party aggregated telemetry** — no third-party search engine ToS involved
- hd-feeds data is **your OSINT catalogue** — licensed by your feed ingestion pipeline
- Do **not** add Google Trends, Bing trending, or SERP suggest scraping to this endpoint

---

## 11. Files (Phase 1)

| Path | Role |
|------|------|
| `api/src/trends.ts` | Aggregation + cache orchestration |
| `api/src/hdfeedsClient.ts` | hd-feeds health + search client |
| `api/src/routes/trends.ts` | `GET /v1/trends` |
| `web/src/lib/trends.ts` | SSR fetch helper |
| `web/src/components/search-trends-panel.tsx` | Empty-state UI |
| `web/src/app/search/page.tsx` | Wires panel when `!q` |

---

## 12. Test plan

1. **Platform only:** stop hd-feeds → platform section only, `warn` in API logs
2. **Auth:** copy `HDFEEDS_INTERNAL_SECRET` into `HDSEARCH_HDFEEDS_INTERNAL_SECRET` in api/.env
3. **Cache:** two rapid `GET /v1/trends` → second response has `"cached": true`
5. **Anonymity:** query searched by 1 user only → must not appear in `platform`
6. **Demo exclusion:** `public-demo` searches must not influence trends
