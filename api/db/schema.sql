-- HD-Search schema (PostgreSQL / TimescaleDB).
-- Idempotent: safe to run repeatedly (used by scripts/migrate.ts and start_*.sh).
-- TimescaleDB is optional; the hypertable calls are guarded so this also works on
-- vanilla Postgres (they degrade to plain tables).

CREATE SCHEMA IF NOT EXISTS hd_search;
SET search_path TO hd_search, public;

-- Try to enable TimescaleDB; ignore if the extension isn't installed.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS timescaledb;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'timescaledb extension not available; continuing on vanilla Postgres';
END$$;

-- ---------------------------------------------------------------------------
-- Users (mirrors the Auth0 identity; populated on first login by the web app).
-- The API only needs the id to scope keys/history/usage.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hd_search.users (
  id           TEXT PRIMARY KEY,                 -- auth0 sub (e.g. 'auth0|abc')
  email        TEXT,
  name         TEXT,
  picture      TEXT,
  plan         TEXT NOT NULL DEFAULT 'free',     -- free|dev|devtest|production|enterprise
  stripe_customer_id TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-user provider preferences (enabled/disabled, custom priority ranking).
-- Stored as JSONB: { "disabled": ["serpapi"], "ranks": { "web:openserp": 1 }, "cacheTtlSec": 900 }
ALTER TABLE hd_search.users ADD COLUMN IF NOT EXISTS provider_prefs JSONB;

-- Local (self-hosted) auth: scrypt password hash + role. NULL password_hash means
-- the identity came from an external IdP (Auth0/core) rather than a local account.
-- role gates admin: 'admin' grants the admin:platform scope (see roles.ts / auth.ts).
ALTER TABLE hd_search.users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE hd_search.users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
-- Case-insensitive lookup by email for local login (only where an email exists).
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uniq
  ON hd_search.users (lower(email)) WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Per-user provider credentials. secret_enc is AES-256-GCM ciphertext (crypto.ts);
-- plaintext keys NEVER hit the database. Unique per (user, field).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hd_search.user_provider_keys (
  id           BIGINT GENERATED ALWAYS AS IDENTITY,
  user_id      TEXT NOT NULL,
  provider     TEXT NOT NULL,                    -- e.g. 'serpapi'
  field        TEXT NOT NULL,                    -- credential field, e.g. 'serpapi','google_cse_cx'
  secret_enc   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_provider_keys_pk PRIMARY KEY (id),
  CONSTRAINT user_provider_keys_uq UNIQUE (user_id, field)
);
CREATE INDEX IF NOT EXISTS upk_user_idx ON hd_search.user_provider_keys (user_id);

-- ---------------------------------------------------------------------------
-- Search history (captured in Timescale, spec §8). One row per API search/crawl.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hd_search.search_history (
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id      TEXT NOT NULL,
  kind         TEXT NOT NULL,                    -- 'search'|'crawl'|'vector'
  query        TEXT,
  modality     TEXT,
  engine_used  TEXT,                             -- first engine that answered
  engines      JSONB,                            -- full per-engine outcome
  result_count INT NOT NULL DEFAULT 0,
  cached       BOOLEAN NOT NULL DEFAULT false,
  took_ms      INT NOT NULL DEFAULT 0,
  api_key_id   TEXT
);
SELECT create_hypertable('hd_search.search_history', 'ts', if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS sh_user_ts_idx ON hd_search.search_history (user_id, ts DESC);

-- ---------------------------------------------------------------------------
-- Usage metrics (Timescale hypertable) — powers the dashboard charts (spec §8).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hd_search.usage_metrics (
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id      TEXT NOT NULL,
  metric       TEXT NOT NULL,                    -- 'search'|'crawl'|'vector'|'error'|'cache_hit'
  engine       TEXT,
  value        DOUBLE PRECISION NOT NULL DEFAULT 1,
  meta         JSONB
);
SELECT create_hypertable('hd_search.usage_metrics', 'ts', if_not_exists => TRUE, migrate_data => TRUE);
CREATE INDEX IF NOT EXISTS um_user_ts_idx ON hd_search.usage_metrics (user_id, ts DESC);
CREATE INDEX IF NOT EXISTS um_metric_idx ON hd_search.usage_metrics (metric, ts DESC);

-- ---------------------------------------------------------------------------
-- Monthly usage counters for plan-quota enforcement (cheap point lookups).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hd_search.usage_counters (
  user_id      TEXT NOT NULL,
  period       TEXT NOT NULL,                    -- 'YYYY-MM'
  kind         TEXT NOT NULL,                    -- 'search'|'crawl'|'vector'
  count        BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT usage_counters_pk PRIMARY KEY (user_id, period, kind)
);

-- ---------------------------------------------------------------------------
-- API keys (sk-hds-...) issued per user for programmatic access. Only the sha256
-- hash is stored. Mirrors hd-feeds keys but persisted in Postgres for the panel.
-- (The hot verification path still uses Redis; this is the source of truth.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hd_search.api_keys (
  id           TEXT PRIMARY KEY,                 -- key_xxx
  user_id      TEXT NOT NULL,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,                    -- sk-hds-AbC1 (display only)
  scopes       TEXT[] NOT NULL DEFAULT ARRAY['search:read'],
  rate_limit_per_min INT NOT NULL DEFAULT 120,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ak_user_idx ON hd_search.api_keys (user_id);

-- ---------------------------------------------------------------------------
-- System-level default provider keys. Managed by super users, mapped to plans.
-- When a user doesn't have their own key for a provider, the system falls back
-- to the default key for their plan tier. Keys are AES-256-GCM encrypted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hd_search.system_provider_keys (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider     TEXT NOT NULL,                    -- e.g. 'anthropic', 'openai_llm'
  field        TEXT NOT NULL,                    -- credential field, e.g. 'anthropic'
  plan_id      TEXT NOT NULL,                    -- plan tier: free|dev|devtest|production|enterprise
  secret_enc   TEXT NOT NULL,                    -- AES-256-GCM encrypted
  label        TEXT,                             -- optional admin note
  status       TEXT NOT NULL DEFAULT 'active',
  created_by   TEXT NOT NULL,                    -- admin user id who set the key
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT system_provider_keys_uq UNIQUE (field, plan_id)
);
CREATE INDEX IF NOT EXISTS spk_plan_idx ON hd_search.system_provider_keys (plan_id);

-- ---------------------------------------------------------------------------
-- LLM provider registry (DB-backed, JSON fallback). Super users can add
-- custom providers and models. Cached in memory with 60s TTL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hd_search.llm_providers (
  id           TEXT PRIMARY KEY,                 -- e.g. 'anthropic', 'openai', 'xai'
  name         TEXT NOT NULL,                    -- display name
  description  TEXT,
  website      TEXT,
  docs_url     TEXT,
  access_type  TEXT NOT NULL DEFAULT 'commercial',
  key_fields   JSONB NOT NULL DEFAULT '[]',      -- credential field names
  supports_streaming BOOLEAN NOT NULL DEFAULT true,
  dynamic      BOOLEAN NOT NULL DEFAULT false,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  source       TEXT NOT NULL DEFAULT 'json',     -- 'json' (from file) or 'admin' (manually added)
  created_by   TEXT,                             -- admin user id
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hd_search.llm_models (
  id           TEXT PRIMARY KEY,                 -- model id sent to the provider API
  provider_id  TEXT NOT NULL REFERENCES hd_search.llm_providers(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  context_tokens    INT NOT NULL DEFAULT 128000,
  max_output_tokens INT NOT NULL DEFAULT 8192,
  input_per_1m      NUMERIC(10,4) NOT NULL DEFAULT 0,
  output_per_1m     NUMERIC(10,4) NOT NULL DEFAULT 0,
  cached_input_per_1m NUMERIC(10,4) NOT NULL DEFAULT 0,
  capabilities JSONB NOT NULL DEFAULT '{"tools":false,"vision":false,"thinking":false,"streaming":true}',
  default_rank INT NOT NULL DEFAULT 100,
  enabled      BOOLEAN NOT NULL DEFAULT true,
  plans        JSONB NOT NULL DEFAULT '[]',      -- plan ids that can use this model
  source       TEXT NOT NULL DEFAULT 'json',     -- 'json' (from file) or 'admin' (manually added)
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_models_provider_idx ON hd_search.llm_models (provider_id);

-- ---------------------------------------------------------------------------
-- Single-use auth tokens: password reset + magic-link sign-in.
-- Only the SHA-256 of the token is stored, so a database leak cannot be replayed
-- to take over an account. Rows are consumed atomically (see auth-tokens.ts).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hd_search.auth_tokens (
  token_hash  TEXT PRIMARY KEY,                    -- sha256(raw token), hex
  user_id     TEXT NOT NULL REFERENCES hd_search.users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                       -- 'reset' | 'magic'
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON hd_search.auth_tokens (user_id, kind);
CREATE INDEX IF NOT EXISTS auth_tokens_expires_idx ON hd_search.auth_tokens (expires_at);

-- Backfill: add source column to llm_providers if missing (added after initial table creation)
ALTER TABLE hd_search.llm_providers ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'json';
-- Backfill: OpenAI-compatible base URL for admin-added providers (NULL for built-ins,
-- which carry their endpoint in the shipped adapter).
ALTER TABLE hd_search.llm_providers ADD COLUMN IF NOT EXISTS base_url TEXT;

-- ---------------------------------------------------------------------------
-- Uploaded files (RAG). Raw bytes live in S3 (files/<user>/<thread>/<file>/…);
-- extracted chunks live in the RediSearch vector store (namespace file:<user>:<thread>).
-- This table is the SOURCE OF TRUTH for file identity + processing status. Delete
-- cascades here + S3 + vector on chat delete (docs/file-upload-rag.md §C.11).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hd_search.files (
  id             TEXT PRIMARY KEY,                 -- file_<uuid>
  user_id        TEXT NOT NULL,
  thread_id      TEXT,                             -- owning chat (nullable = unattached draft)
  folder_id      TEXT,                             -- optional folder assignment
  name           TEXT NOT NULL,
  ext            TEXT,
  mime           TEXT,
  size_bytes     BIGINT NOT NULL DEFAULT 0,
  sha256         TEXT,                             -- integrity / dedupe
  s3_key         TEXT NOT NULL,                    -- raw object key
  namespace      TEXT NOT NULL,                    -- vector namespace
  processor      TEXT,                             -- processor id that ran
  status         TEXT NOT NULL DEFAULT 'queued',   -- queued|processing|ready|failed
  degraded       BOOLEAN NOT NULL DEFAULT false,   -- extraction fell back
  error          TEXT,                             -- redacted failure reason
  pages          INT,
  chunks_total   INT NOT NULL DEFAULT 0,
  chunks_indexed INT NOT NULL DEFAULT 0,
  preview        TEXT,                             -- short extracted preview
  attempts       INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_user_thread_idx ON hd_search.files (user_id, thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS files_status_idx ON hd_search.files (status) WHERE status IN ('queued','processing');

-- ---------------------------------------------------------------------------
-- Sidebar folders (chat / search grouping). Folder identity is durable here;
-- a chat's folder assignment is stored on the file row / thread meta.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hd_search.folders (
  id             TEXT PRIMARY KEY,                 -- folder_<uuid>
  user_id        TEXT NOT NULL,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'chat',     -- 'chat' | 'search' | 'mixed'
  sort           INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS folders_user_idx ON hd_search.folders (user_id, kind, sort);
