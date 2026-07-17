# HD-Search — Search + MCP Apps ("Apps" tab) — PRD + Spec

**Status:** Draft — not implemented
**Owner:** Hackerdogs
**Last updated:** 2026-07
**Companion docs:** [PRD](PRD.md) · [AI Mode Spec](AI_MODE_SPEC.md) · [Technical Design](TECHNICAL_DESIGN.md) · [Config & Deploy](CONFIGURATION_DEPLOYMENT.md) · [AI Chat Persistence](aisearch-persistence.md)
**Related code today:**
- Modality tabs: `web/src/lib/search-modality-meta.ts`, `web/src/components/search-modality-nav.tsx`, `web/src/lib/search-routes.ts`
- MCP: `api/src/ai/mcp/{registry,client,config}.ts`, `api/src/ai/orchestrator.ts`, `api/src/ai/tools.ts`
- Search providers: `api/src/providers/**`, `api/src/engine.ts`, `api/src/normalize.ts`, `api/src/routes/search.ts`
- Credentials: `api/src/keystore.ts`, `api/src/crypto.ts` (AES-256-GCM), `api/src/secrets.ts`
- Integrations UI: `web/src/components/content/integrations-content.tsx`, `web/src/app/integrations/page.tsx`

> **Scope:** the **Search + MCP Apps** feature — connecting to third‑party apps (Google Drive, OneDrive, GitHub, Slack, Notion, etc.) for both federated **Search** and **MCP tools**. Personal file search (Google Drive / OneDrive) is the first slice.

---

## Part A — Product Requirements (PRD)

### A.1 Summary

Add a new top‑level tab in the search experience — **"Apps"** (icon: `apps`) — where a user can:

1. **Connect** third‑party applications (Google Drive, OneDrive, GitHub, Slack, Notion, …) via **OAuth** (preferred) or **API key/token**.
2. **Browse a catalog** of every app + MCP server HD‑Search can connect to, with per‑app status (Available / Connected / Coming soon), capabilities (Search, MCP tools), and required auth.
3. **Search across connected apps** — a federated query that returns normalized results (files, messages, pages, issues, tickets) from the user's own connected accounts, inline with the rest of HD‑Search.
4. **Use those apps as tools in AI Search** — every connected app that ships an MCP server (or that we expose as an MCP‑style toolset) becomes callable by the AI Mode orchestrator, alongside the built‑in `hd_search` / `hd_crawl` tools.

This unifies two capabilities behind one connection: **Search** (federated read of the user's content) and **MCP** (agentic tool use). Some apps offer both, some only one; the catalog makes that explicit.

We ship the first slice as **personal file search** — Google Drive and OneDrive — then expand to the prioritized **25‑app catalog** in §A.9 / §B.7.

### A.2 Problem & motivation

- HD‑Search today searches the **public web** and (for AI Mode) a **statically configured, env‑var‑only** set of MCP servers (`HDSEARCH_MCP_SERVERS`, see `api/src/ai/mcp/config.ts`). There is **no per‑user, self‑service way** to connect a personal/work account and search *their own* content.
- Users increasingly expect "search everything I have access to" — the enterprise/personal search pattern (Glean / unified search): documents in Drive, messages in Slack, pages in Notion, issues in Jira/GitHub, tickets in Zendesk. This content is fragmented across dozens of apps, each with its own schema, auth, and rate limits.
- MCP has become the standard agent‑tool interface. In 2026 most major SaaS vendors ship **hosted remote MCP servers with OAuth 2.1** (e.g. GitHub, Notion, Linear, Atlassian, Sentry, Stripe, Asana, Intercom, Box, Salesforce). We should let users connect these once and reuse them across **both** federated search and AI Mode — instead of hand‑editing an env var.

### A.3 Goals

| # | Goal |
|---|------|
| G1 | **New "Apps" tab** in the modality nav (icon `apps`) → connections catalog + connected‑apps search. |
| G2 | **Self‑service connect** per user: OAuth (preferred) or API‑key, credentials in the existing AES‑256‑GCM keystore. No env editing. |
| G3 | **Unified connector model** — each connector declares its `search` and/or `mcp` capability; one connection powers both. |
| G4 | **Federated search** across connected apps → normalized `results[]` in the existing result schema (title, url, snippet, source, metadata). |
| G5 | **Per‑user MCP registry** — connected apps' MCP tools flow into the AI orchestrator per user (supersedes env‑only `HDSEARCH_MCP_SERVERS` for user connectors; env config remains for global/admin servers). |
| G6 | **Catalog of 25 highest‑impact apps** (see §A.9) with a plugin architecture so a new connector is ~one file (mirrors the search‑provider plugin model). |
| G7 | **Security first** — least‑privilege scopes, read‑only default, tokens never in model context, per‑user isolation, revoke/disconnect, audit. |
| G8 | **Free & unlimited** — connected‑app search and MCP tool calls are unlimited and free, like the rest of HD‑Search; no metering or plan gating (usage recorded for telemetry only). |

### A.4 Non‑goals (this phase)

- Building a **persistent index / crawler** of user content (no background sync to our vector DB in v1). v1 is **live pass‑through** (query the app's own search API / MCP at request time). A later phase MAY add opt‑in indexing + embeddings for RAG (see §B.8).
- **Write actions** by default. Connectors are **read/search‑only** in v1; any write‑capable MCP tool is gated behind explicit per‑action confirmation (reuse the AI‑Mode tool‑confirmation pattern, AI_MODE_SPEC §11).
- A generic no‑code connector builder / unified‑API reseller (we implement native connectors + MCP; unified‑API vendors are noted as an alternative in §B.7.4, not a v1 dependency).
- Team/workspace‑shared connections (v1 is per‑user). Org‑shared connections are a later phase.

### A.5 Personas

| Persona | Need |
|---------|------|
| **Knowledge worker** | "Find that spec" across Drive, OneDrive, Notion, Slack without switching apps. |
| **Developer** | Search GitHub code/issues + Jira/Linear from one box; use them as AI tools. |
| **Support/ops** | Search Zendesk/Intercom tickets and Confluence runbooks; triage with AI. |
| **AI/agent builder** | Connect apps once; have their MCP tools available to AI Mode, unlimited and free. |
| **Privacy‑conscious user** | Read‑only scopes, clear consent, one‑click disconnect, no server‑side copy of content. |

### A.6 User‑facing requirements

1. **Apps tab** in the modality nav (after `ai`), icon `apps`, caption "Apps".
   - Empty state (no connections): the **catalog** — a searchable/filterable grid of app cards. Each card: logo, name, category chips, capability badges (**Search**, **MCP**), auth type (OAuth / API key), and a **Connect** button. Filter by category and by capability; search the catalog by name.
   - Connected state: a **connections manager** (list of connected apps with status, last used, scopes granted, **Disconnect**/**Reconnect**) **plus** a federated search box scoped to connected apps (with per‑app include/exclude toggles).
2. **Connect flow**
   - **OAuth apps:** click Connect → provider consent screen (least‑privilege, read‑only scopes) → callback stores encrypted tokens → card flips to "Connected". Show exactly which scopes are requested.
   - **API‑key apps:** click Connect → modal to paste token (masked input, reuse `secret-input.tsx`) with a link to where to generate it → validated (test call) → stored encrypted.
   - **Remote MCP apps:** Connect registers the vendor's hosted MCP endpoint (e.g. `https://mcp.notion.com/mcp`) under the user's account and runs its OAuth if required.
3. **Federated search (Apps modality)**
   - One query fans out to the user's connected apps that expose Search; results are normalized, deduplicated, and merged with source attribution (app logo + name), ranked by relevance/recency. Per‑app facet in the facet rail. Respect each app's permissions — results are always scoped to what the signed‑in user can access.
   - Per‑app failures degrade gracefully (skip + surface a subtle "X unavailable" chip), never fail the whole query — mirrors the MCP registry's "dead server → skip" behavior in `api/src/ai/mcp/registry.ts`.
4. **AI Mode integration**
   - Connected apps with an MCP capability appear in the AI Mode tools/MCP affordance; their tools are offered to the orchestrator (subject to the existing semantic tool‑selection, AI_MODE_SPEC §8).
5. **Manage & revoke**
   - Dashboard page (`/dashboard/apps` or under Integrations) lists connections, granted scopes, last used; supports Disconnect (revoke + delete tokens) and Reconnect (re‑auth / scope upgrade).
6. **No plan gating**
   - All connectors are available to every user, unlimited and free; per‑user rate limits protect upstreams and the instance. No tiers or entitlements.

### A.7 Success metrics

- **Connections/user** (activation), **connected‑app search share** of total queries, **AI runs using an app MCP tool**, connect→first‑search funnel, per‑connector reliability (success rate, p95 latency), disconnect/revoke rate.

### A.8 Requirements summary (MoSCoW)

- **Must:** Apps tab + catalog; OAuth + API‑key connect; encrypted per‑user tokens; Google Drive + OneDrive federated file search; per‑user MCP registry feeding AI Mode; disconnect/revoke; graceful per‑app degradation.
- **Should:** GitHub, Slack, Notion, Gmail, Confluence, Jira, Dropbox connectors; catalog filters; facets; scope‑upgrade reconnect.
- **Could:** remaining wave‑2/3 connectors (§A.9); saved cross‑app searches; per‑app result previews.
- **Won't (v1):** background indexing/RAG; write actions by default; org‑shared connections; unified‑API reseller dependency.

### A.9 The first 25 apps (highest impact) — prioritized catalog

Impact = breadth of user content that becomes searchable × demand × availability of a first‑party API/MCP. Each connector declares capability: **S** = native federated Search connector, **M** = MCP tools (usually vendor‑hosted remote MCP). Most Wave‑1 apps get **both**.

**Wave 1 — Personal & work files / messages / knowledge (launch set)**

| # | App | Capability | Auth | Why it's high‑impact |
|---|-----|-----------|------|----------------------|
| 1 | **Google Drive** | S (+M) | OAuth | Primary personal/work file store; first slice ("file processing"). |
| 2 | **OneDrive / SharePoint** | S (+M) | OAuth | Microsoft 365 file store; enterprise default. |
| 3 | **Gmail** | S (+M) | OAuth | Email is a top personal search target. |
| 4 | **Outlook / M365 Mail** | S (+M) | OAuth | Enterprise email + calendar via Microsoft Graph. |
| 5 | **Slack** | S + M | OAuth | Team knowledge lives in Slack messages/threads. |
| 6 | **Notion** | S + M | OAuth | Docs/wikis; official remote MCP + search API. |
| 7 | **GitHub** | S + M | OAuth | Code/issues/PR search; official remote MCP. |
| 8 | **Confluence** (Atlassian) | S + M | OAuth | Wikis/runbooks; Atlassian remote MCP. |
| 9 | **Jira** (Atlassian) | S + M | OAuth | Issues/projects; Atlassian remote MCP. |
| 10 | **Dropbox** | S | OAuth | Widely‑used personal/business file store. |

**Wave 2 — Extended productivity, support, CRM**

| # | App | Capability | Auth | Why |
|---|-----|-----------|------|-----|
| 11 | **Box** | S + M | OAuth | Enterprise content mgmt; official remote MCP. |
| 12 | **Google Calendar** | S | OAuth | Events search; pairs with Gmail. |
| 13 | **Microsoft Teams** | S | OAuth | Chat/channel messages via Graph. |
| 14 | **Linear** | S + M | OAuth / API key | Issue tracking; remote MCP (also accepts API key). |
| 15 | **Asana** | S + M | OAuth | Tasks/projects; official remote MCP. |
| 16 | **Zendesk** | S | OAuth / token | Support ticket search. |
| 17 | **Intercom** | S + M | OAuth | Conversations/support; remote MCP. |
| 18 | **Salesforce** | S + M | OAuth | CRM records (SOSL); official remote MCP. |
| 19 | **HubSpot** | S + M | OAuth / token | CRM search; MCP available. |
| 20 | **Monday.com** | S + M | OAuth | Work mgmt; remote MCP. |

**Wave 3 — Specialized dev / design / knowledge**

| # | App | Capability | Auth | Why |
|---|-----|-----------|------|-----|
| 21 | **Sentry** | S + M | OAuth | Error/issue search; official remote MCP. |
| 22 | **Airtable** | S + M | OAuth | Structured bases; remote MCP. |
| 23 | **Figma** | M (+S) | OAuth | Design files/components; remote MCP. |
| 24 | **Coda** | S | API token | Docs/tables. |
| 25 | **Guru** | S | API token | Knowledge cards / verified answers. |

**Backlog / honorable mentions (post‑25):** ServiceNow, GitLab, Bitbucket, Trello, ClickUp, Miro, Discord, Zoom, Google Docs (native export), Confluence/Jira Data Center (on‑prem), Stripe, PayPal, Cloudflare, Supabase, Amplitude, Plaid, Shopify, and **unified‑API providers** (Truto / Unified.to / Merge / Apideck) as a single meta‑connector that fans out to hundreds of apps (see §B.7.4).

---

## Part B — Technical Specification

### B.1 Where it fits

```
        ┌──────────────── Apps tab (web) ─────────────────┐
        │  Catalog grid  •  Connect (OAuth/API key)       │
        │  Connections manager  •  Federated search box   │
        └───────────────┬──────────────────┬─────────────┘
                        │                  │
             POST /v1/apps/search   GET/POST/DELETE /v1/apps/connections
                        │                  │
        ┌───────────────▼──────────────────▼─────────────┐
        │            Connector layer (api)                 │
        │  connectors/registry.ts  •  connectors/<app>.ts  │
        │  capability: { search?, mcp? }                   │
        └───────┬───────────────────────┬─────────────────┘
                │                       │
        native app search API     per‑user MCP registry ──► AI orchestrator (ai/orchestrator.ts)
        (Drive, Graph, Slack…)    (mcp/registry.ts, mcp/client.ts)
                │                       │
        normalize.ts  ──► results[]     tools[] ──► usage telemetry
                                        │
                encrypted keystore (crypto.ts / keystore.ts) ◄─ OAuth tokens & API keys (per user)
```

The connector layer mirrors the existing **search‑provider plugin model** (`api/src/providers/**` + `engine.ts`): each connector is a small module registered centrally; the engine fans out, normalizes, dedups, and merges. The **MCP** half reuses the existing `mcp/client.ts` (stdio / Streamable HTTP / SSE) but the **registry becomes per‑user** (§B.4).

### B.2 Connector interface

A single connector declares one or both capabilities. New file per app under `api/src/connectors/`.

```ts
// api/src/connectors/types.ts
export type ConnectorCapability = 'search' | 'mcp';

export interface ConnectorAuth {
  kind: 'oauth2' | 'api_key' | 'remote_mcp_oauth';
  // oauth2
  authorizeUrl?: string;
  tokenUrl?: string;
  scopes?: string[];          // least-privilege, read-only defaults
  pkce?: boolean;
  // api_key
  keyLabel?: string;          // e.g. "Personal Access Token"
  keyHelpUrl?: string;        // where the user generates it
  validate?: (ctx: ConnCtx) => Promise<boolean>;
}

export interface SearchCapability {
  /** Live pass-through search against the app's own search API. */
  search(ctx: ConnCtx, q: string, opts: AppSearchOpts): Promise<NormalizedResult[]>;
}

export interface McpCapability {
  /** Produce an McpServerConfig for this user's connection (usually a hosted remote endpoint). */
  toMcpServer(ctx: ConnCtx): McpServerConfig; // see api/src/ai/mcp/config.ts
}

export interface Connector {
  id: string;                 // 'gdrive', 'onedrive', 'github', …
  label: string;              // 'Google Drive'
  category: string[];         // ['Files'], ['Dev'], ['Knowledge'] …
  icon: string;               // logo asset / material symbol fallback
  auth: ConnectorAuth;
  capabilities: ConnectorCapability[];
  search?: SearchCapability;
  mcp?: McpCapability;
}
```

`ConnCtx` carries `{ userId, resolveToken(): Promise<string> }` where `resolveToken` decrypts the per‑user token from the keystore and transparently **refreshes OAuth access tokens** when expired.

`NormalizedResult` reuses the existing search result shape (see `api/src/normalize.ts` / `api/src/types.ts`): `{ title, url, snippet, source, publishedAt?, thumbnail?, meta }`, with `source` set to the connector `id` and `meta` carrying app‑specific fields (mimeType, author, channel, repo, ticketStatus…).

### B.3 Federated search endpoint

```
POST /v1/apps/search
{
  "q": "q3 roadmap",
  "apps": ["gdrive","onedrive","notion"],   // optional; default = all connected & search-capable
  "limit": 25,
  "page": 1
}
→ 200 { "results": NormalizedResult[], "appsUsed": string[], "appsFailed": [{id, reason}], "facets"?: [...] }
```

Behavior (implementation compliance rule §1/§2 — never crash, log at choke points):
- Resolve the user's connected, search‑capable apps (intersect with `apps` filter).
- Fan out with `Promise.allSettled`; each connector wraps its own call in try/except, returns `[]` on failure, and is logged with `logger.warn`. One dead app never breaks the response.
- Normalize → dedup (by url/id) → merge/rank (recency + relevance) → paginate.
- Record per‑app query usage for telemetry (best‑effort; no metering/charge).
- Cache per `(userId, app, q, page)` in Redis with a short TTL (personal data → short/opt‑out; reuse `cache.ts` with per‑source TTL and a privacy flag so sensitive apps skip cache).

`GET /v1/apps/catalog` returns the static connector catalog (id, label, category, capabilities, auth kind) + per‑user connection status. `GET/POST/DELETE /v1/apps/connections` manage connections. OAuth: `GET /v1/apps/:id/oauth/start` → redirect; `GET /v1/apps/oauth/callback` → exchange code, encrypt+store tokens.

### B.4 Per‑user MCP registry (evolves existing code)

Today `mcpServers()` reads a **global** env var (`api/src/ai/mcp/config.ts`) and `mcpTools(_userId?)` ignores the user (`api/src/ai/mcp/registry.ts`). Change:

- Add `userMcpServers(userId): Promise<McpServerConfig[]>` that returns the user's connected, MCP‑capable apps as `McpServerConfig` (via each connector's `toMcpServer(ctx)`), injecting the decrypted per‑user token into `headers` (e.g. `Authorization: Bearer …`) **server‑side only**.
- `mcpTools(userId)` unions **global/admin env servers** (unchanged) **+ per‑user connected servers**. Namespacing (`mcp__<server>__<tool>`) already prevents clashes.
- The existing `mcp/client.ts` connection cache is keyed by `cfg.id`; make the cache key `${userId}:${cfg.id}` so per‑user connections/tokens don't collide.
- Tokens are resolved at call time and **never placed in the model context** (AI_MODE_SPEC §11) — only injected into the transport headers.

This means a single "Connect" powers both `/v1/apps/search` (native) and AI Mode (MCP) wherever the app offers both.

### B.5 Credentials & security

- **Storage:** reuse AES‑256‑GCM keystore (`crypto.ts` + `keystore.ts`). Add a `connections` concept: per‑user rows storing `{ user_id, connector_id, auth_kind, scopes, access_token_enc, refresh_token_enc, expires_at, status, created_at, last_used_at }`. Do **not** modify `*_raw*` DB model files (workspace rule); use migrations under `api/db/` / `docs/creep/`.
- **Least privilege:** request read‑only scopes by default (e.g. Drive `drive.readonly`, Graph `Files.Read`/`Files.Read.All`, Gmail `gmail.readonly`, Slack `search:read`). Surface exact scopes in the consent UI.
- **Isolation & injection safety:** tokens decrypted in‑process only; never returned to the browser (mask like `maskSecret`); never in prompts/tool args. Write‑capable tools require explicit confirmation.
- **Revoke:** Disconnect calls the provider's token‑revocation endpoint (when available) and deletes stored tokens; drops any cached MCP connection.
- **Rate limits:** per‑connector limiter (reuse `ratelimit.ts`); normalize upstream `429`/`Retry-After`; back off per app.
- **Audit:** record connect/disconnect and per‑app query counts (Timescale metrics, `metrics.ts`).

### B.6 Web / UI

- **Modality nav:** add `apps` to `SEARCH_MODALITIES` (`web/src/components/search-modality-nav.tsx`) and `MODALITY_META` (`web/src/lib/search-modality-meta.ts`):
  ```ts
  apps: { icon: 'apps', label: 'Apps', short: 'Apps', title: 'Search + MCP apps — connect Drive, GitHub, Slack…' }
  ```
  (Material Symbols `apps` grid icon, matching the existing icon system.)
- **Route:** the Apps modality renders the catalog/connections + federated search shell (new components under `web/src/components/apps/`), reusing `results.tsx`, `facet-rail.tsx`, and the composer.
- **Connect UX:** OAuth button → popup/redirect; API‑key modal reuses `secret-input.tsx`; connected cards show status + Disconnect. Dashboard management page reuses `provider-keys-manager.tsx` patterns.
- **AI Mode:** connected apps appear in the tools/MCP disclosure (AI_MODE_SPEC §10.3) with a "tools used" chip.

### B.7 Connector implementation notes (per app, verified from vendor docs)

#### B.7.1 Google Drive (connector `gdrive`) — Wave 1, first slice
- **Search:** `GET https://www.googleapis.com/drive/v3/files` with `q=fullText contains '<query>'` (also `name contains …`), `fields=nextPageToken,files(id,name,webViewLink,mimeType,modifiedTime,owners)`, `spaces=drive`, `pageSize`, `pageToken`. Note Drive `fullText`/`contains` matches **whole tokens** (not arbitrary substrings) — set user expectations / combine `name` + `fullText`.
- **Auth:** OAuth2 (PKCE), scope `https://www.googleapis.com/auth/drive.readonly` (search + content export). `drive.metadata.readonly` **cannot** search file content — don't use it for search.
- **Content:** search returns metadata; native Google Docs/Sheets/Slides can be exported to text via `files.export`; binaries (PDF/DOCX) are surfaced as links (optionally piped through existing `/v1/crawl`).
- **MCP (optional):** community/GDrive MCP server exists; native search connector is the v1 path.

#### B.7.2 OneDrive / SharePoint (connector `onedrive`) — Wave 1, first slice
- **Search (broad):** `POST https://graph.microsoft.com/v1.0/search/query` with body `{ requests: [{ entityTypes:["driveItem"], query:{ queryString:"<query>" }, from, size, fields:["name","webUrl","lastModifiedDateTime","parentReference"] }] }`. Supports **KQL** (`filetype:docx`, `path:"…"`, `lastModifiedTime>…`).
- **Search (single drive):** `GET /me/drive/root/search(q='<query>')` (also searches items shared with the user via the Drive resource).
- **Auth:** OAuth2, delegated scope `Files.Read` (least) → `Files.Read.All` / `Sites.Read.All` for shared/SharePoint content. Results are permission‑trimmed to the signed‑in user.

#### B.7.3 Remote‑MCP vendors (Wave 1–3) — connect once, tools in AI Mode
Vendor‑hosted, OAuth 2.1 remote MCP endpoints (verified 2026). Register via `remote_mcp_oauth`:

| App | Endpoint | Auth |
|-----|----------|------|
| GitHub | `https://api.githubcopilot.com/mcp/` | OAuth (also PAT) |
| Notion | `https://mcp.notion.com/mcp` | OAuth 2.1 |
| Atlassian (Jira/Confluence) | `https://mcp.atlassian.com/v1/mcp` (`/v1/sse`) | OAuth 2.1 |
| Linear | `https://mcp.linear.app/mcp` (`/sse`) | OAuth 2.1 / API key |
| Asana | `https://mcp.asana.com/mcp` (`/sse`) | OAuth 2.1 |
| Intercom | `https://mcp.intercom.com/sse` | OAuth 2.1 |
| Sentry | `https://mcp.sentry.dev/mcp` (`/sse`) | OAuth 2.1 |
| Monday.com | `https://mcp.monday.com/sse` | OAuth 2.1 |
| Airtable | `https://mcp.airtable.com/mcp` | OAuth 2.1 |
| Figma | `https://mcp.figma.com/mcp` | OAuth 2.1 |
| Box | official remote MCP | OAuth 2.1 |
| Salesforce | official remote MCP | OAuth 2.1 |
| Stripe / PayPal / Cloudflare / Supabase (backlog) | `https://mcp.stripe.com/`, `https://mcp.paypal.com`, `https://mcp.cloudflare.com/…`, `https://mcp.supabase.com/mcp` | OAuth / API key |

These slot straight into the existing `mcp/client.ts` (Streamable HTTP / SSE). The connector's `toMcpServer(ctx)` returns `{ id, transport:'http'|'sse', url, headers:{ Authorization: 'Bearer '+token } }`.

#### B.7.4 Native search connectors (verified endpoints)
- **Gmail:** `GET /gmail/v1/users/me/messages?q=<gmail query>`; scope `gmail.readonly`.
- **Slack:** `GET https://slack.com/api/search.messages?query=<q>` (user token, `search:read`).
- **Notion:** `POST https://api.notion.com/v1/search` (also has remote MCP).
- **Confluence:** `GET /wiki/rest/api/search?cql=<CQL>` (Atlassian OAuth).
- **Jira:** `GET /rest/api/3/search?jql=<JQL>` (Atlassian OAuth).
- **GitHub:** `GET /search/code`, `/search/issues`, `/search/repositories` (OAuth).
- **Dropbox:** `POST https://api.dropboxapi.com/2/files/search_v2` (OAuth).
- **Box:** `GET https://api.box.com/2.0/search?query=<q>` (OAuth).
- **Zendesk:** `GET /api/v2/search.json?query=<q>` (OAuth/API token).
- **Salesforce:** SOSL `GET /services/data/vXX.X/search/?q=FIND{<q>}` (OAuth).
- **HubSpot:** `POST /crm/v3/objects/{object}/search` (OAuth / private‑app token).
- **Linear:** GraphQL `searchIssues`/`searchDocuments` (OAuth/API key).
- **Asana:** `GET /api/1.0/workspaces/{id}/tasks/search` (OAuth).
- **Intercom:** `POST /conversations/search` (OAuth).
- **Google Calendar:** `GET /calendar/v3/calendars/{id}/events?q=<q>` (OAuth).
- **Microsoft Teams:** `POST /search/query` with `entityTypes:["chatMessage"]` (Graph, OAuth).
- **Coda:** REST doc/page listing + filtering (API token).
- **Guru:** `GET /api/v1/search/cardmgr?searchTerms=<q>` (API token).
- **Airtable:** `GET /v0/{baseId}/{table}?filterByFormula=SEARCH(...)` (OAuth/PAT) — plus remote MCP.

**Unified‑API alternative (backlog, not a v1 dependency):** vendors like **Truto** (`api.truto.one/unified/search`, ~41 providers), **Unified.to** (460+ integrations, normalized `storage_file` / `kms_page` / `messaging_message` / `ticketing_ticket`), **Merge**, and **Apideck** offer one normalized search across many apps. We could add a single "unified" meta‑connector to expand coverage fast; trade‑off is a third‑party dependency + data‑handling review vs. our native‑first / self‑hostable posture (PRD.md). Keep native connectors as the default; treat unified APIs as an optional accelerator.

### B.8 Later phase — optional indexing / RAG
v1 is live pass‑through. A later phase MAY add **opt‑in** per‑user indexing: fetch → chunk (~512 tokens, overlap) → embed with the existing MiniLM embedder (`embeddings.ts`) → store in Redis/vector (`vector.ts`) with `{connection_id, object_type, updated_at}` → semantic retrieval + RAG grounding in AI Mode. Gated by explicit consent; sync via provider webhooks where available. Reuses the AI‑Mode vector‑tool‑selection infrastructure (AI_MODE_SPEC §8).

### B.9 Rollout / milestones

1. **M1 — Framework + files:** connector interface, catalog API + Apps tab UI, OAuth + API‑key flows, encrypted connections store, **Google Drive** + **OneDrive** federated search, disconnect/revoke.
2. **M2 — Per‑user MCP:** evolve `mcp/config.ts`/`registry.ts` to per‑user; connect **GitHub / Notion / Atlassian / Linear** remote MCP; tools flow into AI Mode.
3. **M3 — Wave‑1 search connectors:** Gmail, Slack, Notion (native), Confluence, Jira, Dropbox; facets + dedup polish.
4. **M4 — Wave 2:** Box, Calendar, Teams, Asana, Zendesk, Intercom, Salesforce, HubSpot, Monday.
5. **M5 — Wave 3 + polish:** Sentry, Airtable, Figma, Coda, Guru; saved cross‑app searches; optional unified‑API meta‑connector; groundwork for opt‑in indexing (§B.8).

### B.10 Open questions

- **Search vs. MCP overlap:** for apps offering both, is federated search a native call or a call *through* the app's MCP `search` tool? (Default: native for search‑capable connectors; MCP for tool use — avoids double implementation where the vendor's MCP already exposes a good search tool.)
- **OAuth app registration** overhead: each OAuth connector needs a registered client (client id/secret) per provider — track setup + secret storage (server‑side, encrypted in the DB / `hds-secrets` volume).
- **Caching personal data:** default TTL and per‑app opt‑out; which apps must never cache.

---

## References (research, 2026)

- MCP reference & registry: `github.com/modelcontextprotocol/servers`, `registry.modelcontextprotocol.io`; awesome lists (`mcpHQ/awesome-mcp-servers`, `JAW9C/awesome-remote-mcp-servers`).
- Remote MCP endpoints & OAuth 2.1 trend (GitHub, Notion, Atlassian, Linear, Asana, Intercom, Sentry, Monday, Airtable, Figma, Box, Salesforce, Stripe, PayPal, Cloudflare, Supabase): APIScout "Top APIs With MCP Endpoints 2026"; Docker Agent remote‑MCP docs; vendor MCP pages.
- Google Drive search: `developers.google.com/workspace/drive/api` (`files.list` `q`, `fullText contains`, scopes).
- OneDrive/SharePoint search: Microsoft Graph `search/query` (`driveItem`, KQL) and `/me/drive/root/search`, `Files.Read(.All)` scopes.
- Unified‑search alternatives: Truto (`unified/search`), Unified.to (normalized file/page/message/ticket), Merge, Apideck.
