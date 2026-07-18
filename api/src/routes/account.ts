// Account / dashboard / history (spec §8 LH panel pages). These feed the
// Next.js user panel: Dashboard (metrics from Timescale) and Search History.
// No plans/quotas/credits — this build is free and self-hosted.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { searchHistory, dashboardMetrics, monthlyUsage } from '../metrics.js';
import { SCHEMA, tryQuery, query } from '../db.js';
import { hasAcceptedDisclaimer, recordDisclaimer, acceptedAt } from '../consent.js';
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

// GET /v1/account  — profile + current usage
accountRoutes.get('/', async (c) => {
  const p = c.get('principal');
  const rows = await tryQuery<any>(
    `select id, email, name, picture, created_at from ${SCHEMA}.users where id=$1`,
    [p.userId],
  );
  const [s, cr, v, disclaimerAccepted] = await Promise.all([
    monthlyUsage(p.userId, 'search'),
    monthlyUsage(p.userId, 'crawl'),
    monthlyUsage(p.userId, 'vector'),
    hasAcceptedDisclaimer(p.userId),
  ]);
  return c.json({
    profile: rows[0] || { id: p.userId },
    role: p.role || 'user',
    disclaimerAccepted,
    usage: { search: s, crawl: cr, vector: v, total: s + cr + v },
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
