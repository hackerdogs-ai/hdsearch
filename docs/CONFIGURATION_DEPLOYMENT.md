# HD-Search — Step-by-Step Configuration & Deployment

Covers local dev, the one-command stack, full configuration reference, database
setup, providers, Auth0, Stripe, and MCP. Companion:
[Performance/Scale/Security](PERFORMANCE_SCALE_SECURITY.md).

---

## 0. Prerequisites

- Docker + the shared `hdnet` infra running: **hd-redis** (:6379), **hd-db**
  (TimescaleDB :5432), **hd-seaweedfs** (:8333), and (reused) **hackerdogs-crawl4ai**
  (:11235), **hackerdogs-browserless** (:3000), **hd-weaviate-t2v** embedder (host :8081 → container 8080).
  The project also runs its **own** `hdsearch-redis` (redis-stack/RediSearch, :6390).
- Node 20+ for local (non-Docker) runs.
- A Postgres superuser (e.g. `hackerdogs`) to create the DB + roles.

---

## 1. Database setup (one-time)

```bash
cd services/hd-search
PG_SUPER_PASSWORD='<hackerdogs password>' ./api/db/setup.sh
```
This creates DB **`hdsearch`**, the roles (`hdsearchadmin` / `hdsearchrw` /
`hdsearchreadonly`), the schema + hypertables, and grants. Idempotent. Use
`--reset` to wipe + recreate the schema. Passwords/connection strings:
[`api/db/CREDENTIALS.md`](../api/db/CREDENTIALS.md).

Verify:
```bash
docker exec -e PGPASSWORD='<pw>' hd-db psql -h 127.0.0.1 -U hdsearchadmin -d hdsearch -c '\dt hd_search.*'
```

---

## 2. Configure the API (`api/.env`)

`cp api/.env.example api/.env` then set at minimum:

> **Secrets are optional locally** — if `HDSEARCH_ENCRYPTION_KEY` and
> `HDSEARCH_INTERNAL_SECRET` are unset, the API auto-generates and persists them to
> `.hdsearch-secrets.json` (shared with the web app via the same file), so the panel +
> encrypted provider keys work out of the box. Set them explicitly in production and
> back up the file (`HDSEARCH_SECRETS_FILE` relocates it; mount a volume in Docker).

| Var | Purpose |
|---|---|
| `RUN_MODE` | `dev` = use `.env` commercial keys as a global fallback; `prod` = per-user keys only |
| `HDSEARCH_ENCRYPTION_KEY` | provider-key encryption. **Auto-generated** if unset (`openssl rand -hex 32` to set explicitly) |
| `HDSEARCH_INTERNAL_SECRET` | shared with the web app (BFF trust). **Auto-generated** if unset |
| `HDSEARCH_DATABASE_URL` | runtime, **hdsearchrw** role |
| `HDSEARCH_MIGRATION_DATABASE_URL` | migrations, **hdsearchadmin** role |
| `HDSEARCH_REDIS_URL` | project redis-stack `redis://127.0.0.1:6390/0` (NOT shared hd-redis) |
| `HDSEARCH_S3_ENDPOINT` + `STORAGE_AWS_*` | SeaweedFS S3 |
| `HDSEARCH_EMBEDDINGS_PROVIDER` / `_URL` | `minilm` + transformers-inference URL |
| Provider dev keys | `SERPAPI_API_KEY`, `BRAVE_SEARCH_API_KEY`, … (only used in `RUN_MODE=dev`) |

Apply schema (runs as the admin role automatically): `cd api && npm run migrate`.

---

## 3. Configure the web app (`web/.env`, or `web/.env.prod` for prod)

Convention matches the rest of the monorepo: **`.env` (dev) + `.env.prod` (prod) +
`.env.example` (template)** — no `.env.local`. The files are self-contained (hd-search shares
no env files with hackerdogs-core; values are duplicated explicitly).

| Var | Purpose |
|---|---|
| `HDSEARCH_API_URL` | server-side API base (e.g. `http://127.0.0.1:8791`) |
| `NEXT_PUBLIC_API_URL` | API base shown in docs/integrations (browser-visible) |
| `HDSEARCH_INTERNAL_SECRET` | **must equal** the API's (legacy/dev BFF trust; unused in `core` mode) |
| `HDSEARCH_WEB_SESSION_SECRET` | key for the **AES-256-GCM encrypted** session cookie. `openssl rand -hex 32` |
| `APP_BASE_URL` | public URL of the web app (OAuth callback origin) |
| `AUTH0_DOMAIN/CLIENT_ID` | shared tenant + SPA client (PKCE — no secret needed). See §7 |
| `HD_CORE_BASE_URL` | hackerdogs-core API for `/auth/token-exchange` + `/auth/me` |
| `NEXT_PUBLIC_CORE_BILLING_URL` | core billing portal the "Upgrade" buttons link to |
| `HDSEARCH_DEV_LOGIN` | `1` to allow the local dev login (default on in dev, **off in prod**) |

---

## 4. Run

### A) One command (local, both services + engines)
```bash
PG_SUPER_PASSWORD='<pw>' ./start_hdsearch.sh             # API :8791, Web :3030
#   WEB_PORT=3030 / API_PORT=8791 overridable; append `dev` for watch mode
./stop_hd_search.sh
```
This provisions `.env` files (shared secret), builds, **starts hdsearch-redis(:6390)
+ openserp(:7007) + searxng(:8899)**, **reuses crawl4ai + browserless + tor-proxy**,
migrates, and health-checks.

### B) Individually
```bash
./start_hd_search.sh           # API only
./start_hd_search_web.sh 3030  # web only (port arg)
```

### C) Deploy the published images (no local build)
```bash
docker pull hackerdogs/hdsearch:api   # multi-arch (amd64 + arm64)
docker pull hackerdogs/hdsearch:web
```
In `docker-compose.yml`, replace the two `build:` blocks with `image:`:
```yaml
hdsearch:     { image: hackerdogs/hdsearch:api }
hdsearch-web: { image: hackerdogs/hdsearch:web }
```
Build/publish your own: `./publish_to_docker.sh <dockerhub_user> v1.0.0 latest`.

### C) Full Docker stack
```bash
./start_hd_search_stack.sh             # hdsearch-redis + api + web + openserp + searxng on hdnet
```
The project's own **`hdsearch-redis`** (redis-stack / RediSearch, host **:6390**) is
defined in `docker-compose.hdsearch-redis.yml`, `include`d by the main compose, and
starts automatically. It is separate from the shared `hd-redis` (:6379), which is
never used. Run it standalone with
`docker compose -f docker-compose.hdsearch-redis.yml up -d`.

Health: `curl localhost:8791/healthz` · Web: `http://localhost:3030`.

---

## 5. Issue an API key & call it

```bash
cd api && npx tsx scripts/hds-keys.ts issue --user <id> --name laptop   # prints sk-hds-…
curl localhost:8791/v1/search -H "authorization: Bearer sk-hds-…" \
  -H 'content-type: application/json' -d '{"q":"openai","mode":"aggregate","facets":true}'
```

---

## 6. Providers

- **Self-hosted (free, default-on):** searxng (:8899), openserp (:7007). Reused:
  crawl4ai (:11235), browserless (:3000).
- **OpenSERP engines:** defaults to Yandex+Baidu (Google captchas datacenter IPs).
  To make Google work, add residential proxies or a 2captcha key — see
  [OPENSERP.md](OPENSERP.md). Engine order via `HDSEARCH_OPENSERP_ENGINES`.
- **Commercial:** add your key in the panel (Account → Provider Keys) or, in
  `RUN_MODE=dev`, in `api/.env`. Priorities in `src/priorities.csv` (hot-reloaded).
- **Darkweb:** Ahmia (free, clearnet) on by default; IntelligenceX (commercial,
  per-user key). Landscape: [DARKWEB_SEARCH.md](DARKWEB_SEARCH.md).
- **Archive (`modality=archive`):** Wayback Machine + Common Crawl — both free, no
  key. Results link to the archived snapshot; `/v1/archive` extracts the capture.
- **Maps (`modality=maps`):** OpenStreetMap geocoder. Defaults to the **public Photon**
  (`photon.komoot.io`) so Maps work with zero setup. To self-host, start the opt-in
  Photon container and point the API at it:
  ```bash
  ./start_hd_search_all.sh --with-maps                 # local: starts hd-photon + wires the API
  # or via compose:
  HDSEARCH_PHOTON_REGION=monaco docker compose --profile maps up -d hd-photon
  HDSEARCH_GEOCODER_URL=http://hd-photon:2322 docker compose up -d hd-search-api
  ```
  Env: `HDSEARCH_GEOCODER_ENGINE` (`photon`|`nominatim`), `HDSEARCH_GEOCODER_URL`,
  `HDSEARCH_PHOTON_REGION` (`monaco`→country/continent→`planet` ~116 GB). Map tiles use
  free OSM raster by default; override with `NEXT_PUBLIC_MAP_STYLE`.

---

## 7. Auth0 + central SSO (production sign-in) — go-live checklist

hd-search shares **hackerdogs-core's identity** (same Auth0 tenant as worldmonitor /
Streamlit). The web app runs **Authorization Code + PKCE** server-side (BFF), exchanges the
Auth0 id_token at core `/auth/token-exchange` for the **Hackerdogs JWT**, and stores it in an
**AES-256-GCM encrypted httpOnly cookie** — no tokens in the browser. The API validates the
JWT (no self-asserted headers in `core` mode). Out of the box with `AUTH0_*` unset (or
`HDSEARCH_DEV_LOGIN=1`) the built-in **dev login** runs so the app is usable without a tenant.
See `docs/AUTH_PLAN_INTEGRATION.md` for the design.

### A. Auth0 dashboard (one-time) — the only manual step
Reuse the **existing shared Auth0 application** (the SPA client worldmonitor uses) — do NOT
create a new one. In [Auth0 Dashboard](https://manage.auth0.com) → **Applications → that app
→ Settings**:
1. **Allowed Callback URLs** — add hd-search's callback for every origin it runs on:
   `http://localhost:3030/api/auth/callback`, `https://hdsearch.hackerdogs.ai/api/auth/callback`
2. **Allowed Logout URLs** — `http://localhost:3030`, `https://hdsearch.hackerdogs.ai`
3. **Allowed Web Origins** — same origins as above.
4. **Refresh Token Rotation** (Settings → *Refresh Token Rotation*) — **enable** it (the BFF
   requests `offline_access` and uses the rotating refresh token to refresh the core JWT).
5. Social connections (GitHub / Google) are **already** wired on this tenant for worldmonitor —
   no need to recreate. The app sends `connection=github` / `connection=google-oauth2`.
6. **Save Changes.**

> PKCE means **no client secret is required**. Leave `AUTH0_CLIENT_SECRET` blank unless you
> deliberately use a confidential (Regular Web App) client instead of the shared SPA client.

### B. Env (web `.env` / `.env.prod`) — same values as worldmonitor
```bash
AUTH0_DOMAIN=dev-qvl70rmqadokdop1.us.auth0.com      # shared tenant
AUTH0_CLIENT_ID=ACX4BvdDBpmT4AGAlCciqWpHCVkTVql4    # shared SPA client (worldmonitor)
# AUTH0_CLIENT_SECRET=                              # leave blank (PKCE)
# AUTH0_AUDIENCE=                                   # leave unset (as worldmonitor)
APP_BASE_URL=https://hdsearch.hackerdogs.ai         # this app's public origin
HD_CORE_BASE_URL=https://preview.hackerdogs.ai      # core API for /auth/token-exchange (dev: http://localhost:8000)
HDSEARCH_DEV_LOGIN=0                                # MUST be 0/unset in prod
```

### C. Env (api `.env` / `.env.prod`) — validate the JWT
```bash
HDSEARCH_AUTH_MODE=core      # prod: accept ONLY the verified Hackerdogs JWT (rejects X-HD-User)
JWT_SECRET_KEY=<same value as hackerdogs-core>   # HS256 secret the core signs JWTs with
HD_CORE_BASE_URL=https://preview.hackerdogs.ai   # for GET /auth/me (plan resolution)
```
> Use `HDSEARCH_AUTH_MODE=both` during cutover (accepts JWT *and* the legacy header), then flip
> to `core` once verified. `legacy` is the instant rollback.

### D. Core dependency (one-time, hackerdogs-core side)
- The web flow calls core **`POST /auth/token-exchange`** (already exists). For server-side
  plan resolution the API calls core **`GET /auth/me`** — confirm/add it (validates the JWT via
  the existing `get_current_user`, returns the user + `current_plan`). Until it exists, plan
  falls back to free.

### E. Verify
1. `${APP_BASE_URL}` → **Sign in** → GitHub/Gmail → approve. Flow: `/api/auth/login` (sets
   `state` + PKCE verifier cookies) → Auth0 `/authorize` → `/api/auth/callback` (verifies
   `state`, PKCE code exchange, core token-exchange, sets the **encrypted** `hd_session`
   cookie) → `/dashboard`.
2. Confirm the session cookie is **httpOnly + Secure** and the JWT is not readable from
   `document.cookie`.
3. With `HDSEARCH_AUTH_MODE=core`, confirm a request with only `X-HD-User` is **401** and a
   real signed-in session works (the BFF sends `Authorization: Bearer`).
   - **Reverse proxy?** Redirects + cookies follow `X-Forwarded-Host`/`-Proto`; ensure the
     proxy forwards them and the **Allowed Callback URL** exactly matches the public origin.

---

## 8. Billing — managed by hackerdogs-core (Stripe in hd-search is retired)

> **Updated:** hd-search no longer runs its own Stripe. Plans & billing are owned centrally
> by hackerdogs-core (Option B2): the user's existing core plan maps to hd-search tiers
> (`free→Chihuahua … enterprise→Alpha`), and the **Upgrade Plan** page links to the core
> billing portal via `NEXT_PUBLIC_CORE_BILLING_URL`. There is no `STRIPE_*` config, no
> `/v1/billing` endpoint, and no checkout in hd-search. See
> `docs/AUTH_PLAN_INTEGRATION.md` §4. The historical Stripe-in-hd-search notes below are
> kept for reference only.

**A. Create products & recurring prices**
1. In the [Stripe Dashboard](https://dashboard.stripe.com) (use **Test mode** first):
   **Product catalog → Add product** — create one product per paid plan (Dev /
   DevTest / Production), each with a **monthly recurring price**. Copy each price id
   (`price_…`).

**B. Get your keys**
2. **Developers → API keys** → copy the **Secret key** (`sk_test_…` / `sk_live_…`).

**C. Wire up env** — in **`api/.env`**:
   ```bash
   STRIPE_SECRET_KEY=sk_test_xxx
   STRIPE_PRICE_DEV=price_xxx            # → plan "dev"
   STRIPE_PRICE_DEVTEST=price_xxx        # → plan "devtest"
   STRIPE_PRICE_PRODUCTION=price_xxx     # → plan "production"
   STRIPE_WEBHOOK_SECRET=whsec_xxx       # from step D
   ```
   The price→plan mapping is by env-var name (`plans.ts`), so a paid checkout for a
   given price upgrades the user to the matching plan.

**D. Create the webhook**
3. **Developers → Webhooks → Add endpoint** → URL `POST {API_PUBLIC_URL}/v1/billing/webhook`
   → select events **`checkout.session.completed`** and **`customer.subscription.*`**
   (created/updated/deleted) → Add endpoint → copy the **Signing secret** (`whsec_…`)
   into `STRIPE_WEBHOOK_SECRET`. Restart the API.
   - **Local testing:** `stripe listen --forward-to localhost:8791/v1/billing/webhook`
     prints a `whsec_…` to use.

**E. Verify the flow**
4. Dashboard → **Plans & Billing** → **Upgrade** on a paid plan → this calls
   `POST /v1/billing/checkout` and redirects to Stripe Checkout. Pay with the test card
   `4242 4242 4242 4242` (any future expiry/CVC). On success Stripe fires
   `checkout.session.completed` → the webhook sets `users.plan` → your plan badge
   updates. **Manage**/cancel uses the Stripe Billing Portal via `POST /v1/billing/portal`.

---

## 9. MCP server

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

## 10. Production deployment notes

- Run API + web as the Docker images (`./api/Dockerfile`, `./web/Dockerfile`,
  both multi-stage, non-root, healthchecked) behind your reverse proxy (Caddy).
- Set `RUN_MODE=prod` (no shared `.env` provider keys; per-user only).
- Vectors use the bundled **`hdsearch-redis`** (RediSearch HNSW) by default; scale it
  vertically/with a cluster for large vector volumes.
- Put residential proxies / 2captcha behind openserp for Google.
- Rotate the dev-default DB passwords and all secrets.
- See [PERFORMANCE_SCALE_SECURITY.md](PERFORMANCE_SCALE_SECURITY.md).
