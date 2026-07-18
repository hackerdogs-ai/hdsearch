// System Administration endpoints — super-user only. Manages default provider
// keys, system config, and the LLM provider/model registry.
// Gated by the admin:platform scope.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireScope } from '../auth.js';
import { encryptionAvailable } from '../crypto.js';
import { saveConfig } from '../runtime-config.js';
import { signupAllowed } from './auth-local.js';
import {
  ALLOWED_CACHE_TTL_SEC,
  CACHE_TTL_OPTIONS,
  getAdminCacheTtlLimits,
} from '../cache-ttl.js';
import { listDefaultKeys, upsertDefaultKey, deleteDefaultKey } from '../ai/default-keys.js';
import { getProviderMeta, listModels, invalidateDbCache, refreshFromDb } from '../ai/models.js';
import { upsertModel, deleteModel, loadAllModelsForAdmin, upsertProvider, deleteProvider } from '../ai/model-registry-db.js';
import { refreshCustomProviders, allProviderIds } from '../ai/providers/index.js';
import { smtpSettings, verifySmtp, sendMail, invalidateSmtpTransport, SMTP_PASSWORD_FIELD } from '../email.js';
import { log, errFields } from '../logger.js';

/** Provider ids compiled into the image — these can never be overwritten or deleted. */
const BUILT_IN_PROVIDER_IDS = new Set(allProviderIds());

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
  secret: z.string().min(1).max(4096),
  label: z.string().max(200).optional(),
});

// PUT /v1/admin/default-keys — upsert the default key for a provider field
adminRoutes.put('/default-keys', async (c) => {
  if (!encryptionAvailable()) return c.json({ error: 'unavailable', message: 'HDSEARCH_ENCRYPTION_KEY not configured' }, 503);
  const parsed = DefaultKeySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const p = c.get('principal');
  try {
    const meta = await upsertDefaultKey(
      parsed.data.provider.toLowerCase(),
      parsed.data.field.toLowerCase(),
      parsed.data.secret,
      parsed.data.label || null,
      p.userId,
    );
    log.info('admin: upsert default key', { provider: parsed.data.provider, field: parsed.data.field, admin: p.userId });
    return c.json({ saved: meta });
  } catch (e) {
    log.error('admin: store default key failed', errFields(e));
    return c.json({ error: 'server_error', message: (e as Error).message }, 500);
  }
});

const DeleteKeySchema = z.object({
  field: z.string().min(1).max(64),
});

// DELETE /v1/admin/default-keys — remove a default key
adminRoutes.delete('/default-keys', async (c) => {
  const parsed = DeleteKeySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const p = c.get('principal');
  const ok = await deleteDefaultKey(parsed.data.field.toLowerCase());
  if (ok) {
    log.info('admin: delete default key', { field: parsed.data.field, admin: p.userId });
    return c.json({ deleted: true });
  }
  return c.json({ error: 'not_found' }, 404);
});

// GET /v1/admin/signup — current self-registration policy
adminRoutes.get('/signup', (c) => c.json({ allowSignup: signupAllowed() }));

const SignupSchema = z.object({ allow: z.boolean() });

// PUT /v1/admin/signup — open self-registration or switch to invite-only
adminRoutes.put('/signup', async (c) => {
  const parsed = SignupSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const p = c.get('principal');
  saveConfig({ allowSignup: parsed.data.allow });
  log.info('admin: set signup policy', { allowSignup: parsed.data.allow, admin: p.userId });
  return c.json({ allowSignup: parsed.data.allow });
});

// GET /v1/admin/cache-ttl — effective default + hard-max result-cache TTL
adminRoutes.get('/cache-ttl', (c) => {
  const limits = getAdminCacheTtlLimits();
  return c.json({ ...limits, options: CACHE_TTL_OPTIONS });
});

const CacheTtlAdminSchema = z.object({
  defaultSec: z.number().int().positive(),
  maxSec: z.number().int().positive(),
});

// PUT /v1/admin/cache-ttl — set system default + hard max (default must be ≤ max)
adminRoutes.put('/cache-ttl', async (c) => {
  const parsed = CacheTtlAdminSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const { defaultSec, maxSec } = parsed.data;
  if (!ALLOWED_CACHE_TTL_SEC.has(defaultSec) || !ALLOWED_CACHE_TTL_SEC.has(maxSec)) {
    return c.json({
      error: 'bad_request',
      message: `defaultSec and maxSec must be one of: ${[...ALLOWED_CACHE_TTL_SEC].join(', ')}`,
    }, 400);
  }
  if (defaultSec > maxSec) {
    return c.json({ error: 'bad_request', message: 'defaultSec must be ≤ maxSec' }, 400);
  }
  const p = c.get('principal');
  saveConfig({ defaultCacheTtlSec: defaultSec, maxCacheTtlSec: maxSec });
  log.info('admin: set cache TTL limits', { defaultSec, maxSec, admin: p.userId });
  return c.json({ defaultSec, maxSec, options: CACHE_TTL_OPTIONS });
});

// GET /v1/admin/email — SMTP settings (never returns the password itself)
adminRoutes.get('/email', async (c) => {
  const s = await smtpSettings();
  return c.json({ smtp: s, enabled: !!(s.host && s.from) });
});

const SmtpSchema = z.object({
  host: z.string().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  user: z.string().max(255).optional(),
  from: z.string().max(320).optional(),
  secure: z.boolean().optional(),
  /** Omit to leave the stored password untouched; empty string clears it. */
  password: z.string().max(1024).optional(),
});

// PUT /v1/admin/email — save SMTP settings; the password is AES-256-GCM encrypted.
adminRoutes.put('/email', async (c) => {
  const parsed = SmtpSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const p = c.get('principal');
  const { password, ...settings } = parsed.data;
  try {
    saveConfig({ smtp: settings });
    if (typeof password === 'string') {
      if (!password) {
        await deleteDefaultKey(SMTP_PASSWORD_FIELD);
      } else {
        if (!encryptionAvailable()) {
          return c.json({ error: 'unavailable', message: 'HDSEARCH_ENCRYPTION_KEY not configured' }, 503);
        }
        await upsertDefaultKey('smtp', SMTP_PASSWORD_FIELD, password, 'SMTP password', p.userId);
      }
    }
    invalidateSmtpTransport();
    log.info('admin: smtp settings saved', { host: settings.host, admin: p.userId });
    return c.json({ smtp: await smtpSettings() });
  } catch (e) {
    log.error('admin: smtp save failed', errFields(e));
    return c.json({ error: 'server_error', message: (e as Error).message }, 500);
  }
});

const SmtpTestSchema = z.object({ to: z.string().email().optional() });

// POST /v1/admin/email/test — verify the connection, optionally sending a test message.
adminRoutes.post('/email/test', async (c) => {
  const parsed = SmtpTestSchema.safeParse(await c.req.json().catch(() => ({})));
  const to = parsed.success ? parsed.data.to : undefined;
  const v = await verifySmtp();
  if (!v.ok) return c.json({ ok: false, error: v.error }, 200);
  if (!to) return c.json({ ok: true, message: 'SMTP connection verified.' });
  const sent = await sendMail({
    to,
    subject: 'hdsearch test email',
    text: 'This is a test message from your hdsearch instance. Email is configured correctly.',
  });
  return c.json(
    sent
      ? { ok: true, message: `Test email sent to ${to}.` }
      : { ok: false, error: 'Connection verified but the message could not be sent — check the logs.' },
  );
});

// GET /v1/admin/llm-providers — registry metadata (no secrets)
adminRoutes.get('/llm-providers', async (c) => {
  await refreshFromDb();
  return c.json({ providers: getProviderMeta() });
});

// Admin-defined providers are addressed as OpenAI-compatible endpoints and stored
// in hd_search.llm_providers (source='admin'), alongside the models that FK to them.
// Only admin:platform can write.
const ProviderSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/, 'id must be lowercase alphanumeric, - or _'),
  name: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  website: z.string().max(500).optional(),
  docsUrl: z.string().max(500).optional(),
  baseUrl: z.string().url().max(500),
  keyField: z.string().min(1).max(64).optional(),
  accessType: z.enum(['commercial', 'self-hosted', 'freemium']).default('commercial'),
  supportsStreaming: z.boolean().default(true),
});

// POST /v1/admin/llm-providers — add or update a custom provider (persisted to S3)
adminRoutes.post('/llm-providers', async (c) => {
  const parsed = ProviderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const p = c.get('principal');
  if (BUILT_IN_PROVIDER_IDS.has(parsed.data.id)) {
    return c.json({ error: 'bad_request', message: `'${parsed.data.id}' is a built-in provider` }, 400);
  }
  try {
    await upsertProvider({ ...parsed.data, keyField: parsed.data.keyField || parsed.data.id }, p.userId);
    await refreshCustomProviders();
    await refreshFromDb();
    log.info('admin: upsert LLM provider', { provider: parsed.data.id, admin: p.userId });
    return c.json({ saved: parsed.data.id, providers: getProviderMeta() });
  } catch (e) {
    log.error('admin: upsert provider failed', errFields(e));
    return c.json({ error: 'server_error', message: (e as Error).message }, 500);
  }
});

// DELETE /v1/admin/llm-providers/:id — remove a custom provider
adminRoutes.delete('/llm-providers/:id', async (c) => {
  const id = c.req.param('id');
  const p = c.get('principal');
  if (BUILT_IN_PROVIDER_IDS.has(id)) {
    return c.json({ error: 'bad_request', message: `'${id}' is a built-in provider and cannot be removed` }, 400);
  }
  try {
    const ok = await deleteProvider(id);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    await refreshCustomProviders();
    await refreshFromDb();
    log.info('admin: delete LLM provider', { provider: id, admin: p.userId });
    return c.json({ deleted: true, providers: getProviderMeta() });
  } catch (e) {
    log.error('admin: delete provider failed', errFields(e));
    return c.json({ error: 'server_error', message: (e as Error).message }, 500);
  }
});

// GET /v1/admin/llm-models — list all models (includes disabled + source tag)
adminRoutes.get('/llm-models', async (c) => {
  const all = await loadAllModelsForAdmin();
  if (all) return c.json({ models: all });
  // DB unavailable → fall back to the in-memory (enabled-only) registry.
  await refreshFromDb();
  return c.json({ models: listModels().map((m) => ({ ...m, source: 'json' })) });
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
});

// POST /v1/admin/llm-models — create or update a model (source='admin')
adminRoutes.post('/llm-models', async (c) => {
  const parsed = ModelSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const p = c.get('principal');
  try {
    await upsertModel({ ...parsed.data, plans: [], adminUserId: p.userId });
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
