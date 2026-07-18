// HTTP app wiring. Global middleware: request-id, structured access log, CORS,
// and a catch-all error handler so no exception ever leaks a stack to a client.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { log } from './logger.js';
import { sha1 } from './cache.js';
import { metaRoutes } from './routes/meta.js';
import { searchRoutes } from './routes/search.js';
import { crawlRoutes } from './routes/crawl.js';
import { archiveRoutes } from './routes/archive.js';
import { historyRoutes } from './routes/history.js';
import { aiRoutes } from './routes/ai.js';
import { aiThreadRoutes } from './routes/ai-threads.js';
import { fileRoutes } from './routes/files.js';
import { folderRoutes } from './routes/folders.js';
import { engineRoutes } from './routes/engines.js';
import { keyRoutes } from './routes/keys.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { openaiRoutes } from './routes/openai-compat.js';
import { trendsRoutes } from './routes/trends.js';
import { authLocalRoutes } from './routes/auth-local.js';
import { setupRoutes } from './routes/setup.js';
// Billing is retired — no plans/credits/quotas in the open-source build (see docs/OPEN_SOURCE_MIGRATION.md).

export function buildApp(): Hono {
  const app = new Hono();

  // CORS for the browser-based panel + the interactive API reference (Swagger UI
  // "try it out" calls the API directly from the browser). Default '*' (string —
  // Hono only treats the literal string '*' as a wildcard; an array never matches
  // a wildcard). Set HDSEARCH_CORS_ORIGINS to a comma list to restrict in prod.
  const corsEnv = process.env.HDSEARCH_CORS_ORIGINS;
  app.use(
    '*',
    cors({
      origin: corsEnv ? corsEnv.split(',').map((s) => s.trim()) : '*',
      allowHeaders: ['authorization', 'content-type', 'x-api-key', 'x-hd-user', 'x-hd-internal'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      maxAge: 600,
    }),
  );

  // request id + access log
  app.use('*', async (c, next) => {
    const rid = c.req.header('x-request-id') || sha1(`${Date.now()}:${Math.random()}`).slice(0, 12);
    c.header('X-Request-Id', rid);
    const t0 = Date.now();
    await next();
    log.info('request', {
      rid,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - t0,
    });
  });

  // routes
  app.route('/', metaRoutes);
  app.route('/v1/search', searchRoutes);
  app.route('/v1/crawl', crawlRoutes);
  app.route('/v1/archive', archiveRoutes);
  app.route('/v1/history', historyRoutes);
  app.route('/v1/ai/threads', aiThreadRoutes);
  app.route('/v1/ai', aiRoutes);
  app.route('/v1/files', fileRoutes);
  app.route('/v1/folders', folderRoutes);
  app.route('/v1/engines', engineRoutes);
  app.route('/v1/keys', keyRoutes);
  app.route('/v1/account', accountRoutes);
  app.route('/v1/admin', adminRoutes);
  app.route('/v1/openai', openaiRoutes);
  app.route('/v1/trends', trendsRoutes);
  app.route('/v1/auth', authLocalRoutes);
  app.route('/v1/setup', setupRoutes);

  app.notFound((c) => c.json({ error: 'not_found', path: c.req.path }, 404));

  app.onError((err, c) => {
    log.error('unhandled error', { path: c.req.path, error: err.message, stack: err.stack });
    return c.json({ error: 'internal_error', message: 'an unexpected error occurred' }, 500);
  });

  return app;
}
