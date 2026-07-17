// Search-history endpoints (signed-in users). GET lists the 3-day Redis history;
// DELETE clears it. Recording happens automatically on /v1/search for non-demo
// users, so there's no manual record endpoint.
import { Hono } from 'hono';
import { requireAuth, requireScope, isDemoUser } from '../auth.js';
import { listHistory, clearHistory, historyTierFor } from '../history.js';

export const historyRoutes = new Hono();

historyRoutes.use('*', requireAuth());

historyRoutes.get('/', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  if (isDemoUser(p.userId)) return c.json({ entries: [], tier: 'browser' });
  const entries = await listHistory(p.userId, Number(c.req.query('limit')) || 100);
  return c.json({ entries, tier: historyTierFor(p.plan) });
});

historyRoutes.delete('/', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  await clearHistory(p.userId);
  return c.json({ ok: true });
});
