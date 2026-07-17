# Open-Source Migration Plan

Goal: turn hd-search from a SaaS-shaped product into a **self-hostable, free,
open-source app** that anyone can run in their own environment with minimal setup
— the [Directus](https://directus.io/docs/self-hosting/deploying) /
[NocoDB](https://nocodb.com/docs/self-hosting/environment-variables) model:
clone → `docker compose up` → open localhost → set an admin password.

## Why this is smaller than it looks

Three things are already true in the codebase, which is why this is "cut the
tethers and bundle the datastores," not a rewrite:

1. **Billing is external.** hd-search does not own Stripe. All real
   checkout/subscriptions live in an external `hackerdogs-core` service reached
   over HTTP. Locally, only two functions gate service: `checkQuota()` and
   `chargeUserCredits()`.
2. **Auth already has a local spine.** The dev-login flow
   (`web/src/app/api/auth/dev/route.ts`) is a complete non-Auth0 path; the
   encrypted session cookie (`web/src/lib/session.ts`) is auth-agnostic; a users
   table + profile upsert already exist (`api/src/routes/account.ts`).
3. **Every infra dependency degrades gracefully.** DB, Redis cache, S3,
   embeddings, core, feeds all tolerate being absent. The only real blocker is
   that `docker-compose.yml` *points at* externally-provisioned shared
   containers (`hdnet` network) instead of *bundling* them.

---

## Phase 0 — Make it free  ✅ DONE

Neutralize the only hard monetization gates. Stub-to-unlimited, delete nothing
(the plan/credit modules are imported across ~10 files; stubbing is reversible
and low-risk).

- [x] `checkQuota()` returns unlimited unconditionally — removes every HTTP 402
      in search/crawl/vector, including the vector-entitlement gate
      (`api/src/plans.ts`).
- [x] `chargeUserCredits()` is a no-op — credit metering disabled
      (`api/src/charge-credits.ts`).
- [x] Drop the AI model plan-gate 403 (`api/src/routes/ai.ts`) — models are now
      limited only by whether an API key/provider is available.
- [x] Removed now-unused imports; `npm run typecheck` clean; all 39 tests pass.

> Both stub points are kept as single chokepoints so an *optional local
> rate-limit* (off by default) could be reintroduced later without touching
> callers — protecting a solo user's provider keys from a runaway script.

---

## Phase 1 — Make it self-contained  ✅ DONE & SMOKE-TESTED

**Smoke test (full stack built & run):** all containers healthy; API `/health` OK;
real search via API (5 live results, 1.7s) and via the UI (16 results, faceted);
RediSearch module loaded + `hds:vec:idx` vector index auto-created; embeddings
server returns 384-dim vectors; dev-login sign-in works (no Auth0) → authenticated
dashboard loads; zero console errors.

**Fixes made during smoke test:**
- **`api/scripts/migrate.ts`** — schema-path bug: it resolved `db/schema.sql`
  relative to the source layout only, so `node dist/scripts/migrate.js` looked in
  `dist/db/` (which doesn't exist — the Dockerfile copies `db/` to `/app/db`).
  Now tries both candidate paths. *This also fixes the original `docker-compose.yml`
  migrate step, which had the same latent bug.*
- Web host port: `hackerdogs-browserless` (shared stack) already owns `:3000`, so
  `.env.selfhost` uses `WEB_PORT=3300` on this machine. (Outside users with a free
  `:3000` keep the example default.)

**Known cosmetic leftover (→ Phase 3):** the dashboard still shows "Plan: Free" and
"Quota 0 / 100" and an "Upgrade Plan" nav item. Quotas are *not* enforced anymore
(backend is unlimited) — this is stale commerce UI to remove in Phase 3.



`docker compose up` works with nothing pre-installed. Delivered as a NEW
`docker-compose.selfhost.yml` (the existing `docker-compose.yml` — which reuses
shared `hdnet` infra — is left untouched, per project constraint).

- [x] **New `docker-compose.selfhost.yml`** bundling every backend the app uses,
      on its own `hdsnet` network with `hds-*` names (no collision with your
      shared `hd-db`/`hd-redis`/`hd-seaweedfs`); datastores are internal-only
      (no published host ports), only `hds-api` (8791) and `hds-web` (3000) are
      exposed. Validated with `docker compose config`.
  - [x] `hds-db` — `timescale/timescaledb:latest-pg17` (hypertables work as-is)
  - [x] `hds-redis` — `redis/redis-stack-server` (RediSearch/HNSW for vector)
  - [x] `hds-seaweedfs` — `chrislusf/seaweedfs` S3 (**SeaweedFS, not MinIO**)
  - [x] `hds-embeddings` — `transformers-inference` MiniLM-L6 (384-dim)
  - [x] providers: `hds-openserp`, `hds-searxng`, `hds-crawl4ai`,
        `hds-browserless`, `hds-tor`; opt-in `hds-photon` (`maps` profile)
  - [x] `hds-migrate` one-shot applies `db/schema.sql`, then `hds-api` starts
        (`depends_on: service_completed_successfully`) → schema auto-created
- [x] **`.env.selfhost.example`** with the 3 shared secrets + `openssl` gen notes.
- [x] `authMode=legacy` set in the self-host compose (no core/Stripe/hdfeeds).
- [x] No dependency on the parent-monorepo `start_core_infra.sh`.
- [ ] `HDSEARCH_DEV_LOGIN=true` is a **temporary auth bridge** in the compose —
      remove once Phase 2 local auth lands.
- [ ] Trends panel: `hdfeeds` is a separate sibling app, not bundled — `/trends`
      stays inactive unless the user wires `HDSEARCH_HDFEEDS_*` to a running
      hd-feeds. (Optional; degrades cleanly to empty.)
- [ ] (Deferred, only needed for a *plain-Postgres* option — the bundled stack
      uses timescaledb so this isn't required now) guard the two
      `SELECT create_hypertable(...)` calls in `api/db/schema.sql`.

### Run it

```
docker compose -f docker-compose.selfhost.yml up -d --build   # no config needed
open http://localhost:3000                    # first run: create the admin account
```

No secrets to set (see "Secrets model" below). Copy `.env.selfhost.example` only
to change non-secret defaults (ports/URLs/flags), then add `--env-file .env.selfhost`.

> First `up` pulls several GB (embeddings + browsers + providers) and builds the
> api/web images; the embeddings image is amd64 (emulated on Apple Silicon).

### Secrets model — no secrets in `.env`

`.env.selfhost` contains **no secrets** (only ports, URLs, flags). Secrets are
handled in three ways so the user never pastes one into a file:

- **App crypto secrets** (encryption key, internal BFF secret, web session
  secret) — auto-generated on first boot and persisted to a shared Docker volume
  (`hds-secrets`, mounted at `/secrets` in both api + web). They agree
  automatically and survive restarts (verified: generated once, byte-stable
  across restart → the encryption key never rotates out from under stored data).
  Both containers run as uid 10001 so the `0600` file is shared. `env.ts` /
  `web/src/lib/config.ts` fall back from env → shared file → generate.
- **Bundled-infra credentials** (Postgres / SeaweedFS) — fixed internal defaults
  in the compose; those services are never exposed off the private network.
- **Provider API keys** (OpenAI, Brave, SerpAPI, …) — entered in the **UI**
  (Account → Provider Keys, or Dashboard → System Admin for system-wide default
  keys), stored AES-256-GCM encrypted in the DB. Never in env.

---

## Phase 2 — Local auth (first-run admin, no Auth0)  ✅ DONE & SMOKE-TESTED

Adopted the Databasus/Directus model: local email/password in the app's own DB,
first-run admin onboarding, **no hardcoded default password** (forced at first run).

- [x] `password_hash` + `role` columns on `hd_search.users` (idempotent ALTERs) +
      a case-insensitive unique email index (`api/db/schema.sql`).
- [x] `api/src/password.ts` — scrypt hashing via Node's built-in crypto
      (**zero new dependency**), self-describing hash format + min-length policy.
- [x] `api/src/routes/auth-local.ts` — public `GET /v1/auth/status`,
      `POST /v1/auth/register` (first account → admin, then closed unless
      `HDSEARCH_OPEN_SIGNUP`), `POST /v1/auth/login`; mounted in `app.ts`.
- [x] Grant `admin:platform` from the DB `role` column on the internal-header
      path (`api/src/auth.ts` `roleForUser`) — closes the "admin unreachable in
      local mode" gap.
- [x] Headless bootstrap: `HDSEARCH_ADMIN_EMAIL`/`HDSEARCH_ADMIN_PASSWORD`
      consumed once at startup (`api/src/index.ts` `bootstrapAdminUser`); env
      wiring in `env.ts` + `docker-compose.selfhost.yml`.
- [x] Web: first-run onboarding vs. sign-in screen driven by `/v1/auth/status`
      (`web/src/app/login/page.tsx`) + `web/src/app/api/auth/local/route.ts`
      (sets the existing encrypted session cookie). Dev-login bridge removed from
      the compose.
- **Smoke test (curl + browser):** status→register→closed→login(right/wrong 200/401);
      admin RBAC via DB role (admin 200 / user 403 on `/v1/admin/default-keys`);
      full browser flow onboarding → create admin → auto-login → logout → sign in →
      consent → authenticated app; 39/39 api tests pass.

**Deferred to Phase 3** (not required for local auth to work): physically removing
the Auth0 route files (`web/src/lib/auth.ts`, `web/src/app/api/auth/{login,callback,
logout,verified,resend}`, `session-jwt.ts`) and making `coreClient.ts` calls inert —
they're already dormant (`authMode=legacy`, no `AUTH0_*`), so this is cleanup.

---

## Phase 3 — Public-repo cleanup  🟡 IN PROGRESS

- [x] **Removed commerce UI** (verified `next build` clean): deleted
      `web/src/app/pricing`, `dashboard/billing`, `dashboard/usage`,
      `api/panel/checkout`, the quota-banner components (`quota-warning-banner-*`,
      `site-header-quota`, `dashboard-header-with-quota`, `billing-actions`,
      `quota-banner-dismiss-button`) and `lib/fetch-plan-cards.ts`; removed the
      "Upgrade Plan"/"Usage Analytics" nav items, the dashboard quota tile +
      "Monthly quota" card, and all `/pricing` · `/dashboard/billing` dead links
      (header, footer, home, account-keys, cache-ttl). Kept `lib/plans-static.ts`
      (static data, no side effects).
- [x] **Removed dormant Auth0 OAuth routes**: deleted `api/auth/{login,callback,
      verified}`, severed Auth0 from `api/auth/logout` (now a plain cookie-clear),
      simplified the login page to local-auth-only. Kept `resend` (email verify)
      and `dev` routes. Left `lib/auth.ts`/`session-jwt.ts`/`dev-core-auth.ts` in
      place — they are **load-bearing** for the local-auth/core request path
      (`api.ts`, `core-settings.ts`), not dormant.
- [x] **Rewrote README intro** to lead with the self-host quickstart (not
      Auth0/Stripe).
- [x] Removed `STRIPE_*` lines from `api/.env.example`, deleted dead
      `api/dist/.../billing.js`, and dropped the two `/v1/billing/*` entries from
      the OpenAPI spec (`api/src/openapi.ts`). api typecheck clean.
- [x] Verified clean: `next build` green, web+api typecheck green, dashboard
      visually confirmed (no plan/quota/upgrade UI), no console errors.
- [ ] **Scrub secrets** in `api/db/CREDENTIALS.md` / `roles.sql` — **FLAGGED for
      your decision**: these are the *shared/original* setup's dev passwords (the
      self-host stack uses a single `hdsearch` role and doesn't touch them), the
      repo is already public (git history retains them), and changing `roles.sql`
      would alter your shared workflow. Recommend rotating shared-infra passwords
      as an ops task rather than a code edit here.
- [ ] Strip internal branding (`hackerdogs`/`hdnet`) from public-facing config —
      **FLAGGED**: some identifiers are shared with your running infra; needs a
      careful pass so it doesn't break the shared `docker-compose.yml`.
- [ ] Confirm `LICENSE`; review `tos/`, `terms/`, `disclaimer` for public release.
- [ ] Remove internal artifacts (`Additional_Data_Sources_Research_11.xlsx`,
      `prompt.txt`, `tools-test-prompts.md`) — **awaiting your OK** (they're your
      files, not secrets; recoverable via git either way).

---

## Phase 4 — Optional follow-ups  ⬜ TODO

- [ ] OIDC/OAuth SSO, off by default, layered on top of local auth.
- [ ] Knex-style DB abstraction + SQLite option for a single-binary,
      zero-external-service experience. (Note: current code is Postgres-dialect
      specific — JSONB, `TEXT[]`, `GENERATED ALWAYS AS IDENTITY` — so SQLite is a
      real port, not a config flip. Bundled Postgres in Phase 1 already gives a
      zero-manual-setup experience.)

---

## Dependency reference (from codebase analysis)

| Dependency | Status | Notes |
|---|---|---|
| Postgres | Optional at runtime; needed for persistence | vanilla PG works once `create_hypertable` is guarded |
| TimescaleDB | Optional | extension already guarded; only speeds 2 metrics tables |
| Redis | ~Hard for vector/rate-limit; cache degrades | plain Redis/Valkey fine |
| RediSearch module | Optional | brute-force cosine fallback in `api/src/vector.ts` |
| SeaweedFS / S3 | Optional | crawl archival + file-upload originals only |
| Embeddings (MiniLM) | Optional (needed for vector/RAG unless OpenAI key) | `HDSEARCH_EMBEDDINGS_PROVIDER=none` disables |
| hackerdogs-core | Optional | SaaS auth/credits/billing; `authMode=legacy` disables |
| hdfeeds | Optional | `/trends` panel only |
| Stripe | Optional | billing lives entirely in core |
