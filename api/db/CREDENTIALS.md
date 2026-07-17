# HD-Search Database Credentials

Database: **`hdsearch`** on the `hd-db` TimescaleDB container. Application schema:
**`hd_search`**.

> ⚠️ These are **development defaults**. Rotate them for any shared/production
> deployment (`ALTER ROLE <role> WITH PASSWORD '…'`) and update the connection
> strings in `api/.env`.

## Roles (created by `db/roles.sql` / `db/setup.sh`)

| Role | Password (dev default) | Privileges | Used by |
|---|---|---|---|
| `hdsearchadmin` | `HdSearch-Admin-2026.Dev` | Owns schema `hd_search`; full DDL+DML. | **Migrations** (`npm run migrate`) |
| `hdsearchrw` | `HdSearch-RW-2026.Dev` | `SELECT/INSERT/UPDATE/DELETE` on rows; `USAGE/SELECT` on sequences. **No DDL** (cannot create/alter/drop tables). | **App runtime** (the API) |
| `hdsearchreadonly` | `HdSearch-RO-2026.Dev` | `SELECT` only. | Dashboards / BI / analytics |

The bootstrap **superuser** (`hackerdogs`) is used only to create the database and
the roles — never by the running app.

## Connection strings

The app runtime (read/write, least privilege):
```
HDSEARCH_DATABASE_URL=postgres://hdsearchrw:HdSearch-RW-2026.Dev@127.0.0.1:5432/hdsearch
```

Migrations (DDL — runs as the schema owner):
```
HDSEARCH_MIGRATION_DATABASE_URL=postgres://hdsearchadmin:HdSearch-Admin-2026.Dev@127.0.0.1:5432/hdsearch
```

Read-only (BI tools):
```
postgres://hdsearchreadonly:HdSearch-RO-2026.Dev@127.0.0.1:5432/hdsearch
```

> Passwords here use only URL-safe characters (`-` and `.`) so they need no
> percent-encoding in the connection string. If you change a password to include
> `@ : / ? # ! $`, URL-encode it (e.g. `!` → `%21`).

## Setup / re-apply

```bash
# from services/hd-search
PG_SUPER_PASSWORD='<hackerdogs password>' ./api/db/setup.sh           # create/converge
PG_SUPER_PASSWORD='<hackerdogs password>' ./api/db/setup.sh --reset   # wipe + recreate schema
```

SQL files (run in this order by `setup.sh`):
1. `db/roles.sql` — roles + `timescaledb` extension + `CONNECT` grant
2. `db/schema.sql` — schema + tables + hypertables (applied as `hdsearchadmin`)
3. `db/grants.sql` — table/sequence privileges + default privileges
