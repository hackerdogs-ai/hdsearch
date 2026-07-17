// Health + service metadata + OpenAPI. Health is unauthenticated (for probes);
// it reports the liveness of each dependency without failing the whole service.
import { Hono } from 'hono';
import { pingRedis } from '../store.js';
import { pingDb } from '../db.js';
import { storageHealthy } from '../storage.js';
import { ensureVectorIndex } from '../vector.js';
import { env } from '../env.js';
import { openapiDoc } from '../openapi.js';

export const metaRoutes = new Hono();

metaRoutes.get('/health', (c) => c.json({ status: 'ok', service: 'hdsearch', ts: new Date().toISOString() }));

metaRoutes.get('/healthz', async (c) => {
  const [redis, db, s3] = await Promise.all([pingRedis(), pingDb(), storageHealthy()]);
  let rediSearch = false;
  try {
    rediSearch = await ensureVectorIndex();
  } catch {
    /* ignore */
  }
  const ok = redis; // redis is the only hard dependency; others degrade gracefully
  return c.json(
    {
      status: ok ? 'ok' : 'degraded',
      runMode: env.runMode,
      deps: {
        redis,
        postgres: db,
        seaweedfs: s3,
        rediSearch,
        embeddings: env.embeddingsProvider,
      },
      ts: new Date().toISOString(),
    },
    ok ? 200 : 503,
  );
});

metaRoutes.get('/openapi.json', (c) => c.json(openapiDoc()));

metaRoutes.get('/', (c) =>
  c.json({
    service: 'hdsearch',
    description: 'Search + crawl + vector-search aggregator with priority-ordered provider fallback.',
    version: '1.0.0',
    docs: '/openapi.json',
    endpoints: ['/v1/search', '/v1/search/vector', '/v1/crawl', '/v1/engines', '/v1/keys', '/v1/account', '/v1/trends', '/v1/billing'],
  }),
);
