# HD-Search — File Upload, Processing & RAG (PRD + Spec)

**Status:** Draft → In implementation
**Owner:** Hackerdogs
**Last updated:** 2026-07-03
**Companion docs:** [AI Chat Persistence](aisearch-persistence.md) · [AI Mode Spec](AI_MODE_SPEC.md) · [PRD](PRD.md) · [Technical Design](TECHNICAL_DESIGN.md) · [Performance / Scale / Security](PERFORMANCE_SCALE_SECURITY.md) · [Search + MCP Apps](file-processing.md)
**Related code today:** `api/src/storage.ts` (S3/SeaweedFS), `api/src/vector.ts` (RediSearch RAG), `api/src/embeddings.ts`, `api/src/ai-threads.ts`, `api/src/crypto.ts` (AES-256-GCM), `api/src/db.ts`, `api/db/schema.sql`, `web/src/components/ai/*`, `web/src/components/experience-left-sidebar.tsx`

> **Scope note:** This doc covers **user file upload → processing → RAG grounding in AI Search**, plus **delete cascade** and **sidebar paging/folders/search**. It is distinct from [file-processing.md](file-processing.md), which specs the *Search + MCP Apps* (third-party connectors) feature.

---

## Part A — Product Requirements (PRD)

### A.1 Summary

Users can attach files to an AI Search chat. Files are stored durably in SeaweedFS (S3-compatible), parsed by a **pluggable processing engine** into searchable text, chunked, embedded, and indexed into the existing RediSearch vector store so the AI can answer over them (**RAG**). Attachments are surfaced through the **assistant-ui** composer.

Three deliverables:

1. **File upload + processing + RAG** — up to **200 MB** per file, broad format support via a plugin architecture, self-healing/crash-proof processing.
2. **Delete cascade** — deleting a chat deletes its files everywhere (S3 + Postgres + vector index), leaving zero orphans.
3. **Sidebar scale + discovery** — paging / infinite scroll (top 10 initial), **folders**, and a **single unified search box** on the sidebar collapse row (before the `<`) that searches both the *Search* and *AI Search* lists.

### A.2 Problem

- The AI chat composer (`web/src/components/ai/ai-search-thread.tsx`) has **no attachment support**; users cannot ground the model in their own documents.
- There is a mature RAG substrate (`vector.ts`, `embeddings.ts`) but nothing feeds user files into it.
- The sidebar (`experience-left-sidebar.tsx`) hard-caps the Search list at 20 and shows the AI Search list unbounded, with **no paging, no folders, and no search** — it does not scale past a few dozen chats.

### A.3 Goals

| # | Goal |
|---|------|
| G1 | **Attach & ask** — attach one or more files to a chat and get grounded answers via RAG. |
| G2 | **Broad formats via plugins** — PDF, XLSX, DOCX, PPTX, MD, images (png/jpg/svg/gif/webp/…), Figma, JSON, XML, and design files (DWG/DXF, PSD, AI). Adding a format = adding a plugin, no core changes. |
| G3 | **200 MB limit** — enforced end-to-end (client, BFF, API), streamed not buffered where possible. |
| G4 | **Crash-proof** — every stage is best-effort, resumable, and idempotent; a process crash mid-processing never loses a file or wedges a chat. Every file **always** yields at least a metadata document so retrieval never hard-fails. |
| G5 | **Secure at rest** — no plaintext secrets; any per-user processing credentials (OCR/vision/Figma) reuse the AES-256-GCM envelope (`crypto.ts`) and encrypted-key tables. Files are user-scoped and access-checked on every read. |
| G6 | **Delete cascade** — chat delete / account clear wipes S3 objects, Postgres rows, and vector docs. Zero orphans. |
| G7 | **Sidebar at scale** — top-10 + infinite scroll, folders, and one unified search input for both lists. |
| G8 | **Never break the chat path** — processing failures degrade gracefully, mirroring `history.ts` / `ai-threads.ts` best-effort philosophy. |

### A.4 Non-goals (this phase)

- Full-fidelity rendering/round-trip of proprietary binary design files (DWG/PSD/AI). We extract **text + metadata + (for rasterizable inputs) OCR/vision captions**, not vector geometry or layer compositing. See §C.2.
- Collaborative/shared files across users (files are private to the owning user + thread).
- Versioning / diffing of uploaded files (each upload is immutable; re-upload = new file id).
- Virus scanning engine (hook point in §C.9; the AV engine itself is ops-provided).
- Server-side folders for the **local** Search-recents list beyond browser storage (see §E.3).

### A.5 Personas

| Persona | Need |
|---------|------|
| **Researcher** | Drop a report/spreadsheet into a chat and ask questions across it. |
| **Designer / eng** | Attach a Figma export, PSD, or DXF and ask the model to summarize structure/text. |
| **Analyst** | Attach many docs over time; find an old chat/file quickly via sidebar search + folders. |
| **Privacy-conscious user** | Delete a chat and be certain the files are gone everywhere. |

### A.6 User-facing requirements

1. **Compose with attachments** — an attach control in the composer; drag-drop onto the thread; multiple files; live per-file status (`uploading → queued → processing → ready | failed`) with size and type; remove before send.
2. **200 MB cap** — rejected client-side with a clear message; enforced again server-side.
3. **Grounded answers** — when a chat has ready files, the model retrieves relevant chunks and cites the source file.
4. **Delete a chat → files gone** — from the sidebar delete affordance; also “Clear all chats” clears all files.
5. **Sidebar**
   - Both lists show **top 10** initially; scrolling loads more (infinite scroll).
   - **Folders**: create, rename, delete; assign chats into folders; collapse/expand folders.
   - **Unified search**: one input on the collapse row (before the `<` hide-sidebar button) filters **both** Search recents and AI Search chats in place.

### A.7 Success metrics

- A 150 MB PDF attaches, processes, and is queryable within the processing SLA (§C.8) without blocking the chat.
- Killing the API mid-processing and restarting resumes the job to `ready` (or `failed` with a reason) — no stuck `processing` rows.
- After deleting a chat: `0` objects under its S3 prefix, `0` Postgres file rows, `0` vector docs in its namespace.
- Sidebar with 500 chats renders top 10 instantly; search returns matches from both lists in <100 ms client-side.
- No increase in `/v1/ai/chat` SSE error rate attributable to files (all file work is off the hot path).

---

## Part B — Reference: existing substrate we build on

| Concern | Existing code | How files reuse it |
|---------|---------------|--------------------|
| Object storage | `storage.ts` (`S3Client`, `PutObject/GetObject/ListObjectsV2/DeleteObjects`, `purgePrefix`, `s3Path`) | New `files/<userId>/<threadId>/<fileId>/…` prefix + reuse `purgePrefix` for cascade delete. |
| RAG vector store | `vector.ts` (`indexDocuments`, `vectorSearch`, RediSearch HNSW + brute-force fallback, per-`namespace` TAG) | New namespace `file:<userId>:<threadId>`; extended metadata (fileId, page/sheet/chunk). |
| Embeddings | `embeddings.ts` (MiniLM 384-d default, OpenAI 1536-d), `getEmbedder()` | Reused as-is; same `dim` contract. |
| Encryption | `crypto.ts` (`encryptSecret`/`decryptSecret`, AES-256-GCM), `system_provider_keys` / `user_provider_keys` | OCR/vision/Figma provider keys stored encrypted, resolved via the same path as LLM keys. |
| Redis + resiliency | `store.ts` (`redis`, `redisHealthy()`, `k()`), health flag | Job queue + status live here; all reads guard on `redisHealthy()`. |
| Postgres | `db.ts` (`query`/`tryQuery` never-throw), `schema.sql` idempotent | New `hd_search.files` + `hd_search.folders`. |
| Thread persistence & delete | `ai-threads.ts` (`deleteAiThread`, `clearAiThreads`, S3 cascade) | File cascade hooks into `deleteAiThread` / `clearAiThreads`. |
| Auth | `auth.ts` (`requireAuth`, `requireScope`, `principal`, `isDemoUser`) | Upload gated by scope only; usage is unlimited and free (no quota/credits). |
| Logging | `logger.ts` (`log`, `errFields`) | All stages log structured events with `fileId`/`rid`. |
| Frontend runtime | assistant-ui `useRemoteThreadListRuntime` + `hd-search-sse-adapter.ts` + `hd-thread-list-adapter.tsx` | Composer attachments; chat body carries `fileIds`. |
| Sidebar | `experience-left-sidebar.tsx` (`CollapsibleSection`, `SearchesList`, `ThreadListItem`) | Add search box, paging, folder grouping. |

---

## Part C — Technical specification: File Upload + Processing + RAG

### C.1 Architecture overview

```
Browser (assistant-ui composer)
  │  multipart POST /api/files (BFF)         ── 200MB guard, drag-drop, per-file status
  ▼
Next.js BFF  /api/files, /api/files/[id]      ── injects X-HD-Internal / JWT, streams body
  ▼
API  POST /v1/files            (routes/files.ts)
  ├─ validate (size/type) ─ reject early
  ├─ stream raw → S3  files/<userId>/<threadId>/<fileId>/raw/<name>
  ├─ INSERT hd_search.files  (status='queued')            ── source of truth
  ├─ enqueue job → Redis  hds:files:jobs (durable)        ── crash-proof
  └─ 202 { fileId, status:'queued' }                      ── returns immediately
                          │
                          ▼
File processing worker (in-process, concurrency-limited, resumable)
  ├─ claim job (atomic RPOPLPUSH) ─ status='processing', heartbeat
  ├─ pick plugin by (mime, ext, magic-bytes)  ── processor registry
  ├─ extract text/blocks  (best-effort; always ≥ metadata doc)
  ├─ chunk  (token-aware, overlap)
  ├─ embed + indexDocuments(namespace=file:<userId>:<threadId>, ttl)
  ├─ UPDATE files status='ready', pages/chunks/bytes, extracted preview
  └─ on crash → job heartbeat goes stale → reaped → retried (bounded) → 'failed'
                          │
                          ▼
Chat turn  POST /v1/ai/chat  { …, fileIds?, threadId }
  └─ RAG: vectorSearch(query, file:<userId>:<threadId>, k) → inject context + citations
```

### C.2 Formats & the plugin (processor) architecture

A **processor** mirrors the `Embedder` plugin shape (`embeddings.ts`) and the provider registry (`providers/index.ts`):

```ts
// api/src/files/processors/types.ts
export interface ExtractBlock {
  text: string;                        // extracted, human/AI-readable text
  kind?: 'text' | 'table' | 'ocr' | 'caption' | 'metadata' | 'markup';
  loc?: { page?: number; sheet?: string; slide?: number; layer?: string; chunk?: number };
}
export interface ExtractResult {
  blocks: ExtractBlock[];
  meta: Record<string, unknown>;       // page/sheet/slide counts, dims, author, xmp…
  preview?: string;                    // short text preview for the UI
  degraded?: boolean;                  // true if we fell back (e.g. metadata-only)
}
export interface FileProcessor {
  id: string;                          // 'pdf' | 'office' | 'image' | 'json' | …
  match(input: { mime: string; ext: string; magic: Buffer }): number; // 0..1, highest wins
  extract(input: ProcessorInput): Promise<ExtractResult>;             // MUST NOT throw
}
```

**Registry** (`api/src/files/processors/index.ts`): ordered list; `pickProcessor()` returns the best `match()` score, always falling back to the **generic metadata processor** (score `0.01`, never fails) so the pipeline is total.

**Processor plan (v1):**

| Processor | Formats | Library / method | Output |
|-----------|---------|------------------|--------|
| `text` | md, txt, csv, log | native utf-8 decode | text (markdown preserved) |
| `json` | json, jsonl, ndjson | native; keep structure | text (JSON as-is) |
| `xml` | xml, svg, rss, xsd | keep raw XML; also strip text nodes | markup + text (**XML preserved per requirement**) |
| `pdf` | pdf, ai (PDF-compatible) | `pdfjs-dist` (page-streamed, page cap); OCR fallback for image-only pages | text per page (+ ocr) |
| `office` | docx, pptx, xlsx | `officeparser` + `xlsx` (SheetJS) for sheets→CSV | text per section/sheet/slide |
| `image` | png, jpg, jpeg, gif, webp, bmp, tiff | OCR (`tesseract.js`, opt-in) + optional vision caption (Anthropic vision, existing LLM keys) + EXIF | ocr + caption + metadata |
| `psd` | psd, psb | `ag-psd` (text layers + metadata; no rasterize) | text layers + layer tree |
| `dxf` | dxf | native ASCII DXF parse (TEXT/MTEXT) | drawing text + entity summary |
| `figma` | figma URL / file-key, .fig | Figma REST API → node text/structure; `.fig` binary → metadata | node text tree |
| `generic` | **everything else** incl. dwg, unknown | filename + mime + size + magic + embedded XMP/EXIF | metadata document (never fails) |

**Design-file honesty (documented decision):** DWG and other opaque binaries have no reliable pure-JS text parser → they resolve to the `generic` processor (metadata document). PSD and DXF get real text extraction; AI files are tried as PDF first. This guarantees G4 (total, crash-proof) while being transparent that binary-CAD geometry is out of scope (A.4).

**Heavy/optional deps** (`tesseract.js`, `pdfjs-dist`, `officeparser`, `xlsx`, `ag-psd`) are **lazy-`import()`ed inside the processor** so (a) boot stays fast, (b) a missing optional dep degrades that one format to `generic` instead of crashing, and (c) the base image isn’t bloated when a format is disabled.

### C.3 Extraction guarantees (crash-proofing)

- A registered processor’s `extract()` **must not throw**; internal failures downgrade to a `degraded` result carrying at least a metadata block. The worker also wraps every call in try/catch (defense-in-depth).
- Hard caps per file: max pages (`HDSEARCH_FILE_MAX_PAGES`, default 2000), max extracted chars (`HDSEARCH_FILE_MAX_CHARS`, default 5M), per-file timeout (`HDSEARCH_FILE_PROCESS_TIMEOUT_MS`, default 300000). Exceeding truncates with a logged note; never OOMs.
- OCR and vision are best-effort and time-boxed; over budget → file still `ready` with whatever text was extracted.
- Streaming: large uploads stream to S3; extraction reads from S3 in bounded chunks. Never hold a 200 MB buffer if avoidable.

### C.4 Chunking & embedding

- Token-aware chunker: ~800 tokens/chunk, ~120 overlap (~3200/480 chars), split on block/paragraph boundaries; small tables kept whole.
- Each chunk → `VecDoc` `{ text, title=<filename>, url=<fileId>, metadata={ fileId, threadId, userId, page?, sheet?, slide?, chunk, mime } }`.
- `indexDocuments(docs, 'file:<userId>:<threadId>', HDSEARCH_FILE_VECTOR_TTL)`. Default TTL **30 days** (files outlive the 24 h crawl-cache default), refreshed on access. Namespace scoping means delete = wipe the thread’s docs.
- Embedding batches; per-batch failure logged + retried once, then chunk skipped. File can still be `ready` with `chunks_indexed < chunks_total` recorded.

### C.5 Data model (Postgres)

Added to `api/db/schema.sql` (idempotent, matching existing style):

```sql
CREATE TABLE IF NOT EXISTS hd_search.files (
  id            TEXT PRIMARY KEY,                 -- file_<uuid>
  user_id       TEXT NOT NULL,
  thread_id     TEXT,                             -- owning chat (nullable = unattached draft)
  folder_id     TEXT,                             -- optional folder assignment
  name          TEXT NOT NULL,
  ext           TEXT,
  mime          TEXT,
  size_bytes    BIGINT NOT NULL DEFAULT 0,
  sha256        TEXT,
  s3_key        TEXT NOT NULL,
  namespace     TEXT NOT NULL,
  processor     TEXT,
  status        TEXT NOT NULL DEFAULT 'queued',   -- queued|processing|ready|failed
  degraded      BOOLEAN NOT NULL DEFAULT false,
  error         TEXT,                             -- redacted failure reason
  pages         INT,
  chunks_total  INT NOT NULL DEFAULT 0,
  chunks_indexed INT NOT NULL DEFAULT 0,
  preview       TEXT,
  attempts      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_user_thread_idx ON hd_search.files (user_id, thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS files_status_idx ON hd_search.files (status) WHERE status IN ('queued','processing');

CREATE TABLE IF NOT EXISTS hd_search.folders (
  id            TEXT PRIMARY KEY,                 -- folder_<uuid>
  user_id       TEXT NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'chat',     -- 'chat' | 'search' | 'mixed'
  sort          INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS folders_user_idx ON hd_search.folders (user_id, kind, sort);
```

Postgres is the **source of truth** for file identity/status; Redis holds hot job state. Postgres down → upload still stores to S3 + enqueues; the row is reconciled on recovery (`tryQuery` best-effort + a worker-start reconcile pass).

### C.6 Job queue & worker (crash-proof)

Redis-backed, durable, resumable — no external broker (celery belongs to other services):

- **Enqueue:** `LPUSH hds:files:jobs <fileId>` + `HSET hds:files:job:<fileId>` `{ userId, threadId, s3Key, attempts, enqueuedAt }`.
- **Claim:** `RPOPLPUSH hds:files:jobs → hds:files:processing` (reliable-queue), set `status='processing'`, write `heartbeat`.
- **Heartbeat:** refreshed every few seconds; a reaper (`setInterval`) requeues jobs with stale heartbeat (> `HDSEARCH_FILE_JOB_STALE_MS`, default 120000).
- **Retry:** `attempts++` per claim; after `HDSEARCH_FILE_MAX_ATTEMPTS` (default 3) → dead-letter `hds:files:failed` + `status='failed'` with reason. Never infinite-loop.
- **Idempotency:** re-index overwrites vector docs by deterministic id; row upsert `ON CONFLICT`; S3 raw key stable. Safe to replay.
- **Startup reconcile:** requeue stale `hds:files:processing` entries and Postgres rows stuck in `queued`/`processing`.
- **Concurrency:** `HDSEARCH_FILE_WORKER_CONCURRENCY` (default 2) bounded so a burst of 200 MB files can’t exhaust memory.
- **Redis down:** uploads still hit S3 + Postgres; a Postgres-scan fallback (`SELECT … WHERE status='queued'`) feeds the worker so processing survives a Redis outage.

### C.7 API surface

Auth: `requireAuth()` + `requireScope('vector:read')`; demo/anonymous get `403`/empty. Every handler verifies `row.user_id === principal.userId`.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/v1/files` | multipart upload (`file`, `threadId?`, `folderId?`); 200 MB cap; `202 { fileId, status }`. |
| GET | `/v1/files?threadId=…` | List files for a thread (or all user files). |
| GET | `/v1/files/:id` | File metadata + status. |
| GET | `/v1/files/:id/content` | Streamed download of raw object (access-checked). |
| GET | `/v1/files/:id/status` | Lightweight status poll for the composer. |
| DELETE | `/v1/files/:id` | Delete one file: S3 + row + vector docs. |
| DELETE | `/v1/files?threadId=…` | Delete all files for a thread. |

**Folders** (`routes/folders.ts`): `GET /v1/folders?kind=chat`, `POST /v1/folders`, `PATCH /v1/folders/:id`, `DELETE /v1/folders/:id`.

**Thread index paging:** extend `GET /v1/ai/threads` with `?limit&offset` (`ZREVRANGE offset count`) and include `folderId` per entry so the sidebar can group without N extra reads.

**Chat body:** `POST /v1/ai/chat` accepts `fileIds?: string[]`; when present (or the thread has ready files) the orchestrator runs RAG retrieval and injects grounded context + citations.

**BFF (Next.js)** mirrors these under `/api/files/*` and `/api/folders/*` using `apiCall`/`buildApiAuthHeaders`, streaming the multipart body (`duplex: 'half'`), re-imposing the 200 MB guard.

### C.8 Processing SLA & metering

- Enqueue→`ready` target: small docs < 5 s; 150 MB PDF < ~2 min (OCR excluded/time-boxed). Targets, not guarantees; chat never blocks on them.
- Usage recorded like a `vector` op via `recordUsage` (best-effort, for telemetry). No metering, credits, or quota — processing is unlimited and free.

### C.9 Security & privacy

- **User scoping:** S3 prefix, vector namespace, and every SQL query keyed by `userId`; `GET`/`DELETE` re-check ownership.
- **Secrets:** OCR/vision/Figma keys AES-256-GCM encrypted (`crypto.ts`), resolved like LLM keys; never logged; masked via `maskSecret`. No new plaintext sink.
- **Magic-byte sniffing:** never trust client `mime`; re-derive from magic bytes; reject executables by policy config.
- **AV hook:** `HDSEARCH_FILE_AV_URL` optional; positive scan → file `failed` (quarantined), no indexing.
- **Logging:** file names/previews logged at `debug` only, never `info`; errors redacted (per `ai-threads.ts` privacy note).
- **DoS:** 200 MB hard cap, per-user concurrent-upload cap, per-user rate limit, worker concurrency cap.

### C.10 Failure & degradation

| Failure | Behavior |
|---------|----------|
| S3 down at upload | 503 + retry hint; nothing half-written (row only after S3 ok). |
| Redis down | Upload stored + row written; Postgres-scan fallback drives worker; sidebar polls for status. |
| Postgres down | S3 + Redis job created; row reconciled on recovery; `tryQuery` never throws. |
| Embedder down | File `ready` with `chunks_indexed=0` + `degraded`; retried opportunistically; chat RAG returns no hits for it. |
| Processor throws (bug) | Caught → `generic` metadata doc; file `ready degraded`; error logged w/ `fileId`. |
| Worker crash mid-file | Heartbeat stale → reaper requeues → bounded retry → `failed` w/ reason. |
| Vision/OCR timeout | Skipped; text-only; `ready`. |

### C.11 Delete cascade (requirement #2)

`deleteFilesForThread(userId, threadId)`:
1. `purgePrefix(files/<userId>/<threadId>/)` in S3.
2. Delete vector docs in namespace `file:<userId>:<threadId>` (drop `hds:vec:doc:file:<userId>:<threadId>:*` + ns set).
3. `DELETE FROM hd_search.files WHERE user_id=$1 AND thread_id=$2`.
4. Remove any queued/processing jobs for those fileIds.

Wired into `ai-threads.ts` `deleteAiThread` (one thread) and `clearAiThreads` (all → `files/<userId>/` prefix + `file:<userId>:*` namespaces). Best-effort, independent tiers, mirroring the existing S3-archive cascade. **Zero orphans** is the bar (A.7).

---

## Part D — Frontend: attachments (assistant-ui)

| Area | Change | File |
|------|--------|------|
| Composer | Attach button + hidden file input + drag-drop dropzone; attachment tray with per-file chip (name, size, status, remove). | `web/src/components/ai/ai-search-thread.tsx` |
| Upload client | `uploadFile(file, threadId)` → `POST /api/files` (progress); poll `/api/files/:id/status` until `ready|failed`; 200 MB guard. | new `web/src/lib/files.ts` |
| Send | Include `fileIds` of ready attachments in the chat POST body. | `web/src/components/ai/hd-search-sse-adapter.ts` |
| BFF | `/api/files`, `/api/files/[id]`, `/api/files/[id]/status`, `/api/files/[id]/content` proxy w/ auth + streaming. | new `web/src/app/api/files/*` |
| Status UI | Chip states: `uploading %` → `queued` → `processing` → `ready`/`failed` (retry). Allow send while `processing` (RAG picks up ready files). | composer |
| Citations | Render file-sourced citations distinctly (filename + page). | existing citation UI |

### D.1 assistant-ui approach

The runtime already uses a **custom** local runtime + SSE adapter (`hd-search-sse-adapter.ts`) rather than a stock backend, so attachments use a thin custom tray backed by our upload lib, consistent with the existing custom-adapter pattern. Where assistant-ui 0.12.x attachment primitives fit cleanly they’re used; otherwise the tray is our own component.

---

## Part E — Frontend: sidebar paging, folders, unified search (requirement #3)

### E.1 Unified search box on the collapse row

Today the collapse row is `justify-end` with only the `chevron_left` (`<`) hide button (`experience-left-sidebar.tsx:309–319`). Change to:

```
[ 🔎  search chats…                    ] [ < ]
```

- A `flex-1` debounced search `input` sits **before** the `<` button on the same line.
- A single `query` state lifts to `ExperienceLeftSidebar`, passed to **both** `SearchesList` (filters recents) and the AI thread list (filters titles). Empty query → normal behavior.
- Case-insensitive substring match on visible title/query text; both sections auto-expand when a query is active; combined empty-state when neither matches.

### E.2 Paging / infinite scroll (top 10)

- **AI Search:** replace the unbounded feed — initial `limit=10`; an `IntersectionObserver` sentinel loads the next page via `GET /api/ai/threads?limit=10&offset=N` (`ZREVRANGE`). The thread-list adapter (`hd-thread-list-adapter.tsx`) gains cursor state.
- **Search recents:** local `getRecents()` sliced to 10, grown on scroll (same observer), no network.
- Active search query bypasses paging (filter the loaded set).

### E.3 Folders

- **AI chats (server-backed):** `folder_id` on the thread meta (Redis) + folder identity in `hd_search.folders`. Sidebar renders folders as collapsible groups; “Unfiled” holds the rest. Assign via a per-chat menu; folder CRUD via a header affordance. Paging applies within “Unfiled”; folders load members on expand.
- **Search recents (local):** browser-local folders (localStorage map `recentQuery → folderId`) since recents are local. v1 ships chat folders server-side; search-recents folders are local-only and clearly scoped (A.4).

### E.4 State & persistence

- Section open/closed already persists (`SEARCH_SECTION_KEY`, `CHAT_SECTION_KEY`). Add `hds_sidebar_folders_open:<id>` per folder.
- Search query is ephemeral (cleared on unmount).

---

## Part F — Phased delivery

| Phase | Scope |
|-------|-------|
| **P1 — Backend foundation** | `files/` module (processors: text/json/xml/generic + pdf/office/image), `files` + `folders` tables, S3 layout, job queue + worker + reaper, `routes/files.ts` + `routes/folders.ts`, chunk+embed+index, delete cascade into `ai-threads.ts`. Deps added lazily. |
| **P2 — RAG in chat** | `fileIds` on chat body; retrieval + context injection + citations in the orchestrator. |
| **P3 — Frontend attachments** | composer attach/drag-drop, upload lib, BFF routes, status chips, send with `fileIds`. |
| **P4 — Sidebar** | unified search box on collapse row; paging/infinite scroll (top 10); folders (server chat folders + local search folders). |
| **P5 — Extra processors** | psd (`ag-psd`), dxf, figma (REST), OCR/vision enablement, AV hook. |

---

## Part G — Acceptance criteria (checklist)

- [ ] Upload PDF/xlsx/docx/pptx/md/png/jpg/svg/json/xml ≤ 200 MB → each reaches `ready` (or `failed` w/ reason); `> 200 MB` rejected client + server.
- [ ] Every supported and unsupported file yields at least a metadata document; no `extract()` throws.
- [ ] Kill API mid-processing, restart → job resumes to a terminal state; no stuck `processing` rows.
- [ ] Chat with a ready file returns a grounded answer citing filename/page.
- [ ] Delete chat → `0` S3 objects under its prefix, `0` file rows, `0` vector docs; “Clear all chats” → same for all threads.
- [ ] No plaintext provider secret in DB, logs, or S3; file names/previews never logged above `debug`.
- [ ] Redis-down / Postgres-down / embedder-down each degrade gracefully; chat SSE never fails due to files.
- [ ] Sidebar: top 10 per list, infinite scroll loads more, folders CRUD + assignment work, one search box filters both lists.
- [ ] `npm run typecheck` clean in `api/` and `web/`; unit tests for processor registry, chunker, and delete cascade pass.

---

## Part H — Config (new env vars)

| Var | Default | Purpose |
|-----|---------|---------|
| `HDSEARCH_FILE_MAX_BYTES` | `209715200` (200 MB) | Upload hard cap. |
| `HDSEARCH_FILE_VECTOR_TTL` | `2592000` (30 d) | File chunk TTL in the vector store. |
| `HDSEARCH_FILE_WORKER_CONCURRENCY` | `2` | In-process processing workers. |
| `HDSEARCH_FILE_MAX_ATTEMPTS` | `3` | Retry cap before dead-letter. |
| `HDSEARCH_FILE_JOB_STALE_MS` | `120000` | Heartbeat staleness → reap/retry. |
| `HDSEARCH_FILE_PROCESS_TIMEOUT_MS` | `300000` | Per-file processing timeout. |
| `HDSEARCH_FILE_MAX_PAGES` | `2000` | Page cap (pdf/office). |
| `HDSEARCH_FILE_MAX_CHARS` | `5000000` | Extracted-char cap. |
| `HDSEARCH_FILE_OCR` | `off` | Enable OCR (`tesseract.js`). |
| `HDSEARCH_FILE_VISION` | `off` | Enable vision captioning via existing LLM vision keys. |
| `HDSEARCH_FILE_AV_URL` | *(empty)* | Optional AV scan endpoint; empty = disabled. |
| `HDSEARCH_FIGMA_TOKEN` | *(empty, encrypted if per-user)* | Figma REST access. |

---

*Hackerdogs — hd-search.ai*
