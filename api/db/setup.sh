#!/usr/bin/env bash
# Full database setup for HD-Search against the running TimescaleDB container.
# Creates (if needed) the `hdsearch` database, the three roles, the schema (owned
# by hdsearchadmin), and the grants. Idempotent. Re-runnable.
#
# Requires a SUPERUSER login to bootstrap roles. Provide it via env:
#   PG_SUPER_USER       (default: hackerdogs)
#   PG_SUPER_PASSWORD   (required)
#   PG_CONTAINER        (default: hd-db)      docker container running Postgres
#   PG_HOST/PG_PORT     (default: 127.0.0.1/5432, inside the container)
#   DB_NAME             (default: hdsearch)
#
# Usage:
#   PG_SUPER_PASSWORD='...' ./api/db/setup.sh
#   PG_SUPER_PASSWORD='...' ./api/db/setup.sh --reset   # DROP+recreate schema (destroys data)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

PG_SUPER_USER="${PG_SUPER_USER:-hackerdogs}"
PG_CONTAINER="${PG_CONTAINER:-hd-db}"
PG_HOST="${PG_HOST:-127.0.0.1}"
PG_PORT="${PG_PORT:-5432}"
DB_NAME="${DB_NAME:-hdsearch}"
ADMIN_PW="HdSearch-Admin-2026.Dev"   # matches db/roles.sql
RESET="${1:-}"

if [ -z "${PG_SUPER_PASSWORD:-}" ]; then
  echo "❌ PG_SUPER_PASSWORD is required (the ${PG_SUPER_USER} superuser password)."
  exit 1
fi

# psql helpers (TCP + password so it works regardless of pg_hba local rules)
super() { docker exec -i -e PGPASSWORD="$PG_SUPER_PASSWORD" "$PG_CONTAINER" \
  psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_SUPER_USER" -v ON_ERROR_STOP=1 "$@"; }
admin() { docker exec -i -e PGPASSWORD="$ADMIN_PW" "$PG_CONTAINER" \
  psql -h "$PG_HOST" -p "$PG_PORT" -U hdsearchadmin -v ON_ERROR_STOP=1 "$@"; }

echo "→ [1/5] ensure database '${DB_NAME}' exists"
super -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || super -d postgres -c "CREATE DATABASE ${DB_NAME};"

echo "→ [2/5] create roles + extension (db/roles.sql)"
super -d "$DB_NAME" < "$HERE/roles.sql"

echo "→ [3/5] (re)own schema by hdsearchadmin"
if [ "$RESET" = "--reset" ]; then
  echo "   --reset: dropping schema hd_search (data will be lost)"
  super -d "$DB_NAME" -c "DROP SCHEMA IF EXISTS hd_search CASCADE;"
fi
super -d "$DB_NAME" -c "CREATE SCHEMA IF NOT EXISTS hd_search AUTHORIZATION hdsearchadmin;"
super -d "$DB_NAME" -c "ALTER SCHEMA hd_search OWNER TO hdsearchadmin;"
# Note: legacy tables owned by the bootstrap superuser are not auto-reassigned
# (the superuser owns the database itself). Use `--reset` once to get a clean
# admin-owned schema if you previously migrated as the superuser.

echo "→ [4/5] apply schema as hdsearchadmin (db/schema.sql)"
admin -d "$DB_NAME" < "$HERE/schema.sql"

echo "→ [5/5] apply grants (db/grants.sql)"
super -d "$DB_NAME" < "$HERE/grants.sql"

echo ""
echo "✅ Database '${DB_NAME}' ready."
echo "   Roles: hdsearchadmin (owner/migrations), hdsearchrw (app runtime), hdsearchreadonly (BI)"
echo "   App must connect as hdsearchrw. Migrations run as hdsearchadmin."
echo "   Passwords: db/CREDENTIALS.md (DEV DEFAULTS — change for prod)."
