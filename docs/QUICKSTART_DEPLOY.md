# HD-Search — Quickstart Deployment (5 minutes)

The shortest path to a running, fully self-hosted HD-Search (API + web UI +
search/crawl/vector, with its own bundled Postgres, Redis/RediSearch, SeaweedFS,
and embeddings). For the full reference see
[CONFIGURATION_DEPLOYMENT.md](CONFIGURATION_DEPLOYMENT.md).

---

## Prerequisites

- **Docker** with Compose. That's it — the self-host stack bundles every backend
  it needs on its own private network. Nothing external, no accounts, no API keys
  required to start.

---

## Run it (one command)

```bash
docker compose -f docker-compose.selfhost.yml up -d --build
```

The first `up` pulls a few GB (embeddings + browsers + providers) and builds the
API/web images, then auto-migrates the database. When it settles:

```bash
open http://localhost:3000            # first run → "create admin account" screen
curl http://localhost:8791/healthz    # API health (bundled deps should be true)
```

Create your admin account in the browser (the first account is the administrator),
and you're in. **There is nothing to configure to start** — see *Secrets* below.

Stop it: `docker compose -f docker-compose.selfhost.yml down`
(add `-v` to also wipe the data/volumes).

---

## Get an API key and search

API keys are managed in the UI: **Account → API Keys** (a default key is also
issued when your account is created — copy it, it's shown once). Then:

```bash
KEY=sk-hds-...
curl http://localhost:8791/v1/search -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"q":"open source search","mode":"aggregate","facets":true}'
```

(CLI alternative: `docker compose -f docker-compose.selfhost.yml exec hds-api \
node dist/scripts/hds-keys.js issue --user me --name laptop`.)

---

## Provider API keys — in the UI, never in a file

Commercial engines (OpenAI, Brave, SerpAPI, …) are optional; the free/self-hosted
engines work out of the box. To add commercial keys:

- **Account → Provider Keys** — your own keys (stored AES-256-GCM encrypted in the DB).
- **Dashboard → System Admin** — system-wide default keys (admin only).

Never put provider keys in an env file.

---

## Secrets — automatic, nothing to set

You don't set any secrets to run. The app's crypto secrets (encryption / internal
BFF / web session) are **auto-generated on first boot** and persisted to the
`hds-secrets` Docker volume, shared by the API and web containers so they agree
and survive restarts.

- **Disaster recovery:** the encryption key lives in the `hds-secrets` volume.
  Back that volume up if you want stored provider keys to survive a full
  `docker compose down -v`. It is reused across restarts, never rotated.
- **Sign-in issues / "not authenticated"?** The session cookie is set on the
  *same origin* you browse. Redirects honor `X-Forwarded-Host`/`X-Forwarded-Proto`
  (then `Host`), so `localhost`, `127.0.0.1`, a custom port, or a reverse
  proxy/tunnel all work. Behind a TLS proxy, make sure it forwards those headers
  (Caddy/Nginx do by default) so the cookie is marked `Secure` for your real origin.

---

## Optional configuration

Copy `.env.selfhost.example` → `.env.selfhost` only to change **non-secret**
defaults (host ports, public URL, open signup, headless admin), then:

```bash
docker compose --env-file .env.selfhost -f docker-compose.selfhost.yml up -d --build
```

Useful knobs: `WEB_PORT` / `API_PORT`, `PUBLIC_API_URL` / `APP_BASE_URL`,
`HDSEARCH_OPEN_SIGNUP=true` (allow self-service signup), `HDSEARCH_ADMIN_EMAIL` +
`HDSEARCH_ADMIN_PASSWORD` (create the admin headlessly instead of via the UI).

---

## Going to production (checklist)

1. **TLS + URLs** — serve behind a reverse proxy (Caddy/Nginx); set `PUBLIC_API_URL`
   and `APP_BASE_URL` to your public `https://…` so session cookies are `Secure`;
   restrict `HDSEARCH_CORS_ORIGINS` to your domains.
2. **Back up volumes** — `hds-secrets` (crypto keys) and `hds-postgres-data`
   (users, encrypted provider keys, history). Losing `hds-secrets` makes stored
   provider keys unrecoverable.
3. **Admin** — create the admin via the first-run screen, or set
   `HDSEARCH_ADMIN_EMAIL`/`HDSEARCH_ADMIN_PASSWORD` for a headless bootstrap. Keep
   `HDSEARCH_OPEN_SIGNUP` off unless you want public registration.
4. **Darkweb (optional)** — the bundled Tor proxy powers Ahmia/Torch onion access.
5. **OpenSERP Google (optional)** — add residential proxies or a 2captcha key
   (see [OPENSERP.md](OPENSERP.md)) to make Google contribute reliably.
6. **Scale** — the API and web are stateless; run multiple replicas and give the
   bundled Postgres/Redis adequate resources. See
   [PERFORMANCE_SCALE_SECURITY.md](PERFORMANCE_SCALE_SECURITY.md).

---

## Smoke test (verify a deploy)

```bash
API=http://localhost:8791
curl -s $API/healthz | jq                 # redis, postgres, seaweedfs, rediSearch all true
curl -s $API/v1/engines -H "authorization: Bearer $KEY" | jq '.count'   # engine catalog
curl -s $API/v1/search -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"q":"test","limit":3}' | jq '.total'
```

If `healthz` shows a dependency `false`, check that its container is healthy:
`docker compose -f docker-compose.selfhost.yml ps`.
