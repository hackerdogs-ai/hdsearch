# HD-Search — Quickstart Deployment (5 minutes)

The shortest path to a running HD-Search (API + web UI + search/crawl/vector + its
own RediSearch). For the full reference see
[CONFIGURATION_DEPLOYMENT.md](CONFIGURATION_DEPLOYMENT.md).

---

## Prerequisites (one-time)

- **Docker** running, with the shared `hdnet` network and these containers up:
  `hd-db` (TimescaleDB), `hd-seaweedfs`, `hd-weaviate-t2v` (embedder),
  `hackerdogs-crawl4ai`, `hackerdogs-browserless`, `hackerdogs-tor-proxy`.
  (HD-Search brings up its own `hdsearch-redis`, `hd-openserp`, `hd-searxng`.)
- **Node 20+** (only for the local, non-Docker run).
- The Postgres **superuser password** (to create the DB + roles the first time).

---

## Option A — Local, one command (recommended for dev)

```bash
cd services/hd-search

# 1) create DB + roles (first time only) — needs the superuser password
PG_SUPER_PASSWORD='<hackerdogs password>' ./api/db/setup.sh

# 2) start everything: API :8791 + Web :3030 + hdsearch-redis + openserp + searxng
PG_SUPER_PASSWORD='<hackerdogs password>' ./start_hd_search_all.sh
```

That's it. The script generates secrets, builds, migrates, starts the engines, and
health-checks. Then:

```bash
open http://localhost:3030          # web UI (sign in → dev login works w/o Auth0)
curl http://localhost:8791/healthz  # API health (all deps should be true)
```

Get an API key and search:

```bash
cd api && npx tsx scripts/hds-keys.ts issue --user me --name laptop   # prints sk-hds-…
KEY=sk-hds-...
curl http://localhost:8791/v1/search -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{"q":"hackerdogs","mode":"aggregate","facets":true}'
```

Stop everything: `./stop_hd_search.sh`

---

## Option B — Full Docker stack

```bash
cd services/hd-search
cp api/.env.example api/.env       # set HDSEARCH_ENCRYPTION_KEY + HDSEARCH_DATABASE_URL (hdsearchrw)
cp web/.env.example web/.env       # set HDSEARCH_INTERNAL_SECRET (same as api) + APP_BASE_URL
docker network create hdnet 2>/dev/null || true

# create DB + roles once
PG_SUPER_PASSWORD='<pw>' ./api/db/setup.sh

# build + start: api + web + hdsearch-redis + openserp + searxng (crawl4ai/browserless reused)
./start_hd_search_stack.sh
```

Web → http://localhost:3000, API → http://localhost:8791/healthz.

---

## Secrets — zero-config local, explicit in prod

You don't have to set any secrets to run locally. If `HDSEARCH_ENCRYPTION_KEY` and
`HDSEARCH_INTERNAL_SECRET` are not provided via env, the API **auto-generates and
persists** them to a shared file (`.hdsearch-secrets.json` at the service root, or
`HDSEARCH_SECRETS_FILE`). The web app reads the same file, so the panel, API-key
management, and **encrypted provider keys all work out of the box** — no more
"encryption isn't configured" / "not authenticated" errors.

- **Back up that file** — losing `encryptionKey` makes stored provider keys
  unrecoverable. It is reused across restarts (not regenerated).
- **Docker:** mount a volume at `HDSEARCH_SECRETS_FILE` (so it survives container
  restarts), or set the env vars explicitly.
- **Production:** set `HDSEARCH_ENCRYPTION_KEY`, `HDSEARCH_INTERNAL_SECRET`, and
  `HDSEARCH_WEB_SESSION_SECRET` explicitly (env always wins) and back them up.

**Sign-in shows nothing / "not authenticated" in the panel?** The session cookie must
be set on the *same origin* you browse. Auth redirects follow the request's
`X-Forwarded-Host`/`X-Forwarded-Proto` (then `Host`), so reaching the app via
`localhost`, `127.0.0.1`, a custom port, or a reverse-proxy/tunnel all work without
config changes. If you front it with a TLS proxy, make sure it forwards those headers
(Caddy/Nginx do by default) so the cookie is marked `Secure` for your real origin.

## Going to production (checklist)

1. **Secrets** — set strong, unique values and **back up** `HDSEARCH_ENCRYPTION_KEY`
   (losing it makes stored provider keys unrecoverable):
   - `HDSEARCH_ENCRYPTION_KEY` (`openssl rand -hex 32`)
   - `HDSEARCH_INTERNAL_SECRET` (same in `api/.env` and `web/.env`)
   - `HDSEARCH_WEB_SESSION_SECRET`
   - Rotate the dev-default DB role passwords (see `api/db/CREDENTIALS.md`).
2. **Run mode** — `RUN_MODE=prod` in `api/.env` (per-user keys only; no shared `.env` provider keys).
3. **Auth0** — set `AUTH0_DOMAIN/CLIENT_ID/CLIENT_SECRET` in `web/.env`; add
   `${APP_BASE_URL}/api/auth/callback` to Allowed Callback URLs; enable GitHub + Google connections.
4. **Stripe** — set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`
   in `api/.env`; point a webhook at `POST {API}/v1/billing/webhook`.
5. **TLS + URLs** — serve behind your reverse proxy (Caddy); set `APP_BASE_URL` to
   the public `https://…` (so session cookies are `Secure`); restrict
   `HDSEARCH_CORS_ORIGINS` to your domains.
6. **Darkweb (optional)** — `HDSEARCH_TOR_PROXY=socks5h://hackerdogs-tor-proxy:9050`
   for Ahmia/Torch onion access.
7. **OpenSERP Google (optional)** — add residential proxies or a 2captcha key
   (see [OPENSERP.md](OPENSERP.md)) to make Google contribute reliably.
8. **Scale** — front the API/web with multiple replicas (both stateless); give
   `hdsearch-redis` and `hd-db` adequate resources; set Timescale retention + S3
   lifecycle. See [PERFORMANCE_SCALE_SECURITY.md](PERFORMANCE_SCALE_SECURITY.md).

---

## Smoke test (verify a deploy)

```bash
curl -s $API/healthz | jq          # redis, postgres, seaweedfs, rediSearch all true
curl -s $API/v1/engines -H "authorization: Bearer $KEY" | jq '.count'   # engine catalog
# search (fast, via searxng)
curl -s $API/v1/search -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"q":"test","limit":3}' | jq '.total'
```

If `healthz` shows a dependency `false`, check that container is on `hdnet` and the
matching `HDSEARCH_*_URL` is correct.
