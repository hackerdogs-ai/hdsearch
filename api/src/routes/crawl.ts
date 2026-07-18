// Crawl endpoint (spec §3, §6). Priority-ordered crawler fallback with optional
// S3 archival of the raw payload to SeaweedFS.
import { Hono } from 'hono';
import { requireAuth, requireScope } from '../auth.js';
import { CrawlRequestSchema } from '../types.js';
import { runCrawl } from '../engine.js';
import { checkQuota } from '../plans.js';
import { recordUsage, recordError } from '../metrics.js';
import { archiveCrawl } from '../storage.js';
import { log, errFields } from '../logger.js';
import { queryCredits } from '../credit-costs.js';
import { chargeUserCredits } from '../charge-credits.js';

export const crawlRoutes = new Hono();

crawlRoutes.use('*', requireAuth());

crawlRoutes.post('/', requireScope('crawl:read'), async (c) => {
  const p = c.get('principal');
  const parsed = CrawlRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);

  const quota = await checkQuota(p.userId, p.plan, 'crawl');
  if (!quota.allowed) return c.json({ error: 'quota_exceeded', message: quota.reason, used: quota.used, quota: quota.quota }, 402);

  try {
    const resp = await runCrawl(parsed.data, p.userId);
    if (resp.result && parsed.data.store) {
      resp.result.storageKey = await archiveCrawl(p.userId, resp.result).catch((e) => {
        log.warn('crawl archive failed', errFields(e));
        return undefined;
      });
    }
    const usedEngine = resp.enginesUsed.find((e) => e.ok)?.engine || 'basic';
    const credits = queryCredits([usedEngine], 'crawl', resp.cached);
    void recordUsage({
      userId: p.userId,
      kind: 'crawl',
      query: parsed.data.url,
      engineUsed: usedEngine,
      engines: resp.enginesUsed,
      resultCount: resp.result ? 1 : 0,
      cached: resp.cached,
      tookMs: resp.tookMs,
      apiKeyId: p.keyId,
    });
    chargeUserCredits(p, {
      sessionId: `hds:crawl:${p.userId}`,
      taskId: `crawl:${Date.now()}`,
      credits,
    });
    if (!resp.result) return c.json({ error: 'crawl_failed', message: 'no crawler returned content', enginesUsed: resp.enginesUsed }, 502);
    return c.json({ ...resp, credits });
  } catch (e) {
    log.error('crawl failed', errFields(e));
    void recordError(p.userId, parsed.data.engine, (e as Error).message);
    return c.json({ error: 'crawl_failed', message: (e as Error).message }, 502);
  }
});

crawlRoutes.get('/', requireScope('crawl:read'), async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ error: 'bad_request', message: 'url is required' }, 400);
  const p = c.get('principal');
  const parsed = CrawlRequestSchema.safeParse({
    url,
    engine: c.req.query('engine'),
    render: c.req.query('render') === 'true',
    store: c.req.query('store') === 'true',
    noCache: c.req.query('no_cache') === 'true' || c.req.query('noCache') === 'true',
    ttl: c.req.query('ttl') ? Number(c.req.query('ttl')) : undefined,
  });
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const quota = await checkQuota(p.userId, p.plan, 'crawl');
  if (!quota.allowed) return c.json({ error: 'quota_exceeded', message: quota.reason }, 402);

  const resp = await runCrawl(parsed.data, p.userId);
  const usedEngine = resp.enginesUsed.find((e) => e.ok)?.engine || 'basic';
  const credits = queryCredits([usedEngine], 'crawl', resp.cached);
  void recordUsage({
    userId: p.userId,
    kind: 'crawl',
    query: parsed.data.url,
    engineUsed: usedEngine,
    engines: resp.enginesUsed,
    resultCount: resp.result ? 1 : 0,
    cached: resp.cached,
    tookMs: resp.tookMs,
    apiKeyId: p.keyId,
  });
  chargeUserCredits(p, {
    sessionId: `hds:crawl:${p.userId}`,
    taskId: `crawl:${Date.now()}`,
    credits,
  });
  if (!resp.result) return c.json({ error: 'crawl_failed', enginesUsed: resp.enginesUsed }, 502);
  return c.json({ ...resp, credits });
});
