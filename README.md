# HD-Search

A SerpAPI-style **search + crawl + vector-search aggregator**. One API in front of
many engines, with priority-ordered fallback, dedup, a load-bearing Redis cache,
per-user encrypted provider keys, and an MCP server. **Free and self-hostable** —
no accounts to buy, no external SaaS, no API bills for the aggregator itself.
TypeScript throughout.

## Run it yourself (self-hosted, one command)

The self-hosted stack bundles everything it needs — Postgres/TimescaleDB, Redis
(RediSearch), SeaweedFS, a local embeddings model, and all the search/crawl
providers — on its own Docker network. Nothing external required.

```bash
cp .env.selfhost.example .env.selfhost      # then set the 3 secrets (openssl rand -hex 32)
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d --build
# open http://localhost:3000  →  first run prompts you to create the admin account
```

- **No SaaS.** No Auth0, no Stripe, no plans/credits/quotas — everything is
  unlimited. Auth is **local email + password** stored in your own database; the
  first account you create becomes the admin (set `HDSEARCH_ADMIN_EMAIL` /
  `HDSEARCH_ADMIN_PASSWORD` to bootstrap it headlessly instead).
- **Optional headless admin, open signup, and per-service tuning** via
  `.env.selfhost`. See [`docs/OPEN_SOURCE_MIGRATION.md`](docs/OPEN_SOURCE_MIGRATION.md)
  for the full self-host architecture and configuration.

> The other `docker-compose.yml` in this repo targets a pre-existing shared
> `hdnet` infrastructure and is **not** the self-host path — use
> `docker-compose.selfhost.yml` above.

---

## What it does (spec → implementation)

| Spec | Where |
|---|---|
| §1 Prioritized fallback, standardized results, dedup | `src/engine.ts`, `src/normalize.ts`, `src/priorities.ts` |
| §2 Index results in Redis with per-source TTL | `src/cache.ts` (computed cache, per-provider `cacheTtlSec`) |
| §3 `search` + `crawl` endpoint families | `src/routes/search.ts`, `src/routes/crawl.ts` |
| §4 Aggregate the majority of each service's features | per-provider normalizers in `src/providers/**` |
| §5 Call a specific engine / list engines | `?engine=` + `GET /v1/engines` |
| §6 Comprehensive: text/image/video/maps + web archive | `modality` enum (web/news/images/videos/**maps**/scholar/places/shopping/code/social/archive/darkweb); `commoncrawl` + **wayback** archive; inline YouTube players; **maps** via OSM geocoder |
| §7 Priority CSV, free/self-hosted first, per-user commercial keys, dev `.env` fallback, plugin pattern | `src/priorities.csv`, `src/keystore.ts`, `src/providers/types.ts` |
| §8 Darkweb search added | `src/providers/darkweb/*`, [`docs/DARKWEB_SEARCH.md`](docs/DARKWEB_SEARCH.md) |
| §8 MCP server + user-panel APIs | `mcp/server.ts`, `src/routes/account.ts`, `src/routes/keys.ts` |
| §9 Redis cache to avoid blocking/exhaustion | `src/cache.ts` + single-flight + per-source TTL |
| §10/§11 Vector store (24h TTL) + vector search endpoint | `src/vector.ts`, `src/embeddings.ts`, `/v1/search/vector*` |
| §12 Faceted results | `src/facets.ts` (`?facets=true`) |
| Plans / Stripe / Auth0 / encryption | `src/plans.ts`, `src/routes/billing.ts`, `src/crypto.ts`, `src/auth.ts` |

## Architecture

```
client ─▶ Hono API ─▶ engine ─▶ providers (search / crawl / darkweb)   [plugin registry]
                │         │
                │         ├─ Redis computed-cache (per-source TTL)  ◀─ avoids upstream blocking
                │         └─ dedup + facets + aggregate ranking
                │
                ├─ keystore  ─▶ Postgres (AES-256-GCM encrypted per-user keys) / dev .env fallback
                ├─ vector    ─▶ hdsearch-redis :6390 (RediSearch HNSW ANN) + pluggable embeddings
                ├─ metrics   ─▶ TimescaleDB (history + usage hypertables)  ─▶ dashboard
                └─ storage   ─▶ SeaweedFS (S3) raw crawl archive
```

Reuses the existing infra on the `hdnet` docker network: **hd-redis**, **hd-db**
(TimescaleDB), **hd-seaweedfs**, and the **transformers-inference** embedder.

## Database (TimescaleDB) — roles & setup

The schema lives in the **`hdsearch`** database (schema `hd_search`) with three
least-privilege roles (full details + dev passwords in
[`api/db/CREDENTIALS.md`](api/db/CREDENTIALS.md)):

| Role | Privileges | Used by |
|---|---|---|
| `hdsearchadmin` | All privileges on the DB; owns the schema (DDL) | migrations |
| `hdsearchrw` | row `SELECT/INSERT/UPDATE/DELETE`, **no DDL** | the app runtime |
| `hdsearchreadonly` | `SELECT` only | BI / dashboards |

The app connects as **`hdsearchrw`** (least privilege); migrations run as
`hdsearchadmin`. One-time setup (needs the superuser password):

```bash
PG_SUPER_PASSWORD='<hackerdogs password>' ./api/db/setup.sh          # roles + schema + grants
PG_SUPER_PASSWORD='<hackerdogs password>' ./api/db/setup.sh --reset  # wipe + recreate schema
```
SQL files: `api/db/roles.sql` → `api/db/schema.sql` → `api/db/grants.sql`.

## Self-hosted providers (auto-started)

`start_hd_search_all.sh` brings up the free search engines **openserp** (`:7007`)
and **searxng** (`:8899`) as containers on `hdnet`, and **reuses** the already-
running shared crawlers **`hackerdogs-crawl4ai`** (`:11235`) and
**`hackerdogs-browserless`** (`:3000`) — no duplicates. searxng is the default
first engine (fast); openserp is a secondary (Google often captchas direct
scraping). Aggregate mode has a soft deadline so one slow engine can't stall a
response.

An **opt-in** self-hosted **Photon** geocoder (`hd-photon` :2322, OpenStreetMap) backs
the Maps tab — start it with `./start_hd_search_all.sh --with-maps` or
`docker compose --profile maps up -d hd-photon`. It's gated behind a profile because the
OSM index is large; without it, Maps use the public Photon instance. See
[Maps & geocoding](#maps--geocoding--how-openstreetmap-is-used).

## Start scripts

| Script | Starts |
|---|---|
| **`./start_hdsearch.sh`** | **Both services locally** (API + web + hdsearch-redis + openserp + searxng), shared secret, auto-migrate. `WEB_PORT=3030` to change port; append `dev` for watch mode, `--foreground` to stream logs, `--with-maps` to also self-host the OSM geocoder. (Canonical name; `start_hd_search_all.sh` is the same.) |
| **`./start_hdsearch_docker.sh`** | **Everything in Docker** via compose (hdsearch-redis + API + web + openserp + searxng) on `hdnet`. (Same as `start_hd_search_stack.sh`.) |
| **`./publish_to_docker.sh <user> [tag…]`** | Build + push multi-arch images `<user>/hdsearch:api` and `<user>/hdsearch:web` to Docker Hub. |
| `./stop_hd_search.sh` | Stops the locally-started services. |
| `./start_hd_search.sh` | API only (local dev server). |
| `./start_hd_search_web.sh [port] [build]` | Web UI only (local). |

> **Zero-config secrets:** you don't need to set any secrets to run locally. The API
> auto-generates `HDSEARCH_ENCRYPTION_KEY` + `HDSEARCH_INTERNAL_SECRET` and persists
> them to `.hdsearch-secrets.json` (shared with the web app), so encryption, API-key
> management and provider keys all work out of the box. Set them explicitly + back up
> the file in production. Override the path with `HDSEARCH_SECRETS_FILE`.

## Published images (Docker Hub)

```bash
docker pull hackerdogs/hdsearch:api   # or :api-v1.0.0   (linux/amd64 + arm64)
docker pull hackerdogs/hdsearch:web
```
To deploy them, set `image:` instead of `build:` for the two services in
`docker-compose.yml`.

## Quick start (local, against existing infra)

```bash
cd services/hd-search
./start_hdsearch.sh            # API :8791 + Web UI :3030 (auto-secrets, migrates DB)
# → open http://localhost:3030  (Sign in → dev login works with no Auth0 tenant)
./stop_hd_search.sh            # when done

# or run just the API:
./start_hd_search.sh           # creates api/.env, migrates, runs dev server
curl localhost:8791/healthz
```

Issue an API key and search:

```bash
cd api
npx tsx scripts/hds-keys.ts issue --user dev --name local   # prints sk-hds-...
KEY=sk-hds-...
curl -s localhost:8791/v1/search -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"q":"openai","modality":"web","facets":true}' | jq
```

## Full engine + web UI in one command

```bash
./start_hdsearch_docker.sh           # hdsearch-redis + API + web + openserp + searxng on hdnet
# → Web UI  http://localhost:3000     (dev login works with no Auth0 tenant)
# → API     http://localhost:8791/healthz
```
(`hdsearch-redis` with RediSearch is always included — no separate profile needed.)

Run just the web UI in dev (API on :8791 in another shell):

```bash
./start_hd_search_web.sh             # Next.js dev server on :3000
```

The web app (`web/`) is the SerpAPI-style front end (search-icon **hdsearch**
branding): a public **faceted home search** with **infinite scroll**, modality tabs
with a **loading progress bar**, Auth0 sign-in with **GitHub/Google** buttons (falls
back to a local dev login when `AUTH0_*` is unset), and the user panel — Dashboard
(Timescale metrics), Search History, Account (API keys + encrypted provider keys),
Plans & Billing (Stripe), Integrations (MCP/API), **Documentation** (copy-paste SDK
examples in cURL/Python/Node/TypeScript/Go/C#), an **interactive API Reference**
(Swagger UI over `/openapi.json`), and Services. It talks to the API server-side as a
BFF, sharing `HDSEARCH_INTERNAL_SECRET`, so the browser never sees an API key.

## API surface

| Method | Path | Purpose |
|---|---|---|
| POST/GET | `/v1/search` | aggregated search; `modality`, `engine`, `mode=fallback\|aggregate`, `facets` |
| POST | `/v1/search/vector` | semantic KNN over a namespace (DevTest+); `groundWithWeb` |
| POST | `/v1/search/vector/index` | embed + index docs (TTL default 24h) |
| POST/GET | `/v1/crawl` | crawl a URL → markdown/text/html/links/images/**screenshot**/**pdf** |
| GET | `/v1/archive` | fetch a web-archive capture (wayback/commoncrawl) → archived HTML or markdown |
| GET/DELETE | `/v1/history` | signed-in search history (Redis 3-day window); DELETE clears it |
| GET | `/v1/engines`, `/v1/engines/:id` | list/describe engines (availability per user) |
| GET/POST/DELETE | `/v1/keys/api` | your `sk-hds-` API keys |
| GET/PUT/DELETE | `/v1/keys/providers` | your encrypted upstream provider keys |
| GET | `/v1/account`, `/account/history`, `/account/dashboard`, `/account/plans` | panel data |
| POST | `/v1/billing/checkout`, `/billing/portal`, `/billing/webhook` | Stripe |
| GET | `/healthz`, `/openapi.json` | ops + docs |

## Providers shipped (representative set; the rest are drop-in)

- **Search free/self-hosted:** searxng, openserp (Google/Yandex/Bing/Baidu, merged), duckduckgo, wikipedia, gdelt, **maps** (OpenStreetMap geocoder)
- **Archive (`modality=archive`):** **wayback** (Internet Archive — snapshot links + extract), commoncrawl (CDX → WARC de-frame). Results link to the *archived* capture, never the live page.
- **Search commercial (per-user key):** brave, serpapi, serper, tavily, exa, kagi, google_cse
- **Darkweb:** ahmia (free clearnet, anti-bot token handled + Tor onion fallback), torch (Tor-only onion), intelx (commercial) — full landscape in `docs/DARKWEB_SEARCH.md`
- **Crawl:** crawl4ai (self-hosted — markdown/**screenshot**/**PDF**), browserless (self-hosted JS render + screenshot/PDF), jina_reader (free), firecrawl (key), basic (built-in fallback)

Adding a provider = one file under `src/providers/{search,crawl,darkweb}/` + one line
in `src/providers/index.ts`. Priority is set in `src/priorities.csv` (hot-reloaded).

## Maps & geocoding — how OpenStreetMap is used

The **Maps** tab (`modality=maps`) is built entirely on **OpenStreetMap (OSM)** — no
Google, no per-call cost. OSM shows up in three independent places:

1. **Geocoding (place → coordinates).** The `maps` provider ([`src/providers/search/maps.ts`](api/src/providers/search/maps.ts))
   calls an OSM **geocoder** — **Photon** (default) or **Nominatim** — which index OSM
   data and return lat/lon + a structured address for a text query. Each hit becomes a
   normalized result carrying `extra.geo = { lat, lon, label, kind }`.
   - **Location-aware "`<category>` in `<place>`" queries.** A query like *"coffee in San
     Ramon, CA"* is parsed into a **category** (coffee) and a **place** (San Ramon, CA).
     The place is geocoded to a bounding box, then results are restricted to it (so you
     never get global pins). When the category maps to an OSM tag (a generic table:
     coffee→`amenity=cafe`, pharmacy→`amenity=pharmacy`, hotel→`tourism=hotel`, gas→
     `amenity=fuel`, park→`leisure=park`, …), the actual POIs are fetched from the
     **Overpass API** — so "pharmacies" returns CVS/Walgreens, not places literally named
     "pharmacy". Falls back to a bounded geocoder search if Overpass is unavailable.
2. **Map tiles (the basemap).** The web map ([`src/components/map-results.tsx`](web/src/components/map-results.tsx))
   renders with **MapLibre GL** using **OSM raster tiles** (`tile.openstreetmap.org`) —
   free, no API key. Override with `NEXT_PUBLIC_MAP_STYLE` to point at a self-hosted
   vector style.
3. **Result links.** Each place links back to its **openstreetmap.org** object
   (`node`/`way`/`relation`), so users can open the canonical OSM record.

**Geocoder: public vs self-hosted.** Out of the box the API uses the **public Photon**
instance (`photon.komoot.io`) — Maps work with zero setup. To self-host (the
openserp/crawl4ai philosophy — zero external dependency), bring up the bundled Photon
container:

```bash
# tiny test index (Monaco, a few MB); set REGION to your country/continent or `planet`
HDSEARCH_PHOTON_REGION=monaco docker compose --profile maps up -d hd-photon
# point the API at it (otherwise it uses public Photon):
HDSEARCH_GEOCODER_URL=http://hd-photon:2322 docker compose up -d hdsearch
# …or locally:
./start_hd_search_all.sh --with-maps           # starts hd-photon + wires the local API
```

`REGION` selects the OSM extract Photon downloads on first run: `monaco` (MB) → a
country/continent (`usa`, `europe`, GB-scale) → `planet` (~116 GB, full world). Swap to
Nominatim with `HDSEARCH_GEOCODER_ENGINE=nominatim` + `HDSEARCH_GEOCODER_URL`.

## Other modalities & per-result actions

- **Maps** (`modality=maps`) — one tab with a **Map view / List view** toggle. *Map view*
  plots geo results on a MapLibre map; *List view* shows them as local-listing detail
  cards (category, address, and — with a `serper`/`serpapi` Google Places key — rating,
  reviews, phone, hours). There is no separate Places tab; `modality=places` still works
  via the API and redirects to the Maps List view in the UI. Queries are location-aware:
  `<category> in <place>` is bounded to the place and category-filtered via Overpass, and
  bare `<city> <ST>` (e.g. `dublin ca`) is normalized so it resolves to the right place.
- **Archive** (`modality=archive`) — **Wayback Machine** + **Common Crawl**. Results link to
  the *archived snapshot*; **Extract** pulls the captured page → markdown (never the live
  site). See `/v1/archive`.
- **Videos** (`modality=videos`) — YouTube results render as **inline click-to-play players**
  (official privacy-enhanced `youtube-nocookie.com` IFrame embed — ToS-compliant);
  thumbnails are derived from the video id so they never break.
- **Per-result actions** — **Extract** (crawl → markdown), **Screenshot** (full-page PNG),
  **PDF** (rendered) via crawl4ai/browserless; **Archived** (Common Crawl) for live results.
- **Search history** — recent searches kept in the **browser** (localStorage) by default;
  signed-in users sync to a **3-day Redis** window; **paid** plans add a durable **S3/SeaweedFS**
  archive. Managed under **Dashboard → Search History** and `/v1/history`.

## How to test

```bash
# 1) full automated API test suite (35 checks across every modality + crawl + vector)
cd api && npm run test:api -- --key sk-hds-YOUR_KEY --url http://localhost:8791

# 2) per-feature smoke tests (curl)
KEY=sk-hds-YOUR_KEY ; H="authorization: Bearer $KEY" ; J='content-type: application/json'
curl -s localhost:8791/v1/search -H "$H" -H "$J" -d '{"q":"Eiffel Tower","modality":"maps"}'        | jq '.results[0].extra.geo'
curl -s localhost:8791/v1/search -H "$H" -H "$J" -d '{"q":"example.com","modality":"archive","engine":"wayback"}' | jq '.results[0].extra.archive.snapshotUrl'
curl -s "localhost:8791/v1/archive?provider=wayback&url=https://example.com/"  -H "$H" | jq '{title,status,mdLen:(.markdown|length)}'
curl -s localhost:8791/v1/crawl  -H "$H" -H "$J" -d '{"url":"https://example.com","formats":["screenshot","pdf"]}' | jq '{shot:(.result.screenshot|length),pdf:(.result.pdf|length)}'
curl -s -H "$H" "localhost:8791/v1/history" | jq        # signed-in 3-day history (browser tier for demo)

# 3) self-hosted geocoder (after --with-maps / --profile maps): the index loads in the background
curl -s "localhost:2322/api?q=monaco&limit=1" | jq '.features[0].properties.name'
```

In the UI (`:3030`): try the **Maps** / **Videos** / **Archive** tabs, the **✕** clear button,
the **recent-searches** dropdown (focus the empty bar), and the **Screenshot/PDF** buttons
under any web result.

## Redis: dedicated `hdsearch-redis` (RediSearch)

The project runs its **own** redis-stack container, **`hdsearch-redis` on port 6390**
(`docker-compose.hdsearch-redis.yml`, `include`d by the main compose) — completely
separate from the shared `hd-redis` (:6379), which HD-Search never touches. It backs
**everything**: the cache, rate limiting, API-key verification, and **vectors with
true HNSW ANN** (RediSearch). Default `HDSEARCH_REDIS_URL=redis://…:6390/0`.

If you ever point `HDSEARCH_REDIS_URL` at a plain Redis (no RediSearch), the vector
layer transparently falls back to brute-force cosine — auto-detected at boot.

## RediSearch — evaluation & recommendation

**Yes, use it** (now the default via `hdsearch-redis`). For §10/§11 (vector store +
KNN search) RediSearch gives true ANN
(HNSW) co-located with the same Redis that already shields us from upstream blocking
— one datastore, no extra service. HD-Search **auto-detects** the module:

- **RediSearch present** (the bundled `hdsearch-redis`) → `FT.CREATE` HNSW index,
  `FT.SEARCH … KNN` with binary FLOAT32 vectors. **This is the default.**
- **Plain Redis** (if you repoint `HDSEARCH_REDIS_URL`) → transparent **brute-force
  cosine** fallback so vectors still work.

`hdsearch-redis` starts automatically with `./start_hd_search_all.sh` /
`./start_hd_search_stack.sh`. Vectors always carry a TTL (24h default).

## Security & resiliency (built-in from day one)

- Per-user provider keys **AES-256-GCM** encrypted at rest; plaintext never hits the DB.
- `sk-hds-` API keys stored as **sha256** only; shown once; per-key scopes + rate limits.
- Every upstream call: **timeout + bounded retries + backoff** (`src/http.ts`).
- Redis/Postgres/S3 outages **degrade, never crash** (health flags, fail-open rate limit,
  best-effort metrics).
- Structured JSON logging with request ids; global error handler never leaks stacks.

## Roadmap (iteration 2)

- **Next.js (App Router) UI** — SerpAPI-style: marketing/home faceted search, Auth0
  sign-in, Dashboard, Search History, Account (Profile/Billing/API Keys/Plans),
  Integrations (MCP/API), Documentation, Services. The API already exposes everything
  the panel needs (`/v1/account*`, `/v1/keys*`, `/v1/engines`, `/openapi.json`).
- **Auth0** — the API trusts the web BFF via `X-HD-Internal` + `X-HD-User` (the Auth0
  `sub`); wire Auth0 in the Next.js app and create the user row on first login.
- **Stripe UI** — `/v1/billing/checkout` + `/portal` + `/webhook` are implemented;
  set `STRIPE_*` price ids and add the buttons.
- More providers (the 81 in the sheet) + onion-proxied darkweb engines.

## Documentation

Full docs in [`docs/`](docs/README.md):
- [PRD](docs/PRD.md) · [Technical Design](docs/TECHNICAL_DESIGN.md) ·
  [Configuration & Deployment](docs/CONFIGURATION_DEPLOYMENT.md) ·
  [Performance / Scale / Security](docs/PERFORMANCE_SCALE_SECURITY.md)
- [OpenSERP engines](docs/OPENSERP.md) · [Darkweb landscape](docs/DARKWEB_SEARCH.md) ·
  [DB roles & credentials](api/db/CREDENTIALS.md)
- [**AI Mode spec**](docs/AI_MODE_SPEC.md) — Google-style AI Mode: LLM + MCP providers,
  OR auto-select optimizer, semantic MCP-tool selection, credits/margin, assistant-ui/tool-ui

The live provider catalogue is always available at `GET /v1/engines`.
