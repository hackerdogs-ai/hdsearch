# HD-Search — AI Chat Persistence (PRD + Spec)

**Status:** Draft — not implemented  
**Owner:** Hackerdogs  
**Companion docs:** [AI Mode Spec](AI_MODE_SPEC.md) · [PRD](PRD.md) · [Technical Design](TECHNICAL_DESIGN.md)  
**Related code today:** `api/src/history.ts`, `web/src/lib/recents.ts`, `api/src/storage.ts`, `api/src/metrics.ts`, `web/src/components/ai/*`

---

## Part A — Product Requirements (PRD)

### A.1 Summary

AI Search conversations should persist using the **same tiered model as search history**: browser → Redis (3-day) → S3 archive (durable) → Postgres/Timescale (analytics). Signed-in users sync across devices via server tiers; everyone gets a local browser copy.

In addition, users get a **Temporary chat** mode (ChatGPT-style): even when signed in, they can start a conversation that is **never written to Redis, S3, or Postgres** — only held in the browser for that session.

This document **supersedes** earlier ideas of Redis-only AI persistence with user-selectable TTL (24h / 3d / 7d). AI chat TTL on the server matches search history: **3 days in Redis**, with a **durable S3 archive** and **Timescale analytics**.

### A.2 Problem

Today:

- AI threads live in **browser localStorage only** (`useLocalRuntime` + assistant-ui).
- Server-side `recordHistory()` stores only the **last user prompt** (not the full thread) in the same Redis list as search recents.
- There is no cross-device AI chat restore, no durable archive for conversations, and no analytics table for AI threads comparable to `search_history`.

Users expect parity with search history (account sync + dashboard) and an explicit **private / temporary** chat when they do not want server retention.

### A.3 Goals

| # | Goal |
|---|------|
| G1 | **Tier parity with search** — same four-layer strategy: browser, Redis (3d), S3 (durable), Postgres (analytics). |
| G2 | **Full thread restore** — not just the last prompt; messages, titles, and tool-ui payloads needed to reopen a chat. |
| G3 | **Temporary chat** — opt-in per thread; skips all server persistence; available to every signed-in user. |
| G4 | **Anonymous users** — browser tier only; temporary by default; no server write. |
| G5 | **Unlimited & free** — persistence mode has no billing implication; usage is unlimited (usage recorded for telemetry only). |
| G6 | **Best-effort writes** — persistence failures never block streaming or chat completion (same as `recordHistory` / `recordUsage`). |

### A.4 Non-goals (this phase)

- User-configurable retention (24h / 7d dropdown) — **out of scope**; fixed 3-day Redis to match search.
- Postgres as primary thread store for UI restore — **later**; v1 uses Redis + S3 like search recents, Timescale for audit only.
- Encrypting thread content differently from search history — reuse existing trust boundary (local email+password session, per-user keys).
- Syncing temporary chats to account after the fact.

### A.5 Personas

| Persona | Need |
|---------|------|
| **Signed-in researcher** | Chats follow them across browsers; sidebar lists recent threads. |
| **Long-term user** | Durable archive beyond 3-day Redis window (compliance / revisit). |
| **Privacy-conscious user** | Temporary chat: no server copy, like ChatGPT temporary thread. |
| **Anonymous visitor** | Try AI Search locally; sign in to unlock account sync. |

### A.6 User-facing requirements

1. **Default (signed in, not temporary)**  
   - New AI chats persist to **browser + Redis + S3 (durable archive) + Postgres metrics**.  
   - Sidebar shows server-backed thread list when signed in.  
   - Dashboard can link to recent AI conversations (alongside existing query recents).

2. **Temporary chat (explicit opt-in)**  
   - Toggle in AI panel top bar: **“Temporary chat”** (icon + label; ChatGPT-style).  
   - When ON for the active thread:  
     - No Redis / S3 / Postgres thread writes.  
     - Browser may still hold messages **only until tab close / explicit new chat** (see Spec §C.4).  
     - Visual indicator (badge) so user knows the chat is not saved to account.  
   - Applies to **all** signed-in users.

3. **Not signed in**  
   - Temporary behavior only (no server tiers).  
   - Temporary toggle **hidden or disabled** with copy: “Sign in to save chats to your account.”

4. **Search History panel**  
   - Keep existing **query recents** (`source: 'ai'`) for “what did I ask?”  
   - Full **AI Chats** list comes from thread APIs / sidebar (separate from flat recents).

5. **Clear / delete**  
   - Clear browser threads (local).  
   - Clear account AI threads (Redis + optional S3 keys) — separate actions, same pattern as search history panel.

### A.7 Success metrics

- Signed-in user opens AI on device B and sees threads created on device A (within 3-day window).
- Temporary thread never appears in `GET /v1/ai/threads` or Redis keys for that user.
- Signed-in user: thread snapshot exists under `ai-threads/<userId>/` in S3 after each completed turn.
- Zero increase in chat SSE error rate due to persistence (writes async / best-effort).

---

## Part B — Reference: how search history works today

Use this as the **template** for AI chat persistence.

| Tier | Store | Who | TTL / limit | What is stored | Code |
|------|-------|-----|-------------|----------------|------|
| **Browser** | `localStorage` (`hd_recents`) | Everyone | 50 entries | `{ q, modality, ts }` | `web/src/lib/recents.ts` |
| **Redis** | `hds:history:<userId>` list | Signed-in (not demo) | **3 days**, max **200** | `{ q, modality, ts, count?, source?, model? }` | `api/src/history.ts` |
| **S3** | `history/<userId>/<ts>_<hash>.json` | All signed-in (non-demo) users | Durable | Same entry JSON as Redis | `api/src/storage.ts` → `archiveHistory` |
| **Postgres** | `hd_search.search_history` hypertable | All API calls (incl. demo) | Operational retention | Full call log: engines, timing, counts | `api/src/metrics.ts` → `recordUsage` |

**Recording triggers:** search → `recordHistory` + `recordUsage`; AI today → `recordHistory` (prompt only) only.

**UI:** Dashboard Search History — left column “This browser”, right column “Your account” (`search-history-panel.tsx` → `/api/history`).

AI chat persistence **mirrors this stack** with AI-specific payloads and keys (§C).

---

## Part C — Technical specification

### C.1 Persistence modes

```text
                    ┌─────────────────────────────────────┐
                    │         Temporary chat ON          │
                    │  (browser only, no server tiers)    │
                    └─────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │         Temporary chat OFF           │
                    │    (default for signed-in users)     │
                    └─────────────────┬─────────────────┘
                                      │
        ┌───────────────┬─────────────┼─────────────────────────────┐
        ▼               ▼             ▼                             ▼
    Browser         Redis (3d)    S3 (durable)               Postgres
    (always)        signed-in     archive                    analytics
```

| Mode | Browser | Redis | S3 | Postgres thread row | Query recents (`recordHistory`) |
|------|---------|-------|----|--------------------|------------------------------|
| Anonymous | Yes | No | No | No | No |
| Signed-in, normal | Yes | Yes | Yes | Yes (metrics) | Yes (last prompt) |
| Signed-in, **temporary** | Yes* | No | No | No | No |

\* Temporary browser retention: in-memory or sessionStorage preferred over long-lived localStorage so refresh can drop the thread (product choice: **sessionStorage** for temporary threads; **localStorage** for normal browser tier). Document default: **sessionStorage** for temporary, **localStorage** for normal — aligns with “not saved to account.”

### C.2 Data shapes

#### C.2.1 Thread index entry (Redis list — mirrors `HistoryEntry` pattern)

Stored in Redis list `hds:ai:threads:<userId>` (new key namespace; do not overload `hds:history:<userId>`).

```ts
interface AiThreadIndexEntry {
  threadId: string;       // uuid
  title: string;          // auto or user-renamed
  ts: number;             // last activity epoch ms
  messageCount: number;
  model?: string;         // last model used
  temporary: false;       // index only contains non-temporary threads
}
```

List ops: `LPUSH`, `LTRIM` 0..199, `EXPIRE` **259200** (3 days) — same constants as `history.ts`.

#### C.2.2 Thread body (Redis string — full restore)

Key: `hds:ai:thread:<userId>:<threadId>`  
Value: JSON

```ts
interface AiThreadBlob {
  threadId: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AiMessageRecord[];
  temporary: false;
}

interface AiMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  content: AiContentPart[];  // text + tool-ui blocks (assistant-ui compatible subset)
  createdAt: number;
  model?: string;
}
```

Refresh **both** index entry and blob TTL on each completed turn (3-day rolling window, same as search list).

**Size limits:** cap blob at **512 KB** or **100 messages** (whichever first); truncate oldest assistant tool payloads with summary note in UI.

#### C.2.3 S3 archive (durable — mirrors `archiveHistory`)

Path: `ai-threads/<userId>/<threadId>/<updatedAt>_<sha1>.json`  
Body: full `AiThreadBlob` snapshot after each completed turn (immutable revision per save).

Written for all signed-in (non-demo) users, same gate as `archiveHistory` in `history.ts`.

#### C.2.4 Postgres analytics (mirrors `search_history`)

New hypertable **`hd_search.ai_thread_runs`** (or extend `search_history` with `kind = 'ai_thread'` — prefer dedicated table for clarity):

| Column | Type | Notes |
|--------|------|-------|
| ts | timestamptz | hypertable partition |
| user_id | text | |
| thread_id | text | |
| temporary | boolean | always false if row exists |
| model | text | |
| input_tokens | int | |
| output_tokens | int | |
| took_ms | int | |
| status | text | ok / error / cancelled |

Written in same best-effort path as `recordUsage` after SSE `done`. **Not** used for UI thread restore in v1.

### C.3 Recording rules

**When to persist (normal signed-in thread):**

1. After each successful SSE `done` event (or terminal error with partial assistant message).  
2. Async / fire-and-forget; log warnings on failure.  
3. Update browser tier from client immediately; server tiers from API or BFF callback.

**When NOT to persist:**

- `principal` is demo user (`public-demo`) — browser only if at all.  
- Thread flagged **`temporary: true`** for current session.  
- Anonymous / not signed in.

**Query recents (`recordHistory`):**  
Continue writing `{ q, modality: 'ai', source: 'ai', model, ts }` for **non-temporary** signed-in turns only (first user message or each turn — match search: once per “search-like” action; recommend **once per thread title / first prompt** to avoid list spam).

### C.4 Temporary chat — behavior

| Aspect | Rule |
|--------|------|
| **Enable** | User toggles “Temporary chat” before or during compose; applies to **current thread**. New thread inherits last toggle state (session preference in sessionStorage). |
| **Default** | Signed-in: **OFF** (persist like search). Anonymous: effectively ON (no server). |
| **Server** | API accepts `temporary: boolean` on thread create / chat body; when true, skip Redis, S3, Postgres, `recordHistory`. |
| **Browser** | Use sessionStorage key `hds_ai_temp_thread_<threadId>`; do not add to local thread list that syncs from server. |
| **Sidebar** | Temporary threads show only while active; ghost icon; not in server thread list. |
| **Switch normal → temporary mid-thread** | Do not delete already-synced server copy; stop further server writes; optional banner. |
| **Switch temporary → normal mid-thread** | Optional v1: offer “Save to account” one-shot upload; else only new threads persist. |

### C.5 API surface

Auth: same as `/v1/ai/chat` (`requireAuth`, `search:read`).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/ai/threads` | List index entries from Redis (empty for demo/anonymous). |
| GET | `/v1/ai/threads/:id` | Load thread blob from Redis. |
| PATCH | `/v1/ai/threads/:id` | Rename title. |
| DELETE | `/v1/ai/threads/:id` | Remove index + blob (+ best-effort S3 tombstone note). |
| DELETE | `/v1/ai/threads` | Clear all user AI threads (account clear). |
| POST | `/v1/ai/chat` | **Extend body:** `{ messages, modelOverride, threadId?, temporary? }`. **Extend SSE `done`:** `{ threadId, temporary }`. |

BFF (Next.js): mirror routes under `/api/ai/threads/*` with `buildApiAuthHeaders`.

Implementation module: `api/src/ai-threads.ts` (parallel to `history.ts` + `storage.ts` helpers).

### C.6 Frontend

| Area | Change |
|------|--------|
| **Top bar** | “Temporary chat” toggle + badge when active; disabled + tooltip when signed out. |
| **Runtime** | Replace pure `useLocalRuntime` with hybrid: remote thread list when signed in && !temporary; local/session when anonymous or temporary. |
| **Sidebar** | Merge server thread list (Redis-backed) with local-only temporary thread. |
| **Dashboard** | Optional “AI conversations” section linking to `/search?modality=ai&thread=<id>`. |
| **Search History panel** | Unchanged for query recents; do not conflate with full threads. |

Preference storage:

- `temporaryChat` default for new threads: `sessionStorage` (`hds_ai_temporary_default`).  
- Normal browser cache: extend existing assistant-ui local storage adapter with `temporary` flag per thread.

### C.7 Security & privacy

- All Redis / S3 keys scoped by `userId`; API must verify `thread.userId === principal.userId`.  
- Temporary chats must not appear in server logs with full message body at INFO (debug only, redacted).  
- S3 archive inherits same bucket policy as crawl/history archives.  
- AGPL / internal compliance: temporary mode documented in product FAQ (“not stored on Hackerdogs servers”).

### C.8 Failure & degradation

| Failure | Behavior |
|---------|----------|
| Redis down | Chat works; browser tier only; warn in UI “sync unavailable”. |
| S3 down | Redis still works; archive skipped with warning log. |
| Postgres down | Analytics row skipped; no user impact. |

Same philosophy as `history.ts` / `metrics.ts`.

### C.9 Phased delivery

| Phase | Scope |
|-------|--------|
| **P1** | `ai-threads.ts` Redis read/write; API routes; BFF; hybrid runtime; temporary toggle UI; skip server writes when temporary. |
| **P2** | S3 durable archive; dashboard AI conversation links; clear-all account action. |
| **P3** | Postgres `ai_thread_runs` hypertable + dashboard metrics charts. |
| **P4** (future) | Postgres primary store for long retention / cross-region; Redis as hot cache only. |

### C.10 Open decisions

1. **sessionStorage vs in-memory** for temporary browser — recommend sessionStorage (survives refresh within tab, cleared on tab close).  
2. **Upload on “Save to account”** when switching temporary → normal mid-thread — P1 or P2?  
3. **Tool payload size** in Redis blob — hard truncate vs S3 pointer for large tool results.  
4. **Thread list in Search History dashboard** — P2 or keep sidebar-only?

---

## Part D — Acceptance criteria (checklist)

- [ ] Signed-in user creates non-temporary thread on device A; device B lists and opens it within 3 days.  
- [ ] After 3 days without activity, Redis thread keys expire (same as search history).  
- [ ] Signed-in user: S3 object written under `ai-threads/<userId>/…` on each completed turn.  
- [ ] Temporary thread: no keys under `hds:ai:threads:<userId>` or `hds:ai:thread:…` after chat completes.  
- [ ] Temporary thread: no `recordHistory` entry for that conversation.  
- [ ] Anonymous user: no server AI thread APIs return data; toggle disabled.  
- [ ] Persistence errors do not fail `/v1/ai/chat` SSE stream.  
- [ ] Clear account AI threads removes Redis index + blobs (and documents S3 lifecycle separately).

---

## Part E — Migration notes

- Deprecate reliance on **localStorage-only** thread list as source of truth for signed-in users once P1 ships; one-time import optional (read local threads → POST to API if not temporary).  
- Existing `recordHistory` AI entries remain valid as **query recents**; full threads are a separate system.  
- Update [AI_MODE_SPEC.md](AI_MODE_SPEC.md) §12 / §15 when implementation starts (remove “Postgres server-side thread sync” as only path; point here instead).

---

*Hackerdogs — hd-search.ai*
