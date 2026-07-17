// AI thread persistence endpoints (signed-in users). Mirrors routes/history.ts:
// GET lists the 3-day Redis index; per-thread GET/PATCH/DELETE operate on the
// blob; DELETE / wipes the whole set. Demo/anonymous get empty responses.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireScope, isDemoUser } from '../auth.js';
import {
  listAiThreadIndex,
  loadAiThread,
  renameAiThread,
  deleteAiThread,
  clearAiThreads,
  aiThreadTierFor,
} from '../ai-threads.js';

export const aiThreadRoutes = new Hono();

aiThreadRoutes.use('*', requireAuth());

aiThreadRoutes.get('/', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  if (isDemoUser(p.userId)) return c.json({ entries: [], tier: 'browser' });
  const entries = await listAiThreadIndex(p.userId, Number(c.req.query('limit')) || 200);
  return c.json({ entries, tier: aiThreadTierFor(p.plan) });
});

aiThreadRoutes.get('/:id', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  if (isDemoUser(p.userId)) return c.json({ error: 'not_found' }, 404);
  const blob = await loadAiThread(p.userId, c.req.param('id')!);
  if (!blob) return c.json({ error: 'not_found' }, 404);
  return c.json(blob);
});

const PatchBody = z.object({ title: z.string().min(1).max(200) });

aiThreadRoutes.patch('/:id', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  if (isDemoUser(p.userId)) return c.json({ error: 'forbidden' }, 403);
  const parsed = PatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const ok = await renameAiThread(p.userId, c.req.param('id')!, parsed.data.title.trim());
  if (!ok) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

aiThreadRoutes.delete('/:id', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  await deleteAiThread(p.userId, c.req.param('id')!);
  return c.json({ ok: true });
});

aiThreadRoutes.delete('/', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  await clearAiThreads(p.userId);
  return c.json({ ok: true });
});
