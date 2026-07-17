<div align="center">

# HD-Search

**One self-hosted API for search, crawl, vector search, and agentic AI answers — across 20+ engines.**

A free, open-source alternative to SerpAPI + Perplexity that you run on your own
box. Prioritized multi-engine search with fallback & dedup, a Redis cache,
per-user **encrypted** provider keys, vector search + RAG over your own files,
an agentic **AI Search** with tools, and an **MCP server** — TypeScript throughout.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Docker: hackerdogs/hdsearch](https://img.shields.io/badge/docker-hackerdogs%2Fhdsearch-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/r/hackerdogs/hdsearch)
![Self-hosted](https://img.shields.io/badge/self--hosted-100%25-brightgreen)
![No API bills](https://img.shields.io/badge/aggregator-%240%2Fmo-blueviolet)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-orange)

[Quickstart](#-quickstart-2-minutes) · [Features](#-features) · [API](#-api) · [AI Search](#-ai-search-agentic) · [MCP](#-mcp-server) · [Config](#%EF%B8%8F-configuration) · [Security](#-security--privacy) · [Self-host at scale](#-production--scaling)

</div>

---

## ✨ Features

- **🔎 Meta-search across 20+ engines** — SearXNG, OpenSERP (Google/Yandex/Baidu/Bing), DuckDuckGo, Wikipedia, and more. Prioritized **fallback** (free/self-hosted first) or **aggregate** mode with cross-engine **dedup** and **facets**.
- **🗂️ 12 modalities** — web, news, images, videos, **maps**, scholar, shopping, code, social, **web archive** (Wayback + Common Crawl), and **darkweb** (Ahmia over Tor).
- **🕷️ Crawl** — fetch any URL to clean markdown / links / text via self-hosted Crawl4AI + a headless-Chrome fallback for JS pages.
- **🧠 Vector search + RAG** — index documents (24h TTL) and run semantic KNN via Redis **RediSearch** (HNSW), with a brute-force fallback. Upload your own files → parse → embed → retrieve, with **citations**.
- **🤖 AI Search (agentic)** — a chat that plans and calls tools (`search`, `maps`, `crawl`, `archive`, `chart`, `weather`, render UI) and streams the answer. Works with **local Ollama (no API key, $0)** or any commercial model you add.
- **🔌 MCP server** — expose `hd_search`, `hd_crawl`, `hd_vector_search`, `hd_vector_index`, `hd_list_engines` to Claude / any MCP client.
- **🔐 Bring-your-own keys, encrypted** — commercial engine/LLM keys are entered in the UI and stored **AES-256-GCM encrypted** in your DB. Nothing leaves your infra.
- **📦 Truly self-contained** — one `docker compose up` bundles Postgres, Redis, SeaweedFS, embeddings, and every provider. No accounts, no SaaS, no per-request bills for the aggregator.

## 🚀 Quickstart (2 minutes)

You need **Docker** (with Compose). Nothing else.

### Option A — run the published images (recommended)

```bash
git clone https://github.com/hackerdogs-ai/hdsearch.git && cd hdsearch
docker compose -f docker-compose.hub.yml up -d          # pulls hackerdogs/hdsearch:api + :web
open http://localhost:3000                              # first run → create your admin account
```

### Option B — build from source

```bash
git clone https://github.com/hackerdogs-ai/hdsearch.git && cd hdsearch
docker compose -f docker-compose.selfhost.yml up -d --build
open http://localhost:3000
```

That's the whole setup. **There are no secrets to configure** — the app
auto-generates its crypto secrets on first boot. On first visit you create the
**admin account** in the browser (or set `HDSEARCH_ADMIN_EMAIL` /
`HDSEARCH_ADMIN_PASSWORD` for a headless bootstrap).

**Add search/LLM provider keys later, in the UI** — *Account → Provider Keys* (per-user) or *System Admin* (system-wide). The free/self-hosted engines and local Ollama work out of the box with no keys.

> Only the web (`:3000`) and API (`:8791`) ports are published; the bundled
> datastores stay on a private network.

### Try it

```bash
# issue an API key: Account → API Keys in the UI, or:
docker compose -f docker-compose.hub.yml exec hds-api node dist/scripts/hds-keys.js issue --user me --name laptop

KEY=sk-hds-...
curl http://localhost:8791/v1/search -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"q":"open source search","mode":"aggregate","facets":true}'
```

## 🧩 Architecture

```
                          ┌───────────────────────────── hdsnet (private) ─────────────────────────────┐
  Browser ─▶ hds-web ─▶ hds-api ─▶ engine ─▶ providers  (searxng, openserp, crawl4ai, browserless, tor) │
             (Next.js)   (Hono)  │  ├─ Redis Stack  ── cache · rate-limit · RediSearch vector index      │
                                 │  ├─ Postgres/TimescaleDB ── users · encrypted keys · history          │
                                 │  ├─ SeaweedFS (S3) ── crawl archive · uploaded files                  │
                                 │  ├─ embeddings (MiniLM-384) ── vectors for search + RAG               │
                                 │  └─ Ollama (host) ── local LLMs for AI Search (no key, $0)            │
  MCP client ─▶ hd-search MCP ───┘                                                                       │
                          └────────────────────────────────────────────────────────────────────────────┘
```

Every backend is bundled and internal-only. The API degrades gracefully if an
optional dependency is down (search still works without Postgres; vector falls
back to brute-force without RediSearch, etc.).

## 📚 API

Base URL `http://localhost:8791`. Auth: `Authorization: Bearer sk-hds-…`. Full
interactive spec at `GET /v1/openapi` (Swagger UI in the dashboard).

| Endpoint | Purpose |
|---|---|
| `POST /v1/search` · `GET /v1/search` | Aggregated/fallback search. Body: `q, modality, engine?, mode(fallback\|aggregate), limit, page, facets, freshness?, country?, lang?, noCache?` |
| `POST /v1/crawl` | Crawl a URL → `{ result: { markdown, links, ... } }`. `render:true` for JS pages. |
| `POST /v1/search/vector/index` · `POST /v1/search/vector` | Index documents (per-namespace, TTL) and semantic KNN search. |
| `GET /v1/archive` | Extract a Wayback / Common Crawl capture. |
| `GET /v1/engines` | List engines, modalities, access type, and availability. |
| `POST /v1/ai/chat` | Agentic AI Search (SSE stream). |
| `POST /v1/openai/chat/completions` | OpenAI-compatible chat endpoint. |
| `PUT /v1/keys/providers` · `POST /v1/keys/api` | Manage provider keys (encrypted) and API keys. |
| `GET /healthz` | Deep health (redis/postgres/seaweedfs/rediSearch). |

<details><summary>Search response (trimmed)</summary>

```json
{ "query":"open source search","total":16,"cached":false,"tookMs":1254,
  "engines":[{"engine":"searxng","ok":true,"count":16}],
  "results":[{"title":"…","url":"https://…","snippet":"…","engine":"searxng"}],
  "facets":{"engine":[…],"site":[…]} }
```
</details>

## 🤖 AI Search (agentic)

A chat that **plans, calls tools, and streams** a cited answer. Tools:
`hd_search`, `hd_maps`, `hd_plot_map`, `hd_crawl`, `hd_archive`, `hd_chart`,
`hd_weather`, and `hd_render` (rich UI components).

- **Local & free by default:** point it at a host-run **[Ollama](https://ollama.com)** — models are auto-discovered from whatever you've pulled, no API key, $0. The compose already wires `host.docker.internal:11434`.
- **Or any commercial model** (Anthropic, OpenAI, Google, xAI, Groq, Bedrock, Azure, OpenRouter) — add the key in the UI and pick the model from the dropdown.
- **RAG:** upload files to a chat → they're parsed, embedded, indexed, and retrieved to ground the answer with citations.

## 🔌 MCP server

Expose HD-Search to Claude / Cursor / any MCP client:

```jsonc
{ "mcpServers": { "hd-search": {
  "command": "node", "args": ["dist/mcp/server.js"],
  "env": { "HDSEARCH_API_URL": "http://127.0.0.1:8791", "HDSEARCH_API_KEY": "sk-hds-…" }
}}}
```
Tools: `hd_search`, `hd_crawl`, `hd_vector_search`, `hd_vector_index`, `hd_list_engines`.

## ⚙️ Configuration

`.env.selfhost` / `.env` is **optional** and contains **no secrets** — only ports,
URLs, and flags. Copy `.env.selfhost.example` to change a default.

| Var | Default | Purpose |
|---|---|---|
| `WEB_PORT` / `API_PORT` | `3000` / `8791` | Published host ports |
| `PUBLIC_API_URL` / `APP_BASE_URL` | localhost | Public URLs (set to your domain in prod) |
| `HDSEARCH_ADMIN_EMAIL` / `_PASSWORD` | – | Headless admin bootstrap (else use the UI) |
| `HDSEARCH_OPEN_SIGNUP` | `false` | Allow self-service signup |
| `HDSEARCH_OLLAMA_URL` | `host.docker.internal:11434` | Local LLMs for AI Search |
| `HDSEARCH_OPENSERP_ENGINES` | `google,yandex,bing,baidu` | OpenSERP engine order |
| `HDSEARCH_EMBEDDINGS_PROVIDER` | `minilm` | `minilm` \| `openai` \| `none` |
| `HDSEARCH_GEOCODER_URL` | public Photon | Self-hosted maps geocoder (`--profile maps`) |

**Provider keys and all secrets are handled in the UI or auto-generated — never in env.** See [docs/CONFIGURATION_DEPLOYMENT.md](docs/CONFIGURATION_DEPLOYMENT.md).

## 🔐 Security & privacy

- **Your data stays on your infra.** No telemetry, no external SaaS, no per-request calls home.
- **No secrets in files.** Encryption / session / internal-BFF secrets are auto-generated into a Docker volume; back it up for disaster recovery.
- **Provider keys are encrypted at rest** (AES-256-GCM) in your Postgres — plaintext keys never touch disk.
- **Local auth** — email + password (scrypt-hashed), first-run admin, DB-driven roles (`admin`/`user`). Sessions are an encrypted, `httpOnly` cookie.
- **Rate limiting** per identity (default 120/min) with `X-RateLimit-*` headers; CORS is configurable.

## ⚠️ Limitations & caveats

- **Free search engines vary.** Google via OpenSERP frequently hits CAPTCHAs from datacenter IPs — results lean on Yandex/Baidu/SearXNG unless you add residential proxies or a 2captcha key ([docs/OPENSERP.md](docs/OPENSERP.md)). This is inherent to scraping, not a bug.
- **AI answer quality tracks the model.** A small local Ollama model gives weaker open-ended answers than a frontier model; the tool-calling pipeline is the same. Add a commercial key for best results.
- **Darkweb/maps/scholar** coverage depends on upstream availability and may return empty cleanly.
- **First `up` is heavy** — it pulls a few GB (embeddings, browsers, providers). The embeddings image is amd64 (emulated on Apple Silicon).

## 📈 Production & scaling

- Front the API + web with a reverse proxy (Caddy/Nginx) and TLS; set `PUBLIC_API_URL`/`APP_BASE_URL` to your `https://` origin and restrict `HDSEARCH_CORS_ORIGINS`.
- The API and web are **stateless** — run multiple replicas. Give Postgres and Redis adequate resources; set Timescale retention + S3 lifecycle for the archive.
- **Back up two volumes:** `hds-secrets` (crypto keys) and `hds-postgres-data` (users, encrypted keys, history).
- Add residential proxies / 2captcha behind OpenSERP for reliable Google.
- See [docs/PERFORMANCE_SCALE_SECURITY.md](docs/PERFORMANCE_SCALE_SECURITY.md).

## 🐳 Publish your own images

Build & push multi-arch images to your own Docker Hub namespace:

```bash
./publish_to_docker.sh --help                 # full usage
./publish_to_docker.sh <namespace> v1.0.0     # build+push :api :web (multi-arch)
./publish_to_docker.sh --native <namespace>   # fast, this-arch only
./publish_to_docker.sh --build-only <namespace>
```

Then run them anywhere: `HDSEARCH_IMAGE_NS=<namespace> docker compose -f docker-compose.hub.yml up -d`.

## 🛠️ Development

```bash
# API (Hono)
cd api && npm install && npm run dev        # :8791 ; npm run typecheck ; npm run test
# Web (Next.js)
cd web && npm install && npm run dev        # :3000
```

- Test plan: [docs/E2E_TEST_PLAN.md](docs/E2E_TEST_PLAN.md) (190 cases across every subsystem).
- Migration/architecture notes: [docs/OPEN_SOURCE_MIGRATION.md](docs/OPEN_SOURCE_MIGRATION.md).
- Docs index: [docs/README.md](docs/README.md).

## 🗺️ Roadmap

- Optional OIDC/SSO on top of local auth · SQLite single-binary mode · more built-in providers · a public benchmark vs SerpAPI.

## 🤝 Contributing

Issues and PRs welcome. Providers follow a small plugin pattern (`api/src/providers/**`) — adding an engine is a self-contained file. Please run `npm run typecheck && npm run test` in `api/` before opening a PR.

## 📄 License

[MIT](LICENSE) © Hackerdogs.
