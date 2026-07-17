// Public trends page data — categorized recent headlines. Cached in Redis.
import { Hono } from 'hono';
import { sendCached } from '../cache.js';
import { env } from '../env.js';
import { log, errFields } from '../logger.js';
import { getTrendsPage } from '../trends.js';

export const trendsRoutes = new Hono();

trendsRoutes.get('/', async (c) => {
  const windowHours = Math.min(168, Math.max(1, Number(c.req.query('window_hours')) || env.trendsWindowHours));
  const limit = Math.min(20, Math.max(1, Number(c.req.query('limit')) || env.trendsLimit));

  try {
    const data = await getTrendsPage({ windowHours, limit });
    return sendCached(c, data, { maxAge: env.trendsCacheTtlSec });
  } catch (e) {
    log.error('trends failed', errFields(e));
    return c.json({ error: 'internal_error', message: 'Failed to load trends' }, 500);
  }
});
