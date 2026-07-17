# HD-Search — Configuration & Deployment

Full reference for the **self-hosted** stack (`docker-compose.selfhost.yml`):
running it, the configuration surface, providers, local auth, and MCP. For the
5-minute path see [QUICKSTART_DEPLOY.md](QUICKSTART_DEPLOY.md); for scaling see
[Performance/Scale/Security](PERFORMANCE_SCALE_SECURITY.md).

---

## 0. Prerequisites

- **Docker** with Compose. Nothing else — the self-host stack bundles every
  backend on its own private network: Postgres/TimescaleDB, Redis (RediSearch),
  SeaweedFS, a local embeddings model, and the search/crawl providers (SearXNG,
  OpenSERP, Crawl4AI, Browserless, Tor).

---

## 1. Run

```bash
docker compose -f docker-compose.selfhost.yml up -d --build
```

The stack auto-migrates the database (a one-shot `hds-migrate` step) before the
API starts. Only two host ports are published — **web `:3000`** and **API
`:8791`**; every datastore is internal to the private network.

```bash
open http://localhost:3000            # first run → "create admin account"
curl http://localhost:8791/healthz    # deep health check (bundled deps true)
docker compose -f docker-compose.selfhost.yml ps      # container health
docker compose -f docker-compose.selfhost.yml down     # stop (add -v to wipe data)
```

---

## 2. Secrets — auto-generated, nothing to set

There are **no secrets in any env file**. On first boot the API generates the
encryption / internal-BFF / web-session secrets and persists them (JSON) to the
shared **`hds-secrets`** Docker volume, mounted at `/secrets` in both the API and
web containers so they agree automatically and survive restarts.

- Resolution order for each secret is **env var → shared file → generate**, so you
  *can* still pin one via env, but you never need to.
- **Back up the `hds-secrets` volume** for disaster recovery — losing the
  encryption key makes stored provider keys unrecoverable. It is reused across
  restarts, never rotated.
- Both containers run as uid 10001 so the `0600` secrets file is shared.

---

## 3. Configuration reference

Everything below is **optional** and non-secret. Copy `.env.selfhost.example` →
`.env.selfhost`, edit, and add `--env-file .env.selfhost` to the compose command.

| Var | Purpose | Default |
|---|---|---|
| `WEB_PORT` / `API_PORT` | published host ports | `3000` / `8791` |
| `PUBLIC_API_URL` | API base the browser uses (set to your host/domain) | `http://localhost:8791` |
| `APP_BASE_URL` | public URL of the web app | `http://localhost:3000` |
| `HDSEARCH_OPEN_SIGNUP` | `true` allows self-service signup | `false` (first-run admin only) |
| `HDSEARCH_ADMIN_EMAIL` / `_PASSWORD` | headless admin bootstrap (else use the UI) | unset |
| `HDSEARCH_OPENSERP_ENGINES` | OpenSERP engine order | `google,yandex,bing,baidu` |
| `HDSEARCH_GEOCODER_URL` | self-hosted maps geocoder (with `--profile maps`) | public Photon |
| `WEAVIATE_ENABLE_CUDA` | `1` if you have an NVIDIA GPU for embeddings | `0` |
| `HDSEARCH_CORS_ORIGINS` | comma list to restrict API CORS (prod) | `*` |

**Advanced** (already wired in the compose; change only if you know why):
`HDSEARCH_DATABASE_URL`, `HDSEARCH_REDIS_URL`, `HDSEARCH_S3_ENDPOINT` +
`STORAGE_AWS_*`, `HDSEARCH_EMBEDDINGS_URL`, `HDSEARCH_SECRETS_FILE`,
`HDSEARCH_AUTH_MODE` (`legacy` for self-host). Set
`HDSEARCH_EMBEDDINGS_PROVIDER=none` to disable vector search/RAG for a lighter
stack.

---

## 4. Providers

- **Self-hosted (free, on by default):** SearXNG, OpenSERP, Crawl4AI (crawl),
  Browserless (JS-rendered crawl), Tor (darkweb). All bundled — no keys.
- **OpenSERP / Google:** Google captchas datacenter IPs, so results lean on
  Yandex/Baidu/Bing by default. To make Google contribute, add residential
  proxies or a 2captcha key — see [OPENSERP.md](OPENSERP.md). Order via
  `HDSEARCH_OPENSERP_ENGINES`.
- **Commercial engines (optional):** add your key in the **UI** — Account →
  Provider Keys (per-user) or Dashboard → System Admin (system-wide). Stored
  AES-256-GCM encrypted in the DB; **never in env**. Priorities live in
  `api/src/priorities.csv` (hot-reloaded).
- **Darkweb:** Ahmia (free, clearnet) on by default via the bundled Tor proxy;
  IntelligenceX (commercial, per-user key). See
  [DARKWEB_SEARCH.md](DARKWEB_SEARCH.md).
- **Archive (`modality=archive`):** Wayback + Common Crawl — free, no key.
- **Maps (`modality=maps`):** OpenStreetMap geocoder, defaulting to the **public
  Photon** so maps work with zero setup. To self-host the geocoder:
  ```bash
  HDSEARCH_PHOTON_REGION=monaco \
    docker compose -f docker-compose.selfhost.yml --profile maps up -d hds-photon
  # then point the API at it:
  HDSEARCH_GEOCODER_URL=http://hds-photon:2322 \
    docker compose -f docker-compose.selfhost.yml up -d hds-api
  ```
  `HDSEARCH_PHOTON_REGION`: `monaco` (tiny test) → a country/continent → `planet`
  (~116 GB). Map tiles use free OSM raster; override with `NEXT_PUBLIC_MAP_STYLE`.

---

## 5. API keys & calling

Manage keys in the UI (**Account → API Keys**); a default key is issued when your
account is created (shown once). Or via CLI:

```bash
docker compose -f docker-compose.selfhost.yml exec hds-api \
  node dist/scripts/hds-keys.js issue --user me --name laptop     # prints sk-hds-…

curl http://localhost:8791/v1/search -H "authorization: Bearer sk-hds-…" \
  -H 'content-type: application/json' -d '{"q":"openai","mode":"aggregate","facets":true}'
```

---

## 6. Authentication — local email + password

Self-hosted auth is **local accounts stored in your own database** — no Auth0, no
external identity provider, no billing.

- **First run:** the web UI shows a **"create admin account"** screen; the first
  account created becomes the administrator. Alternatively, set
  `HDSEARCH_ADMIN_EMAIL` + `HDSEARCH_ADMIN_PASSWORD` to bootstrap it headlessly on
  first boot.
- **After setup, registration is closed** — only the admin exists — unless you set
  `HDSEARCH_OPEN_SIGNUP=true` to allow self-service signup.
- **Roles:** `admin` and `user`. Admin is derived from the DB `role` column and
  grants the platform-admin scope (System Admin pages, system-wide provider keys).
- **Passwords** are hashed with scrypt (Node built-in, no external dependency).
  Sessions are an AES-256-GCM **encrypted httpOnly cookie**; the key is
  auto-generated (§2).
- **Behind a reverse proxy:** auth redirects and the session cookie follow
  `X-Forwarded-Host`/`X-Forwarded-Proto` (then `Host`), so the cookie lands on the
  origin you actually browse. Ensure your proxy forwards those headers (Caddy/Nginx
  do by default) so the cookie is `Secure` for your public origin.

Relevant endpoints (public): `GET /v1/auth/status`, `POST /v1/auth/register`,
`POST /v1/auth/login`. The web BFF calls these and sets the session cookie.

---

## 7. MCP server

```jsonc
{ "mcpServers": { "hd-search": {
  "command": "node",
  "args": ["dist/mcp/server.js"],            // or: npx tsx mcp/server.ts
  "env": { "HDSEARCH_API_URL": "http://127.0.0.1:8791", "HDSEARCH_API_KEY": "sk-hds-…" }
}}}
```
Tools: `hd_search`, `hd_crawl`, `hd_vector_search`, `hd_vector_index`,
`hd_list_engines`.

---

## 8. Production deployment notes

- **Reverse proxy + TLS** (Caddy/Nginx); set `PUBLIC_API_URL` and `APP_BASE_URL`
  to your public `https://…` so session cookies are `Secure`, and restrict
  `HDSEARCH_CORS_ORIGINS` to your domains.
- **Back up volumes:** `hds-secrets` (crypto keys) and `hds-postgres-data` (users,
  encrypted provider keys, history). Optionally `hds-seaweedfs-data` (crawl
  archives / uploaded files).
- **Admin & signup:** create the admin via the first-run screen or the headless
  env vars; keep `HDSEARCH_OPEN_SIGNUP` off unless you want public registration.
- **Providers:** put residential proxies / a 2captcha key behind OpenSERP for
  Google; add commercial engine keys in the UI.
- **Scale:** the API and web are stateless — run multiple replicas; give the
  bundled Postgres/Redis adequate resources. See
  [PERFORMANCE_SCALE_SECURITY.md](PERFORMANCE_SCALE_SECURITY.md).
- **Images:** `api/Dockerfile` and `web/Dockerfile` are multi-stage, non-root,
  and healthchecked. Build your own or run the ones the compose builds.
