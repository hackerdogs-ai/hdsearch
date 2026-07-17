// System Administration endpoints — super-user only. Manages default provider
// keys (per plan tier), system config, and the LLM provider registry.
// Gated by the admin:platform scope.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireScope } from '../auth.js';
import { encryptionAvailable } from '../crypto.js';
import { listDefaultKeys, upsertDefaultKey, deleteDefaultKey } from '../ai/default-keys.js';
import { getProviderMeta, getPlanAccess, listModels, invalidateDbCache, refreshFromDb } from '../ai/models.js';
import { upsertModel, deleteModel } from '../ai/model-registry-db.js';
import { log, errFields } from '../logger.js';

export const adminRoutes = new Hono();
adminRoutes.use('*', requireAuth());
adminRoutes.use('*', requireScope('admin:platform'));

// GET /v1/admin/default-keys — list all system-level default provider keys
adminRoutes.get('/default-keys', async (c) => {
  return c.json({ keys: await listDefaultKeys() });
});

const DefaultKeySchema = z.object({
  provider: z.string().min(1).max(64),
  field: z.string().min(1).max(64),
  planId: z.enum(['free', 'dev', 'devtest', 'production', 'enterprise']),
  secret: z.string().min(1).max(4096),
  label: z.string().max(200).optional(),
});

// PUT /v1/admin/default-keys — upsert a default key for a provider+plan
adminRoutes.put('/default-keys', async (c) => {
  if (!encryptionAvailable()) return c.json({ error: 'unavailable', message: 'HDSEARCH_ENCRYPTION_KEY not configured' }, 503);
  const parsed = DefaultKeySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const p = c.get('principal');
  try {
    const meta = await upsertDefaultKey(
      parsed.data.provider.toLowerCase(),
      parsed.data.field.toLowerCase(),
      parsed.data.planId,
      parsed.data.secret,
      parsed.data.label || null,
      p.userId,
    );
    log.info('admin: upsert default key', { provider: parsed.data.provider, plan: parsed.data.planId, admin: p.userId });
    return c.json({ saved: meta });
  } catch (e) {
    log.error('admin: store default key failed', errFields(e));
    return c.json({ error: 'server_error', message: (e as Error).message }, 500);
  }
});

const DeleteKeySchema = z.object({
  field: z.string().min(1).max(64),
  planId: z.enum(['free', 'dev', 'devtest', 'production', 'enterprise']),
});

// DELETE /v1/admin/default-keys — remove a default key
adminRoutes.delete('/default-keys', async (c) => {
  const parsed = DeleteKeySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const p = c.get('principal');
  const ok = await deleteDefaultKey(parsed.data.field.toLowerCase(), parsed.data.planId);
  if (ok) {
    log.info('admin: delete default key', { field: parsed.data.field, plan: parsed.data.planId, admin: p.userId });
    return c.json({ deleted: true });
  }
  return c.json({ error: 'not_found' }, 404);
});

// GET /v1/admin/llm-providers — registry metadata (no secrets)
adminRoutes.get('/llm-providers', async (_c) => {
  return _c.json({ providers: getProviderMeta(), planAccess: getPlanAccess() });
});

// GET /v1/admin/llm-models — list all models (includes disabled)
adminRoutes.get('/llm-models', async (_c) => {
  await refreshFromDb();
  return _c.json({ models: listModels() });
});

const ModelSchema = z.object({
  id: z.string().min(1).max(128),
  providerId: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  contextTokens: z.number().int().min(1).default(128000),
  maxOutputTokens: z.number().int().min(1).default(8192),
  inputPer1M: z.number().min(0).default(0),
  outputPer1M: z.number().min(0).default(0),
  cachedInputPer1M: z.number().min(0).default(0),
  capabilities: z.object({
    tools: z.boolean().default(false),
    vision: z.boolean().default(false),
    thinking: z.boolean().default(false),
    streaming: z.boolean().default(true),
  }).default({}),
  defaultRank: z.number().int().default(100),
  enabled: z.boolean().default(true),
  plans: z.array(z.string()).default([]),
});

// POST /v1/admin/llm-models — create or update a model (source='admin')
adminRoutes.post('/llm-models', async (c) => {
  const parsed = ModelSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const p = c.get('principal');
  try {
    await upsertModel({ ...parsed.data, adminUserId: p.userId });
    invalidateDbCache();
    await refreshFromDb();
    log.info('admin: upsert model', { model: parsed.data.id, provider: parsed.data.providerId, admin: p.userId });
    return c.json({ saved: parsed.data.id });
  } catch (e) {
    log.error('admin: upsert model failed', errFields(e));
    return c.json({ error: 'server_error', message: (e as Error).message }, 500);
  }
});

// DELETE /v1/admin/llm-models/:id — remove a model
adminRoutes.delete('/llm-models/:id', async (c) => {
  const id = c.req.param('id');
  const p = c.get('principal');
  try {
    const ok = await deleteModel(id);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    invalidateDbCache();
    await refreshFromDb();
    log.info('admin: delete model', { model: id, admin: p.userId });
    return c.json({ deleted: true });
  } catch (e) {
    log.error('admin: delete model failed', errFields(e));
    return c.json({ error: 'server_error', message: (e as Error).message }, 500);
  }
});
