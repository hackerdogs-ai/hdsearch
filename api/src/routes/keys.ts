// Key management for the user panel (spec §8 Account → API Keys, Integrations).
// Two kinds:
//   • /v1/keys/api        — sk-hds-... keys for calling THIS service.
//   • /v1/keys/providers  — per-user upstream provider credentials (encrypted),
//                           e.g. your own SerpAPI / Brave key (spec §7).
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireScope } from '../auth.js';
import { issueKey, listKeys, revokeKey, DEFAULT_SCOPES, type Scope } from '../apikeys.js';
import { upsertUserKey, listUserKeys, deleteUserKey } from '../keystore.js';
import { encryptionAvailable } from '../crypto.js';
import { getProvider } from '../providers/index.js';
import { log, errFields } from '../logger.js';

export const keyRoutes = new Hono();
keyRoutes.use('*', requireAuth());

// ---- API keys (sk-hds-) ------------------------------------------------------
keyRoutes.get('/api', async (c) => {
  const p = c.get('principal');
  return c.json({ keys: await listKeys(p.userId) });
});

const IssueSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.enum(['search:read', 'crawl:read', 'vector:read', 'admin:keys'])).optional(),
  rateLimitPerMin: z.number().int().min(1).max(6000).optional(),
});

keyRoutes.post('/api', requireScope('admin:keys'), async (c) => {
  const p = c.get('principal');
  const parsed = IssueSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  try {
    const { key, record } = await issueKey({
      userId: p.userId,
      name: parsed.data.name,
      scopes: (parsed.data.scopes as Scope[]) || DEFAULT_SCOPES,
      rateLimitPerMin: parsed.data.rateLimitPerMin,
    });
    // full secret returned exactly once
    return c.json({ key, record, note: 'Store this key now — it will not be shown again.' }, 201);
  } catch (e) {
    log.error('issue api key failed', errFields(e));
    return c.json({ error: 'server_error', message: (e as Error).message }, 500);
  }
});

keyRoutes.delete('/api/:id', requireScope('admin:keys'), async (c) => {
  const p = c.get('principal');
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'bad_request', message: 'id required' }, 400);
  const ok = await revokeKey(p.userId, id);
  return ok ? c.json({ revoked: true }) : c.json({ error: 'not_found' }, 404);
});

// ---- provider credentials (encrypted upstream keys) --------------------------
keyRoutes.get('/providers', async (c) => {
  const p = c.get('principal');
  return c.json({ encryptionAvailable: encryptionAvailable(), keys: await listUserKeys(p.userId) });
});

const ProviderKeySchema = z.object({
  provider: z.string().min(1).max(64),
  /** the credential field, e.g. 'serpapi' or 'google_cse_cx' (defaults to provider id) */
  field: z.string().min(1).max(64).optional(),
  secret: z.string().min(1).max(4096),
});

keyRoutes.put('/providers', async (c) => {
  const p = c.get('principal');
  if (!encryptionAvailable()) return c.json({ error: 'unavailable', message: 'HDSEARCH_ENCRYPTION_KEY not configured' }, 503);
  const parsed = ProviderKeySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const provider = parsed.data.provider.toLowerCase();
  const field = (parsed.data.field || provider).toLowerCase();
  // light validation: warn (don't block) if provider id is unknown
  const known = !!getProvider(provider);
  try {
    const meta = await upsertUserKey(p.userId, provider, field, parsed.data.secret);
    return c.json({ saved: meta, knownProvider: known });
  } catch (e) {
    log.error('store provider key failed', errFields(e));
    return c.json({ error: 'server_error', message: (e as Error).message }, 500);
  }
});

keyRoutes.delete('/providers/:field', async (c) => {
  const p = c.get('principal');
  const ok = await deleteUserKey(p.userId, c.req.param('field').toLowerCase());
  return ok ? c.json({ deleted: true }) : c.json({ error: 'not_found' }, 404);
});
