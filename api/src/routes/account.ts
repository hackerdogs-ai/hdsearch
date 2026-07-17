// Account / dashboard / history / plans (spec §8 LH panel pages). These feed the
// Next.js user panel: Dashboard (metrics from Timescale), Search History, and
// Plans/Upgrade. Billing actions (Stripe checkout/webhooks) live in billing.ts.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { searchHistory, dashboardMetrics, monthlyUsage } from '../metrics.js';
import { planOf } from '../plans.js';
import { buildPlanCards } from '../planCatalog.js';
import { coreGetBalance, coreGetConsumption, coreGetStats, coreListPlans, coreListPlansForCatalog } from '../coreClient.js';
import { SCHEMA, tryQuery, query } from '../db.js';
import { hasAcceptedDisclaimer, recordDisclaimer, acceptedAt } from '../consent.js';
import { CREDIT_MAP } from '../credit-costs.js';
import { issueKey, listKeys, DEFAULT_SCOPES } from '../apikeys.js';
import { log, errFields } from '../logger.js';

export const accountRoutes = new Hono();
accountRoutes.use('*', requireAuth());

// PUT /v1/account/profile — upsert the identity on login (called by the web BFF).
// The user id is taken from the authenticated principal, never the body.
const ProfileSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().max(200).optional(),
  picture: z.string().url().max(1000).optional(),
});
accountRoutes.put('/profile', async (c) => {
  const p = c.get('principal');
  const parsed = ProfileSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const { email, name, picture } = parsed.data;
  const rows = await query<any>(
    `insert into ${SCHEMA}.users (id, email, name, picture, plan, updated_at)
       values ($1,$2,$3,$4,'free', now())
     on conflict (id) do update set
       email = coalesce(excluded.email, ${SCHEMA}.users.email),
       name = coalesce(excluded.name, ${SCHEMA}.users.name),
       picture = coalesce(excluded.picture, ${SCHEMA}.users.picture),
       updated_at = now()
     returning id, email, name, picture, plan,
       (xmax = 0) as is_new`,
    [p.userId, email ?? null, name ?? null, picture ?? null],
  );
  const profile = rows[0];

  // Auto-create a default API key for new users so they can access the API immediately
  let defaultKey: string | undefined;
  if (profile?.is_new) {
    try {
      const existing = await listKeys(p.userId);
      if (!existing.length) {
        const { key } = await issueKey({
          userId: p.userId,
          name: 'Default',
          scopes: [...DEFAULT_SCOPES, 'admin:keys'],
        });
        defaultKey = key;
        log.info('auto-created default API key for new user', { userId: p.userId });
      }
    } catch (e) {
      log.warn('auto-create API key failed (non-fatal)', { userId: p.userId, ...errFields(e) });
    }
  }

  return c.json({ profile, ...(defaultKey ? { apiKey: defaultKey, apiKeyNote: 'Your default API key — store it now, it will not be shown again.' } : {}) });
});

// GET /v1/account  — profile + plan + current usage
accountRoutes.get('/', async (c) => {
  const p = c.get('principal');
  const rows = await tryQuery<any>(
    `select id, email, name, picture, plan, stripe_customer_id, created_at from ${SCHEMA}.users where id=$1`,
    [p.userId],
  );
  const [s, cr, v, disclaimerAccepted] = await Promise.all([
    monthlyUsage(p.userId, 'search'),
    monthlyUsage(p.userId, 'crawl'),
    monthlyUsage(p.userId, 'vector'),
    hasAcceptedDisclaimer(p.userId),
  ]);
  // the principal's plan is authoritative (resolved from the core role/plan); the DB row is a cache
  const plan = planOf(p.plan || rows[0]?.plan);
  return c.json({
    profile: rows[0] || { id: p.userId, plan: p.plan },
    plan,
    role: p.role || 'user',
    disclaimerAccepted,
    usage: { search: s, crawl: cr, vector: v, total: s + cr + v, quota: plan.quota },
  });
});

// GET /v1/account/disclaimer — has this user accepted? (cheap; used by the web gate)
accountRoutes.get('/disclaimer', async (c) => {
  const p = c.get('principal');
  return c.json({ accepted: await hasAcceptedDisclaimer(p.userId), at: await acceptedAt(p.userId) });
});

// POST /v1/account/accept-disclaimer — record one-time acceptance for the signed-in user
accountRoutes.post('/accept-disclaimer', async (c) => {
  const p = c.get('principal');
  const body = await c.req.json().catch(() => ({}));
  const termsVersion = typeof body?.termsVersion === 'string' ? body.termsVersion.slice(0, 40) : undefined;
  const at = await recordDisclaimer(p.userId, termsVersion);
  return c.json({ accepted: true, at, termsVersion: termsVersion ?? null });
});

// GET /v1/account/history?limit=&offset=
accountRoutes.get('/history', async (c) => {
  const p = c.get('principal');
  const limit = Number(c.req.query('limit') || 50);
  const offset = Number(c.req.query('offset') || 0);
  return c.json({ history: await searchHistory(p.userId, limit, offset) });
});

// GET /v1/account/dashboard?days=
accountRoutes.get('/dashboard', async (c) => {
  const p = c.get('principal');
  const days = Math.min(Number(c.req.query('days') || 30), 365);
  return c.json(await dashboardMetrics(p.userId, days));
});

// GET /v1/account/credits — credit balance from central core billing
accountRoutes.get('/credits', async (c) => {
  try {
    const p = c.get('principal');
    if (!p.coreJwt) return c.json({ error: 'unavailable', message: 'central billing not active' }, 503);
    const balance = await coreGetBalance(p.coreJwt);
    if (!balance) {
      log.warn('credit balance unavailable', { userId: p.userId });
      return c.json({ error: 'unavailable', message: 'could not fetch balance' }, 502);
    }
    return c.json({ balance, creditMap: CREDIT_MAP });
  } catch (e) {
    log.error('GET /credits failed', errFields(e));
    return c.json({ error: 'internal', message: 'credit balance error' }, 500);
  }
});

// GET /v1/account/credits/consumption?days=30&limit=100&offset=0 — consumption history
accountRoutes.get('/credits/consumption', async (c) => {
  try {
    const p = c.get('principal');
    if (!p.coreJwt) return c.json({ error: 'unavailable', message: 'central billing not active' }, 503);
    const days = Math.min(Number(c.req.query('days') || 30), 365);
    const limit = Math.min(Number(c.req.query('limit') || 100), 500);
    const offset = Number(c.req.query('offset') || 0);
    const page = await coreGetConsumption(p.coreJwt, { days, limit, offset });
    if (!page) {
      log.warn('credit consumption unavailable', { userId: p.userId });
      return c.json({ error: 'unavailable', message: 'could not fetch consumption' }, 502);
    }
    return c.json({ records: page.records, total: page.total, days, limit: page.limit, offset: page.offset });
  } catch (e) {
    log.error('GET /credits/consumption failed', errFields(e));
    return c.json({ error: 'internal', message: 'consumption query error' }, 500);
  }
});

// GET /v1/account/credits/stats?days=30 — aggregated usage stats
accountRoutes.get('/credits/stats', async (c) => {
  try {
    const p = c.get('principal');
    if (!p.coreJwt) return c.json({ error: 'unavailable', message: 'central billing not active' }, 503);
    const days = Math.min(Number(c.req.query('days') || 30), 365);
    const stats = await coreGetStats(p.coreJwt, { days });
    if (!stats) {
      log.warn('credit stats unavailable', { userId: p.userId });
      return c.json({ error: 'unavailable', message: 'could not fetch stats' }, 502);
    }
    return c.json({ stats, days });
  } catch (e) {
    log.error('GET /credits/stats failed', errFields(e));
    return c.json({ error: 'internal', message: 'stats query error' }, 500);
  }
});

// GET /v1/account/plans — hd-search tier cards with live price/credits from g_pdt_plans
accountRoutes.get('/plans', async (c) => {
  try {
    const p = c.get('principal');
    const corePlans = p.coreJwt ? await coreListPlans(p.coreJwt) : await coreListPlansForCatalog();
    const plans = buildPlanCards(corePlans);
    return c.json({ plans });
  } catch (e) {
    log.error('GET /plans failed', errFields(e));
    return c.json({ error: 'internal', message: 'plan catalog error' }, 500);
  }
});
