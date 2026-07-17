// Applies db/schema.sql to the database. DDL runs as the SCHEMA OWNER, so this
// uses HDSEARCH_MIGRATION_DATABASE_URL (the hdsearchadmin role) when set, falling
// back to HDSEARCH_DATABASE_URL. The app runtime itself connects with the lower-
// privilege hdsearchrw role and never runs DDL.
//
// For the FULL setup (roles + ownership + grants) use db/setup.sh instead; this
// script just (re)applies the table schema.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { log } from '../src/logger.js';

const HERE = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url =
    process.env.HDSEARCH_MIGRATION_DATABASE_URL ||
    process.env.HDSEARCH_DATABASE_URL ||
    process.env.DATABASE_URL;
  if (!url) throw new Error('no migration database URL (set HDSEARCH_MIGRATION_DATABASE_URL)');

  // Resolve db/schema.sql across both layouts: `tsx scripts/migrate.ts` (HERE =
  // <root>/scripts → ../db) and the compiled image `node dist/scripts/migrate.js`
  // (HERE = <root>/dist/scripts → ../../db, since db/ is copied to <root>/db).
  const candidates = [
    resolve(HERE, '..', 'db', 'schema.sql'),
    resolve(HERE, '..', '..', 'db', 'schema.sql'),
  ];
  const sqlPath = candidates.find((p) => existsSync(p));
  if (!sqlPath) throw new Error(`schema.sql not found (looked in: ${candidates.join(', ')})`);
  const sql = readFileSync(sqlPath, 'utf8');
  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 8000 });
  const who = (await pool.query('select current_user as u')).rows[0]?.u;
  log.info('applying schema', { sqlPath, role: who });
  await pool.query(sql);
  log.info('schema applied', { role: who });
  await pool.end();
}

main().catch((e) => {
  log.error('migration failed', { error: (e as Error).message });
  process.exit(1);
});
