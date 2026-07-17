// History + usage metrics writers (spec §8). All writes are best-effort: they use
// tryQuery so a DB hiccup never fails a search. Captured into TimescaleDB
// hypertables that power the dashboard + search-history pages.
import { SCHEMA, tryQuery } from './db.js';
import { log } from './logger.js';

export type Kind = 'search' | 'crawl' | 'vector';

interface RecordSearchArgs {
  userId: string;
  kind: Kind;
  query?: string;
  modality?: string;
  engineUsed?: string;
  engines?: unknown;
  resultCount: number;
  cached: boolean;
  tookMs: number;
  apiKeyId?: string;
  skipCounter?: boolean;
}

const period = () => new Date().toISOString().slice(0, 7); // YYYY-MM

/** Record one search/crawl/vector call into history + metrics + monthly counter. */
export async function recordUsage(a: RecordSearchArgs): Promise<void> {
  // history row
  await tryQuery(
    `insert into ${SCHEMA}.search_history
       (user_id, kind, query, modality, engine_used, engines, result_count, cached, took_ms, api_key_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [a.userId, a.kind, a.query ?? null, a.modality ?? null, a.engineUsed ?? null,
     a.engines ? JSON.stringify(a.engines) : null, a.resultCount, a.cached, a.tookMs, a.apiKeyId ?? null],
  );
  // time-series metric
  await tryQuery(
    `insert into ${SCHEMA}.usage_metrics (user_id, metric, engine, value, meta)
     values ($1,$2,$3,$4,$5)`,
    [a.userId, a.kind, a.engineUsed ?? null, 1, JSON.stringify({ cached: a.cached, tookMs: a.tookMs })],
  );
  if (a.cached) {
    await tryQuery(
      `insert into ${SCHEMA}.usage_metrics (user_id, metric, value) values ($1,'cache_hit',1)`,
      [a.userId],
    );
  }
  // monthly counter (quota) — skip for pagination (page > 1) so a single
  // query + modality = 1 counted operation regardless of scroll depth.
  if (!a.skipCounter) {
    await tryQuery(
      `insert into ${SCHEMA}.usage_counters (user_id, period, kind, count)
         values ($1,$2,$3,1)
       on conflict (user_id, period, kind) do update set count = ${SCHEMA}.usage_counters.count + 1`,
      [a.userId, period(), a.kind],
    );
  }
}

export async function recordError(userId: string, engine: string | undefined, message: string): Promise<void> {
  await tryQuery(
    `insert into ${SCHEMA}.usage_metrics (user_id, metric, engine, value, meta) values ($1,'error',$2,1,$3)`,
    [userId, engine ?? null, JSON.stringify({ message })],
  );
}

/** Current month's usage for a kind (for quota checks). */
export async function monthlyUsage(userId: string, kind: Kind): Promise<number> {
  const rows = await tryQuery<{ count: string }>(
    `select count from ${SCHEMA}.usage_counters where user_id=$1 and period=$2 and kind=$3`,
    [userId, period(), kind],
  );
  return rows[0] ? Number(rows[0].count) : 0;
}

export async function searchHistory(userId: string, limit = 50, offset = 0) {
  return tryQuery(
    `select ts, kind, query, modality, engine_used, result_count, cached, took_ms
       from ${SCHEMA}.search_history where user_id=$1 order by ts desc limit $2 offset $3`,
    [userId, Math.min(limit, 500), offset],
  );
}

/** Dashboard rollup: counts by day + by engine for the last N days. */
export async function dashboardMetrics(userId: string, days = 30) {
  const byDay = await tryQuery(
    `select date_trunc('day', ts) as day, metric, count(*)::int as n
       from ${SCHEMA}.usage_metrics
      where user_id=$1 and ts > now() - ($2 || ' days')::interval
      group by 1,2 order by 1`,
    [userId, String(days)],
  );
  const byEngine = await tryQuery(
    `select engine, count(*)::int as n
       from ${SCHEMA}.usage_metrics
      where user_id=$1 and engine is not null and ts > now() - ($2 || ' days')::interval
      group by 1 order by 2 desc limit 20`,
    [userId, String(days)],
  );
  const totals = await tryQuery(
    `select metric, count(*)::int as n
       from ${SCHEMA}.usage_metrics
      where user_id=$1 and ts > now() - ($2 || ' days')::interval
      group by 1`,
    [userId, String(days)],
  );
  return { byDay, byEngine, totals };
}

export function logUsageError(): void {
  log.debug('metrics write skipped');
}
