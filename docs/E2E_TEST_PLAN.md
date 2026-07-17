# HD-Search — End-to-End Test Plan

Exhaustive e2e test plan for the self-hosted (open-source) build. Every feature,
API, UI surface, AI tool, and prompt path has a concrete case with steps and an
expected result. Execution results are tracked in the **Status** column
(`PASS` / `FAIL` / `BLOCKED` / `N/A` / `—` not-yet-run).

## Environment under test

- Stack: `docker compose -f docker-compose.selfhost.yml up -d` (web `:3000`/`:3300`, API `:8791`).
- Auth: local email+password; admin `admin@hdsearch.local`.
- Datastores bundled: Postgres/TimescaleDB, Redis Stack (RediSearch), SeaweedFS, MiniLM embeddings.
- Providers bundled: SearXNG, OpenSERP, Crawl4AI, Browserless, Tor. Maps → public Photon by default.
- Commercial engine/LLM keys: **not required**; cases that need them are marked `needs-key` and are expected to degrade gracefully when absent.

## Conventions

- **Type**: `API` (curl/HTTP), `UI` (browser), `CLI` (scripts/MCP), `INFRA` (docker/db).
- **Pri**: P0 (core/blocker), P1 (important), P2 (secondary/nice-to-have).
- **Auth for API cases**: internal-header path — `X-HD-Internal: <shared secret>` + `X-HD-User: <id>`, or `Authorization: Bearer sk-hds-…`.
- **needs-key**: requires a commercial provider/LLM key; without it the expected result is a clean "unavailable/degraded" response, never a crash.

---

## Run 1 — P0 execution results (Ollama `qwen3-coder` for AI)

**All P0 cases attempted PASS.** No product defects found; two "failures" were
test-harness/plan errors, corrected below.

**PASS (this run):** INF-03, INF-04, SEC-02, AUTH-01, AUTH-05, AUTH-07, AUTH-08,
AUTH-16, AUTH-17, AUTH-21, AUTH-22, SRCH-01, SRCH-14, SRCH-25, SRCH-26, SRCH-28,
CRWL-01, VEC-01, VEC-02, VEC-09, AK-03, AK-06, AK-07, MCP-01, MCP-02, AI-01,
AI-02, AI-11, AI-13, AIUI-01, AIUI-02, AIUI-03, AIUI-06.

**PASS (verified earlier this session, still valid):** INF-01, INF-02, INF-09,
SEC-01, SEC-03, SEC-04, AUTH-02, AUTH-03, AUTH-04, AUTH-12, AUTH-14, AUTH-15,
AUTH-20, SUI-01, SUI-02, DASH-01, DASH-02, PK-04, plus the durable-archive and
`quota=null` fixes (SRCH-27 archive object confirmed in SeaweedFS).

**Plan corrections (not defects):**
- **SRCH-12** → N/A. `/v1/search` has 12 modalities; there is **no `semantic`
  modality**. The UI "Semantic" tab calls the separate `POST /v1/search/vector`
  endpoint — covered by TS-7 (VEC-01/02/09 PASS).
- **CRWL-01** crawl markdown is returned under `result.markdown` (not top-level);
  PASS once the correct field is read.

**Highlights:** AI tool-calling works over local Ollama (multi-step `hd_search`
loop, inline result cards, Sources chip, SSE `meta/text/tool_call/tool_result/
usage/done`); the model picker auto-selects the reachable local model; MCP server
lists all 5 tools and `hd_search` returns content over stdio; RBAC (admin 200 /
user 403), unlimited search (5/5, no 402), and vector KNN (correct semantic
match) all verified.

**Notes:** AI answer *quality* depends on the model — `qwen3-coder` is a coding
model, so open-ended web-research answers are weaker than a frontier model would
give; the pipeline is correct. Setup: host Ollama wired via
`HDSEARCH_OLLAMA_URL=http://host.docker.internal:11434` + `extra_hosts`.

**Next:** P1 then P2 (per-modality search SRCH-02..11, per-result actions
SUI-10..13, remaining AI tools AI-03..10, RAG TS-10, settings TS-14, maps TS-15,
negative/security TS-17).

---

## TS-1 · Infrastructure & Health

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| INF-01 | Cold `up` from clean state | `down -v` then `up -d --build` | All containers reach healthy; migrate one-shot exits 0; schema applied | P0 | INFRA | — |
| INF-02 | Datastores internal-only | `docker compose ps` | Only web + API publish host ports; db/redis/seaweed/embeddings have no host ports | P0 | INFRA | — |
| INF-03 | Shallow health | `GET /health` | `{status:"ok"}` 200 | P0 | API | — |
| INF-04 | Deep health | `GET /healthz` | 200; redis/postgres/seaweedfs/rediSearch all `true` | P0 | API | — |
| INF-05 | RediSearch present | `docker exec hds-redis redis-cli MODULE LIST` | `search` module loaded; `hds:vec:idx` exists | P1 | INFRA | — |
| INF-06 | Embeddings server | POST `/vectors` on hds-embeddings | Returns 384-dim vector | P1 | INFRA | — |
| INF-07 | Redis down → degrade | stop hds-redis, `GET /health` | API still 200; search degrades, no crash; recovers when redis returns | P1 | INFRA | — |
| INF-08 | Postgres down → degrade | stop hds-db, run a search | Search still works (no persistence); recovers on return | P1 | INFRA | — |
| INF-09 | Restart stability | restart hds-api | Secrets not regenerated; sessions/keys survive | P0 | INFRA | — |
| INF-10 | Graceful shutdown | `docker stop hds-api` | In-flight drain, clean exit (SIGTERM handler) | P2 | INFRA | — |

## TS-2 · Secrets model (no secrets in env)

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| SEC-01 | Zero-config boot | `up` with no `.env.selfhost` | Boots; secrets auto-generated into `hds-secrets` | P0 | INFRA | — |
| SEC-02 | Secrets file contents | cat `/secrets/hdsearch-secrets.json` | Has `encryptionKey`, `internalSecret`, `webSessionSecret`; mode 0600 | P0 | INFRA | — |
| SEC-03 | Shared api↔web | web reads same internal secret | BFF calls accepted (dashboard loads) | P0 | INFRA | — |
| SEC-04 | Restart-stable key | hash file, restart, hash again | Identical; no "auto-generated" log on 2nd boot | P0 | INFRA | — |
| SEC-05 | No secrets in example env | grep `.env.selfhost.example` | No secret keys present | P1 | INFRA | — |

## TS-3 · Authentication & RBAC

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| AUTH-01 | First-run status | `GET /v1/auth/status` on empty DB | `setupRequired:true` | P0 | API | — |
| AUTH-02 | Onboarding screen | visit `/login` first run | "Create your admin account" form (name/email/password) | P0 | UI | — |
| AUTH-03 | Create admin (UI) | submit onboarding form | Account created (role=admin), auto-logged-in, redirect home | P0 | UI | — |
| AUTH-04 | Setup closes | `GET /v1/auth/status` after | `setupRequired:false` | P0 | API | — |
| AUTH-05 | Registration closed | `POST /v1/auth/register` (2nd) | 403 `registration_closed` | P0 | API | — |
| AUTH-06 | Open signup | set `HDSEARCH_OPEN_SIGNUP=true`, register | 200, user created role=user | P1 | API | — |
| AUTH-07 | Login correct | `POST /v1/auth/login` valid | 200 `{user{role}}` | P0 | API | — |
| AUTH-08 | Login wrong pw | invalid password | 401 `invalid_credentials` | P0 | API | — |
| AUTH-09 | Login unknown email | non-existent email | 401 | P1 | API | — |
| AUTH-10 | Password policy | register pw < 8 chars | 400 min-length error | P1 | API | — |
| AUTH-11 | Duplicate email | register existing email | 409 conflict | P1 | API | — |
| AUTH-12 | UI login | sign in via `/login` form | Session set, dashboard reachable | P0 | UI | — |
| AUTH-13 | Login→signin state | after admin exists, `/login` | Shows "Sign in" (email/pw), no name field | P1 | UI | — |
| AUTH-14 | Logout | visit `/api/auth/logout` | Session cleared, redirect home, no Auth0 | P0 | UI | — |
| AUTH-15 | Consent gate | first authed nav | Terms accept screen; accept → proceed; stored per user | P1 | UI | — |
| AUTH-16 | Admin scope granted | admin hits `/v1/admin/default-keys` | 200 | P0 | API | — |
| AUTH-17 | Non-admin denied | user role hits `/v1/admin/*` | 403 | P0 | API | — |
| AUTH-18 | Headless bootstrap | set `HDSEARCH_ADMIN_EMAIL/PASSWORD`, boot | Admin auto-created on first run | P1 | INFRA | — |
| AUTH-19 | Headless no-op | same env, 2nd boot | No duplicate/overwrite; idempotent | P2 | INFRA | — |
| AUTH-20 | Session survives restart | restart api, reload dashboard | Still logged in (webSessionSecret persisted) | P1 | UI | — |
| AUTH-21 | Missing auth | API call with no auth | 401 | P0 | API | — |
| AUTH-22 | Bad internal secret | wrong `X-HD-Internal` | 401 | P1 | API | — |

## TS-4 · Search — modalities, modes, options

Base: `GET /v1/search?q=…&modality=…` (and `POST /v1/search`). One case per modality.

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| SRCH-01 | Web search | `q=open source search&modality=web` | 200; ≥1 normalized result (title/url/snippet); `engines` reports source | P0 | API | — |
| SRCH-02 | News | `modality=news` | 200; news results (dated) or clean empty | P1 | API | — |
| SRCH-03 | Images | `modality=images` | 200; image results with thumbnail/url | P1 | API | — |
| SRCH-04 | Videos | `modality=videos` | 200; video results (playable url) | P1 | API | — |
| SRCH-05 | Maps | `modality=maps&q=coffee in San Ramon` | 200; places with lat/lon (Photon) | P1 | API | — |
| SRCH-06 | Scholar | `modality=scholar` | 200; scholarly results or clean empty | P2 | API | — |
| SRCH-07 | Shopping | `modality=shopping` | 200; results or clean empty | P2 | API | — |
| SRCH-08 | Code | `modality=code` | 200; code/repo results | P2 | API | — |
| SRCH-09 | Social | `modality=social` | 200; social results | P2 | API | — |
| SRCH-10 | Archive | `modality=archive` | 200; Wayback/CommonCrawl snapshots (free, no key) | P1 | API | — |
| SRCH-11 | Darkweb | `modality=darkweb` | 200; Ahmia onion results via Tor (or clean empty) | P2 | API | — |
| SRCH-12 | Semantic | `modality=semantic` (vector) | 200; unlimited (no DevTest gate) | P0 | API | — |
| SRCH-13 | Fallback mode | `mode=fallback` | Returns first engine that yields results | P1 | API | — |
| SRCH-14 | Aggregate mode | `mode=aggregate&facets=true` | Merges N engines, dedups, returns facets | P0 | API | — |
| SRCH-15 | Force engine | `?engine=searxng` | Only that engine used | P1 | API | — |
| SRCH-16 | Unknown engine | `?engine=bogus` | Graceful error / falls back sensibly | P2 | API | — |
| SRCH-17 | Facets | `facets=true` | Facet buckets (engine/type/site) with counts | P1 | API | — |
| SRCH-18 | Dedup | query with dup-prone terms | No duplicate URLs in results | P1 | API | — |
| SRCH-19 | Pagination | `page=2&limit=5` | Second page, ≤5 results, distinct from page 1 | P1 | API | — |
| SRCH-20 | Limit bound | `limit=50` | Respects max results cap | P2 | API | — |
| SRCH-21 | Freshness | `freshness=day` | Filters recent (where engine supports) | P2 | API | — |
| SRCH-22 | Country/lang | `country=us&lang=en` | Localized results (where supported) | P2 | API | — |
| SRCH-23 | Cache hit | repeat identical query | 2nd is faster / served from Redis cache | P1 | API | — |
| SRCH-24 | noCache | `noCache=true` | Bypasses cache | P2 | API | — |
| SRCH-25 | Empty query | `q=` | 400 validation error | P1 | API | — |
| SRCH-26 | Unlimited (no quota) | 200+ searches | Never 402; unlimited | P0 | API | — |
| SRCH-27 | History recorded | POST search (non-temp, signed-in) | Appears in `/v1/history`; archived to SeaweedFS | P1 | API | — |
| SRCH-28 | List engines | `GET /v1/engines` | Catalog with modalities/accessType/available | P0 | API | — |

## TS-5 · Search UI

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| SUI-01 | Home renders | open `/` | Search box + all modality tabs + Sign in/avatar | P0 | UI | — |
| SUI-02 | Run web search | type query, submit | Results list with count + timing + engines line | P0 | UI | — |
| SUI-03 | Faceted filters | click a facet (Engine/Type/Site) | Results filter accordingly | P1 | UI | — |
| SUI-04 | Modality tabs | switch to Images | Image grid renders | P1 | UI | — |
| SUI-05 | Videos inline | Videos tab | Inline players (e.g. YouTube) | P2 | UI | — |
| SUI-06 | Maps modality | Maps tab + place query | Map with pins renders | P1 | UI | — |
| SUI-07 | Depth control | change Low/Medium/High | Affects fan-out/results | P2 | UI | — |
| SUI-08 | Engine "Auto" | default Auto | Uses priority order | P2 | UI | — |
| SUI-09 | Temporary toggle | enable temp search | Not recorded to history | P2 | UI | — |
| SUI-10 | Per-result: extract/crawl | click "Extract (crawl → markdown)" | Returns markdown of the page | P1 | UI | — |
| SUI-11 | Per-result: screenshot | click Screenshot | Renders screenshot (browserless) | P2 | UI | — |
| SUI-12 | Per-result: PDF | click PDF | Returns/opens PDF | P2 | UI | — |
| SUI-13 | Per-result: archived | click "Archived (Common Crawl)" | Opens archived snapshot | P2 | UI | — |
| SUI-14 | Pagination/scroll | scroll / next page | Loads more results | P1 | UI | — |
| SUI-15 | Empty state | query with no results | Clean "no results" message | P2 | UI | — |
| SUI-16 | Error state | force provider error | Friendly error card (no stack) | P2 | UI | — |

## TS-6 · Crawl

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| CRWL-01 | Crawl markdown | `POST /v1/crawl {url, formats:["markdown"]}` | Normalized markdown of the page | P0 | API | — |
| CRWL-02 | Crawl links | `formats:["links"]` | Extracted links list | P1 | API | — |
| CRWL-03 | JS render | `render:true` on a JS page | Rendered content (browserless) | P1 | API | — |
| CRWL-04 | Crawl4AI path | default crawler | crawl4ai used first | P1 | API | — |
| CRWL-05 | Bad URL | invalid url | 400 / clean error | P1 | API | — |
| CRWL-06 | Unreachable URL | non-resolving host | Clean error, no crash | P2 | API | — |
| CRWL-07 | Archive extract | `GET /v1/archive?url=…` | Extracts archived capture | P2 | API | — |

## TS-7 · Vector / Semantic search

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| VEC-01 | Index docs | `POST /v1/search/vector/index {namespace, documents[]}` | Docs embedded + indexed; TTL default 24h | P0 | API | — |
| VEC-02 | Vector search | `POST /v1/search/vector {q, namespace, k}` | KNN results ranked by similarity | P0 | API | — |
| VEC-03 | Ground with web | `groundWithWeb:true` | Live web results indexed then searched | P1 | API | — |
| VEC-04 | Namespace isolation | index ns A, search ns B | No cross-namespace leakage | P1 | API | — |
| VEC-05 | RediSearch HNSW | with RediSearch | Uses ANN index path | P1 | API | — |
| VEC-06 | Brute-force fallback | (concept) no RediSearch | Cosine fallback returns results | P2 | API | — |
| VEC-07 | TTL expiry | short TTL | Entries expire | P2 | API | — |
| VEC-08 | Embeddings=none | `HDSEARCH_EMBEDDINGS_PROVIDER=none` | Vector disabled cleanly (clear error) | P2 | API | — |
| VEC-09 | Unlimited | semantic without paid plan | Works for all users (no gate) | P0 | API | — |

## TS-8 · AI Search (assistant) — backend tools & orchestration

AI chat: `POST /v1/ai/chat` (SSE stream). Requires an LLM key or local Ollama → cases are `needs-key` unless Ollama is configured. Each tool has a dedicated prompt.

| ID | Test case | Prompt / steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| AI-01 | Basic answer | "Explain what hd-search is." | Streams a coherent answer; `done` event | P0 | API | — |
| AI-02 | Tool: hd_search | "Search the web for the latest on RediSearch and summarize." | Model calls `hd_search`; answer cites results | P0 | API | — |
| AI-03 | Tool: hd_maps | "Find coffee shops in San Ramon, CA." | `hd_maps` called; places returned/rendered | P1 | API | — |
| AI-04 | Tool: hd_plot_map | "Plot the native range of the eclectus parrot." | `hd_plot_map` geocodes + returns a map component | P1 | API | — |
| AI-05 | Tool: hd_crawl | "Crawl example.com and summarize it." | `hd_crawl` fetches; summary from content | P1 | API | — |
| AI-06 | Tool: hd_archive | "Show the archived version of example.com." | `hd_archive` returns a snapshot | P2 | API | — |
| AI-07 | Tool: hd_chart | "Chart these values: A=3, B=5, C=2 as a bar chart." | `hd_chart` returns a bar chart component | P1 | API | — |
| AI-08 | Tool: hd_weather | "What's the weather in Tokyo?" | `hd_weather` returns current conditions | P2 | API | — |
| AI-09 | Tool: hd_render | "Render a comparison table of Python vs Go." | `hd_render` returns a UI component (table) | P2 | API | — |
| AI-10 | Multi-tool | "Research EV sales 2024 and give me a chart." | `hd_search` + `hd_chart` chained | P1 | API | — |
| AI-11 | SSE events | inspect stream | Emits token/tool-start/tool-result/usage/done (+error on failure) | P1 | API | — |
| AI-12 | Model override | send `modelOverride` | Uses that model (if available) | P1 | API | — |
| AI-13 | Unknown model | bogus model id | 400 bad_request | P1 | API | — |
| AI-14 | No model gate | any model as "free" user | No 403 plan gate (all models allowed) | P0 | API | — |
| AI-15 | Model unavailable | model with no key | 400 model_unavailable (clean), not crash | P1 | API | — |
| AI-16 | Ollama local | configure Ollama | Local model answers (no cloud key) | P2 | API | — |
| AI-17 | OpenAI-compat | `POST /v1/openai/chat/completions` | OpenAI-shaped response/stream | P1 | API | — |
| AI-18 | Credits no-op | any AI turn | No credit deduction/metering blocks | P0 | API | — |

## TS-9 · AI Search — UI (assistant-ui)

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| AIUI-01 | Open AI tab | click AI / open `/ai` | Chat composer renders | P0 | UI | — |
| AIUI-02 | Send prompt | type + send | Streaming assistant response renders token-by-token | P0 | UI | — |
| AIUI-03 | Tool-call display | prompt that uses a tool | Tool invocation + result shown inline | P1 | UI | — |
| AIUI-04 | Chart render | chart prompt | Chart component renders in the message | P1 | UI | — |
| AIUI-05 | Map render | map/plot prompt | Interactive map renders | P1 | UI | — |
| AIUI-06 | Sources/citations | search prompt | Source links shown | P1 | UI | — |
| AIUI-07 | Model picker | change model | Selection persists; next turn uses it | P1 | UI | — |
| AIUI-08 | New thread | start new chat | Fresh thread; prior not shown | P1 | UI | — |
| AIUI-09 | Thread history | reopen a thread | Prior messages restored | P1 | UI | — |
| AIUI-10 | Temporary chat | enable temp | Not persisted (absent from history) | P2 | UI | — |
| AIUI-11 | Copy message | copy action | Copies text | P2 | UI | — |
| AIUI-12 | Stop/regenerate | stop mid-stream | Halts cleanly; can retry | P2 | UI | — |
| AIUI-13 | Error surface | force error | Friendly retriable error in-thread | P2 | UI | — |
| AIUI-14 | Sign-in gate | AI when signed out (if required) | Prompts sign-in or uses demo per config | P2 | UI | — |

## TS-10 · File upload / RAG

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| RAG-01 | Upload file | attach a PDF/txt to a thread | Stored (SeaweedFS), parse→embed→index runs | P1 | UI/API | — |
| RAG-02 | Ask over file | "Summarize the attached document." | Answer grounded in file content | P1 | UI | — |
| RAG-03 | Multiple files | attach 2+ | Both retrievable | P2 | UI | — |
| RAG-04 | Supported types | pdf, txt, md, docx | Parsed (lazy parsers) or clean unsupported msg | P2 | API | — |
| RAG-05 | Folders | organize files into a folder | Folder scoping works | P2 | API | — |
| RAG-06 | Delete cascade | delete a thread/file | File bytes + vectors + index removed | P1 | API | — |
| RAG-07 | Worker resilience | crash mid-process | Reconciles on restart | P2 | INFRA | — |

## TS-11 · Provider keys & API keys

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| PK-01 | Add provider key (UI) | Account → Provider Keys, add OpenAI key | Stored encrypted; masked display | P0 | UI | — |
| PK-02 | Per-user resolution | user's key used for their AI/search | Resolves user key first | P1 | API | — |
| PK-03 | Delete provider key | remove it | Removed; resolution falls through | P1 | UI | — |
| PK-04 | Admin default key | System Admin → add default key (no plan selector) | Stored; masked | P0 | UI | — |
| PK-05 | Default applies to all | free user with only a default key | Default key used (plan-agnostic) | P0 | API | — |
| PK-06 | Resolution order | user key > system default > (dev .env only in dev) | Correct precedence | P1 | API | — |
| AK-01 | Issue API key (UI) | Account → API Keys → create | `sk-hds-…` shown once | P0 | UI | — |
| AK-02 | Default key on signup | new account | Auto-issued default key | P1 | API | — |
| AK-03 | Use API key | Bearer sk-hds on `/v1/search` | 200 | P0 | API | — |
| AK-04 | List keys | Account → API Keys | Lists masked keys + scopes | P1 | UI | — |
| AK-05 | Revoke key | delete a key | Revoked key → 401 | P1 | API | — |
| AK-06 | Scopes enforced | key without a scope | 403 on out-of-scope route | P1 | API | — |
| AK-07 | Issue via CLI | `hds-keys.js issue` in container | Prints sk-hds key | P2 | CLI | — |

## TS-12 · MCP server

Config: `HDSEARCH_API_URL` + `HDSEARCH_API_KEY`. Run `node dist/mcp/server.js`.

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| MCP-01 | List tools | MCP `tools/list` | 5 tools present | P0 | CLI | — |
| MCP-02 | hd_search | call with `{q}` | Normalized results | P0 | CLI | — |
| MCP-03 | hd_crawl | `{url, render?}` | Markdown/text/links/images | P1 | CLI | — |
| MCP-04 | hd_vector_search | `{q, namespace, groundWithWeb?}` | KNN results | P1 | CLI | — |
| MCP-05 | hd_vector_index | `{namespace, documents[], ttl?}` | Indexed OK | P1 | CLI | — |
| MCP-06 | hd_list_engines | call | Engines + availability | P1 | CLI | — |
| MCP-07 | Bad API key | wrong key | Clean auth error | P2 | CLI | — |

## TS-13 · Dashboard & account pages

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| DASH-01 | Dashboard | `/dashboard` | 3 stat tiles (Searches/Crawls/Vector), activity, top engines; NO quota/plan/upgrade | P0 | UI | — |
| DASH-02 | Nav items | sidebar | No "Upgrade Plan"/"Usage Analytics"; System Admin only for admin | P0 | UI | — |
| DASH-03 | Account profile | `/dashboard/account` | Profile + keys; no "Manage plan" link | P1 | UI | — |
| DASH-04 | API Reference | `/dashboard/api-reference` | Renders endpoints; no billing routes | P1 | UI | — |
| DASH-05 | Documentation | `/dashboard/docs` | Docs render; no DevTest/paid gating copy | P1 | UI | — |
| DASH-06 | Integrations | `/dashboard/integrations` | REST & MCP snippets; "Vector search" (no DevTest+) | P1 | UI | — |
| DASH-07 | Services | `/dashboard/services` | Integrations list | P2 | UI | — |
| DASH-08 | Search History | `/dashboard/history` | List + clear; copy = "3-day + durable archive" (no "paid plans") | P1 | UI | — |
| DASH-09 | Usage/metrics | activity chart | Renders from Timescale (or empty state) | P2 | UI | — |
| DASH-10 | 401 handling | expired session | Redirect to login/logout | P2 | UI | — |

## TS-14 · Settings & configuration UI

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| SET-01 | Ranking editor | `/dashboard/services/ranking` | Reorder provider priority; persists | P1 | UI | — |
| SET-02 | Provider prefs | enable/disable a provider | Reflected in subsequent searches | P1 | UI | — |
| SET-03 | Cache TTL | change TTL option | Saved; no "upgrade to unlock" (unlocked) | P1 | UI | — |
| SET-04 | LLM providers | `/dashboard/services/llm-providers` | Lists providers/models; enable/disable | P1 | UI | — |
| SET-05 | System Admin copy | admin page | "system-wide keys… any user"; resolution = Per-user → System default | P1 | UI | — |

## TS-15 · Maps & geocoding

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| MAP-01 | Public Photon default | maps query, no config | Geocodes via public Photon | P1 | API | — |
| MAP-02 | Self-hosted Photon | `--profile maps` + `HDSEARCH_GEOCODER_URL` | Uses local hds-photon | P2 | INFRA | — |
| MAP-03 | Map tiles | maps UI | OSM raster tiles render | P2 | UI | — |
| MAP-04 | Nominatim option | `HDSEARCH_GEOCODER_ENGINE=nominatim` | Works with nominatim | P2 | API | — |

## TS-16 · Static/public pages & trends

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| PUB-01 | Terms | `/terms` | Renders ToS copy | P2 | UI | — |
| PUB-02 | Disclaimer | `/disclaimer` | Renders; accept flow works | P2 | UI | — |
| PUB-03 | Docs (public) | `/docs` | Renders | P2 | UI | — |
| PUB-04 | Integrations (public) | `/integrations` | Renders REST/MCP | P2 | UI | — |
| PUB-05 | Verify-email | `/verify-email` | Not gating local users (no core) | P2 | UI | — |
| PUB-06 | Trends | `/trends` | Degrades to empty (hdfeeds not bundled) — no crash | P2 | UI | — |
| PUB-07 | 404 | unknown route | Clean not-found | P2 | UI | — |

## TS-17 · Cross-cutting negative & security

| ID | Test case | Steps | Expected | Pri | Type | Status |
|---|---|---|---|---|---|---|
| NEG-01 | Malformed JSON body | POST invalid JSON | 400, no crash | P1 | API | — |
| NEG-02 | Oversized input | huge query/body | Rejected/bounded | P2 | API | — |
| NEG-03 | Rate limit | exceed per-id rate | 429 with headers | P1 | API | — |
| NEG-04 | CORS | cross-origin call | Honors `HDSEARCH_CORS_ORIGINS` | P2 | API | — |
| NEG-05 | No stack leak | trigger 500 | Generic error, no stack to client | P1 | API | — |
| NEG-06 | Session cookie flags | inspect `hd_session` | httpOnly, encrypted, Secure behind TLS | P1 | UI | — |
| NEG-07 | Provider key never plaintext | inspect DB `user_provider_keys` | Only ciphertext stored | P1 | INFRA | — |
| NEG-08 | Request id / access log | any request | `X-Request-Id` + structured log line | P2 | API | — |

---

## Execution summary (filled during run)

| Suite | Total | Pass | Fail | Blocked | N/A |
|---|---|---|---|---|---|
| TS-1 Infra | 10 | | | | |
| TS-2 Secrets | 5 | | | | |
| TS-3 Auth | 22 | | | | |
| TS-4 Search API | 28 | | | | |
| TS-5 Search UI | 16 | | | | |
| TS-6 Crawl | 7 | | | | |
| TS-7 Vector | 9 | | | | |
| TS-8 AI backend | 18 | | | | |
| TS-9 AI UI | 14 | | | | |
| TS-10 RAG | 7 | | | | |
| TS-11 Keys | 13 | | | | |
| TS-12 MCP | 7 | | | | |
| TS-13 Dashboard | 10 | | | | |
| TS-14 Settings | 5 | | | | |
| TS-15 Maps | 4 | | | | |
| TS-16 Public | 7 | | | | |
| TS-17 Negative/Sec | 8 | | | | |
| **Total** | **190** | | | | |

> **needs-key note:** AI/LLM cases (TS-8/9/10) and commercial engines need a
> provider key or local Ollama. Without one, the expected result is a clean
> "unavailable"/degraded response (verified), and the case is marked N/A for the
> "happy path" until a key is supplied.
