-- HD-Search object privileges. Run as a SUPERUSER (e.g. hackerdogs) AFTER the
-- schema + tables exist (db/schema.sql, applied as hdsearchadmin). Idempotent.
--
-- Privilege model:
--   hdsearchadmin    — owns everything (implicit full control; DDL for migrations)
--   hdsearchrw       — SELECT/INSERT/UPDATE/DELETE on rows, USAGE/SELECT on
--                      sequences. NO ability to drop/alter/create objects (no DDL).
--   hdsearchreadonly — SELECT only.
--
-- "no delete objects" (per requirement) = cannot DROP/ALTER tables (no DDL). Row
-- DELETE is part of read-write because the app deletes rows (e.g. revoking a
-- stored provider key).

SET search_path TO hd_search, public;

-- schema visibility
GRANT USAGE ON SCHEMA hd_search TO hdsearchrw, hdsearchreadonly;

-- ── read/write role: row DML on all current tables ──────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA hd_search TO hdsearchrw;
GRANT USAGE, SELECT                 ON ALL SEQUENCES   IN SCHEMA hd_search TO hdsearchrw;

-- ── read-only role: SELECT only ─────────────────────────────────────────────
GRANT SELECT                        ON ALL TABLES      IN SCHEMA hd_search TO hdsearchreadonly;

-- ── default privileges for FUTURE tables/sequences created by hdsearchadmin ──
-- (so new migrations don't need a manual re-grant)
ALTER DEFAULT PRIVILEGES FOR ROLE hdsearchadmin IN SCHEMA hd_search
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hdsearchrw;
ALTER DEFAULT PRIVILEGES FOR ROLE hdsearchadmin IN SCHEMA hd_search
  GRANT USAGE, SELECT ON SEQUENCES TO hdsearchrw;
ALTER DEFAULT PRIVILEGES FOR ROLE hdsearchadmin IN SCHEMA hd_search
  GRANT SELECT ON TABLES TO hdsearchreadonly;

-- Explicitly ensure rw cannot create objects in the schema (CREATE is what allows
-- making/dropping tables). USAGE (granted above) does not include CREATE.
REVOKE CREATE ON SCHEMA hd_search FROM hdsearchrw, hdsearchreadonly;

-- TimescaleDB: grants on a hypertable propagate to its chunks automatically, so
-- hdsearchrw can INSERT/SELECT on search_history & usage_metrics without extra work.
