// Postgres / TimescaleDB pool. Holds: per-user encrypted provider credentials,
// search history, and usage metrics (hypertables). Lazily connects; all callers
// tolerate the DB being absent (engine still works with .env dev keys / public
// providers) so a DB outage degrades rather than breaks search.
import pg from 'pg';
import { env } from './env.js';
import { log, errFields } from './logger.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.pgUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  application_name: 'hdsearch',
});

let dbHealthy = true;
let lastDownLog = 0;

pool.on('error', (e) => markDbDown(e));

export function dbAvailable(): boolean {
  return dbHealthy;
}

function markDbDown(e: unknown): void {
  dbHealthy = false;
  const now = Date.now();
  if (now - lastDownLog > 10000) {
    lastDownLog = now;
    log.warn('postgres unavailable', errFields(e));
  }
}

/** Run a query; returns rows. Marks DB down and rethrows on connection errors. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const res = await pool.query<T>(text, params as any[]);
    dbHealthy = true;
    return res.rows;
  } catch (e) {
    markDbDown(e);
    throw e;
  }
}

/** Run a query but never throw — returns [] on failure. For non-critical paths
 *  (history writes, metrics) where search must not fail if the DB hiccups. */
export async function tryQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    return await query<T>(text, params);
  } catch (e) {
    log.debug('tryQuery suppressed error', errFields(e));
    return [];
  }
}

export async function pingDb(): Promise<boolean> {
  try {
    await pool.query('select 1');
    dbHealthy = true;
    return true;
  } catch (e) {
    markDbDown(e);
    return false;
  }
}

export const SCHEMA = env.pgSchema;

export async function closeDb(): Promise<void> {
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
}
