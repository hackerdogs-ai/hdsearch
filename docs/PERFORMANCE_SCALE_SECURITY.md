# HD-Search — Performance, Scale, Security & Resiliency

Companion to [Technical Design](TECHNICAL_DESIGN.md) and
[Configuration & Deployment](CONFIGURATION_DEPLOYMENT.md).

---

# Part A — Performance

## A.1 Latency budget & measured behavior

| Path | Typical | Why |
|---|---|---|
| Cached search/crawl | **< 50 ms** | served from Redis computed-cache |
| Live fallback search (searxng first) | **~1 s** | one fast local meta-search |
| Live aggregate search | **≤ deadline (~6 s)** | fan-out bounded by `HDSEARCH_AGGREGATE_DEADLINE_MS` |
| Live openserp (browser scrape) | 5–7 s | headless browser; cached after first hit |
| Vector KNN (RediSearch HNSW) | ms | default via hdsearch-redis; brute-force fallback if pointed at plain Redis |

## A.2 The cache is the performance & anti-blocking layer

- Per-source TTL (`cacheTtlSec` per provider) in Redis; **single-flight** collapses
  concurrent identical queries into one upstream call.
- Free-provider results are cached **shared** across users; keyed-provider results
  are cached **per user**.
- openserp adds its own response cache (`--cache_ttl`) on top.
- **Tuning:** raise per-provider `cacheTtlSec` for stable corpora; lower for news.

## A.3 Avoiding tail latency

- Every upstream call has a **timeout + bounded retries** (`HDSEARCH_PROVIDER_
  TIMEOUT_MS`, `_RETRIES`).
- **Aggregate soft deadline** returns whatever's ready instead of blocking on the
  slowest engine.
- **Provider ordering** (`priorities.csv`): fast/reliable engines first (searxng
  before openserp) so the default path is quick.
- Web UI defaults to **fallback** mode (fast); `?mode=aggregate` is opt-in.

## A.4 Knobs

| Var | Default | Effect |
|---|---|---|
| `HDSEARCH_PROVIDER_TIMEOUT_MS` | 10000 | per upstream call |
| `HDSEARCH_PROVIDER_RETRIES` | 1 | retries per call |
| `HDSEARCH_AGGREGATE_FANOUT` | 5 | engines per aggregate query |
| `HDSEARCH_AGGREGATE_DEADLINE_MS` | 6000 | aggregate tail cap |
| `HDSEARCH_DEFAULT_CACHE_TTL` | 3600 | fallback cache TTL |
| `HDSEARCH_VECTOR_TTL` | 86400 | vector TTL (24h) |

---

# Part B — Scale

## B.1 Stateless API → horizontal scale

The API holds no per-instance state (cache/rate-limit/keys/sessions live in Redis
& Postgres), so run N replicas behind the proxy. The web app is likewise stateless
(signed-cookie sessions).

## B.2 Datastore scaling

- **Redis:** the hot path runs on the project's **own `hdsearch-redis`** (redis-stack
  with RediSearch, :6390) — separate from the shared `hd-redis` (:6379), which is never
  touched. Keys are `hds:`-prefixed on db 0. Vectors use RediSearch **HNSW ANN** here;
  scale the instance (or cluster) for large vector/cache volumes.
- **TimescaleDB:** history/metrics are **hypertables**; add retention &
  continuous-aggregate policies for long-term metrics. Reads use the
  `hdsearchreadonly` role for BI without touching the write path.
- **SeaweedFS (S3):** crawl archives scale independently; lifecycle-expire old
  blobs.

## B.3 Provider throughput & cost

- Free/self-hosted first + caching keeps commercial spend low.
- openserp is a headless browser — scale it horizontally (multiple replicas) and/or
  put it behind proxies if you rely on it heavily.
- Usage is unlimited (no quotas); per-key sliding-window **rate limits** cap burst
  and protect upstreams.

## B.4 Concurrency controls

- Per-key sliding-window rate limit (Redis INCR/EXPIRE), fail-open if Redis is down.
- Single-flight prevents thundering-herd on cold cache keys.
- Connection pools: pg `max:10` per instance (tune to DB capacity); ioredis with
  retry/backoff.

## B.5 Capacity planning sketch

- Throughput ≈ (cache hit ratio × cache RPS) + (miss ratio × min(provider RPS,
  fanout concurrency)). Maximize cache hit ratio (TTL tuning) before adding
  provider capacity.

---

# Part C — Security

## C.1 Secrets at rest

- **Provider credentials:** AES-256-GCM (`src/crypto.ts`), wire format
  `v1:iv:tag:ciphertext`. Provider API keys (OpenAI, Brave, SerpAPI, …) are entered in
  the **UI** (Account → Provider Keys, or Dashboard → System Admin for system-wide),
  stored encrypted in the DB — **never in env**. Plaintext never touches Postgres
  (verified: stored as `v1:…`).
- **Secret provisioning:** the app **auto-generates** its crypto secrets (encryption
  key + internal BFF secret) into a shared **`hds-secrets` Docker volume** on first
  boot — **no secrets in env**, zero-config. The generated file is reused across
  restarts (never regenerated), so encrypted data stays readable; **back up the
  volume** — losing the encryption key makes stored provider keys unrecoverable.
- **API keys:** only the **sha256** hash is stored; the `sk-hds-…` secret is shown
  once at creation. Per-key scopes + rate limit; revocation invalidates the cache.

## C.2 Least-privilege database

- App runtime connects as **`hdsearchrw`**: row DML only, **no DDL** (cannot
  create/alter/drop objects — verified denied). Migrations use **`hdsearchadmin`**.
  BI uses **`hdsearchreadonly`** (SELECT only). The bootstrap superuser is never
  used by the running app.

## C.3 AuthN/Z

- API: bearer `sk-hds-…` (hashed, short-TTL verify cache) or first-party
  `X-HD-Internal`+`X-HD-User` from the web BFF only. Scope checks per route.
- Web: **local email + password** stored in the app's own DB (no Auth0/SSO).
  Passwords hashed with **scrypt**; roles (`admin`/`user`) from the DB `role` column.
  Session is an **AES-256-GCM encrypted, httpOnly cookie** (SameSite=Lax, Secure when
  `APP_BASE_URL` is https). First-run admin onboarding (or headless via
  `HDSEARCH_ADMIN_EMAIL`/`HDSEARCH_ADMIN_PASSWORD`). The browser never holds an API key.

## C.4 Input & output safety

- All request bodies validated with **zod**. URLs validated before crawl.
- Structured JSON logging; **stacks never leaked** to clients (global onError).
- No secrets in URLs/query strings; CORS allowlist via `HDSEARCH_CORS_ORIGINS`.
- Security headers on the web app (`X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`).

## C.5 Tenancy isolation

- Vector namespaces are prefixed per user (`<userId>:<ns>`) — no cross-tenant KNN.
- Keyed-provider cache entries are scoped per user; free-provider entries are shared
  (no user data in them).

## C.6 Resilience as security

- Every dependency can fail without crashing the service (degrade, don't break);
  rate limit fails open but the cache shields upstreams; Redis/DB outages logged and
  auto-recover.

## C.7 Darkweb handling

- Ahmia runs over **clearnet** (no Tor node needed) and filters abuse content.
- Onion-only engines require an explicit Tor proxy (`HDSEARCH_TOR_PROXY`) — opt-in,
  documented in [DARKWEB_SEARCH.md](DARKWEB_SEARCH.md). Results are data, surfaced
  with the onion URL; HD-Search does not fetch onion content by default.

## C.8 Production hardening checklist

- [ ] `RUN_MODE=prod` (provider keys entered in the UI, stored encrypted in the DB).
- [ ] Rotate dev-default DB passwords; **back up the `hds-secrets` volume**
      (losing the auto-generated encryption key makes stored provider keys
      unrecoverable).
- [ ] Set a strong first admin password (onboarding screen or
      `HDSEARCH_ADMIN_EMAIL`/`HDSEARCH_ADMIN_PASSWORD`).
- [ ] TLS everywhere; `APP_BASE_URL` https so session cookies are `Secure`.
- [ ] Restrict `HDSEARCH_CORS_ORIGINS` to your domains.
- [ ] Network-isolate Redis/Postgres/S3 to the private Docker network; don't publish
      them publicly (only web :3000 and API :8791 are exposed).
- [ ] Set Timescale retention + S3 lifecycle policies.
- [ ] Monitor `/healthz`, provider error rates, cache hit ratio.

---

# Part D — Resiliency

HD-Search is built to **degrade, not fail**. Every dependency can be down and the
service still answers what it can.

## D.1 Dependency isolation (degrade-don't-break)

| Dependency down | Behavior |
|---|---|
| **hdsearch-redis** | `redisHealthy()` trips → cache + rate-limit skipped (fail-open); search still runs live against providers; vectors return 503. Auto-recovers on the next successful command. |
| **Postgres (hd-db)** | history/metrics writes are best-effort (`tryQuery` → no-op); API-key verify uses the Redis hot-cache; search/crawl unaffected. |
| **SeaweedFS (S3)** | only crawl *archival* (`store:true`) is skipped; crawl results still returned. |
| **A search/crawl provider** | bounded timeout + retries, then the engine falls through to the next provider (fallback) or drops it from the merge (aggregate soft deadline). |
| **Embedder** | vector endpoints return a clear 503; everything else works. |
| **Tor proxy** | onion darkweb providers return empty; clearnet providers unaffected. |

## D.2 Per-call robustness

- **Timeouts** on every upstream (`AbortController`), so a hung provider can't hang a request.
- **Bounded retries with exponential backoff + jitter**, and **`Retry-After`** is honored on 429/503.
- **Typed `ProviderError`** marks failures retryable/non-retryable so the engine
  decides correctly between retrying and falling through.
- **Circuit-style fail-fast:** `redisHealthy()` / `dbAvailable()` flags avoid
  hammering a known-down socket; they reset on the next success.

## D.3 Collapse + cache as resiliency

- **Single-flight** collapses concurrent identical queries into one upstream call
  (thundering-herd protection on cold keys).
- The **per-source TTL cache** shields upstreams during traffic spikes and provider
  flakiness — the main defense against getting rate-limited/blocked.
- **Aggregate soft deadline** guarantees a response even if some engines never
  answer.

## D.4 Process + startup resiliency

- Startup probes are **best-effort**: the API boots and serves health even if
  Postgres/Redis aren't ready yet, and recovers when they come up.
- **Graceful shutdown** drains in-flight requests and closes Redis/PG pools on
  SIGTERM/SIGINT.
- `unhandledRejection` / `uncaughtException` are logged (never crash silently); the
  global error handler returns a clean 500 without leaking stacks.
- Docker images are **non-root** with **HEALTHCHECK**s so the orchestrator can
  restart unhealthy containers.

## D.5 Failure-mode test results (observed)

- GDELT sustained 429 → engine fell through; **news still served by searxng**.
- Ahmia clearnet block → **Tor onion fallback**; Torch onion via Tor.
- Provider exception (videos `length` parse) → isolated to that provider, others
  unaffected; now fixed.
- Redis/Postgres pointed at dead ports at boot → API still listened and answered
  `/health` (degraded), recovered when they returned.
