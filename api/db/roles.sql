-- HD-Search database roles. Run as a SUPERUSER (e.g. hackerdogs) connected to the
-- `hdsearch` database. Idempotent — safe to run repeatedly.
--
-- Three least-privilege logins (passwords are DEV DEFAULTS — change for prod, see
-- db/CREDENTIALS.md):
--   hdsearchadmin    — owns the schema; full DDL+DML (migrations run as this role)
--   hdsearchrw       — DML only (SELECT/INSERT/UPDATE/DELETE rows); NO object DDL.
--                      The application runtime connects as THIS role.
--   hdsearchreadonly — SELECT only (dashboards / analytics / BI).
--
-- Object-level privileges + default privileges are in db/grants.sql.

-- TimescaleDB extension must exist (created by a superuser) before hypertables.
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ── roles (create-if-missing; always (re)set the password to the documented one) ─
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hdsearchadmin') THEN
    CREATE ROLE hdsearchadmin LOGIN PASSWORD 'HdSearch-Admin-2026.Dev';
  ELSE
    ALTER ROLE hdsearchadmin WITH LOGIN PASSWORD 'HdSearch-Admin-2026.Dev';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hdsearchrw') THEN
    CREATE ROLE hdsearchrw LOGIN PASSWORD 'HdSearch-RW-2026.Dev';
  ELSE
    ALTER ROLE hdsearchrw WITH LOGIN PASSWORD 'HdSearch-RW-2026.Dev';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hdsearchreadonly') THEN
    CREATE ROLE hdsearchreadonly LOGIN PASSWORD 'HdSearch-RO-2026.Dev';
  ELSE
    ALTER ROLE hdsearchreadonly WITH LOGIN PASSWORD 'HdSearch-RO-2026.Dev';
  END IF;
END$$;

-- hdsearchadmin must not accidentally hold superuser/createrole; it only owns the
-- application schema.
ALTER ROLE hdsearchadmin NOSUPERUSER NOCREATEROLE NOCREATEDB;
ALTER ROLE hdsearchrw      NOSUPERUSER NOCREATEROLE NOCREATEDB;
ALTER ROLE hdsearchreadonly NOSUPERUSER NOCREATEROLE NOCREATEDB;

-- hdsearchadmin has ALL privileges on the database (incl. CREATE so it can own
-- and manage the schema); rw/readonly may only CONNECT.
GRANT ALL PRIVILEGES ON DATABASE hdsearch TO hdsearchadmin;
GRANT CONNECT ON DATABASE hdsearch TO hdsearchrw, hdsearchreadonly;

-- the admin role owns the application schema (created by db/setup.sh as
-- `CREATE SCHEMA hd_search AUTHORIZATION hdsearchadmin`).
