// DB-backed LLM model registry with JSON fallback. On startup, tries to load
// providers+models from Postgres. If DB is unavailable, falls back to
// llm-providers.json. Admin-created models (source='admin') only live in DB.
// Cache TTL = 60s so admin changes propagate without restart.
import { SCHEMA, query, tryQuery, dbAvailable } from '../db.js';
import { log, errFields } from '../logger.js';
import type { LlmModel, LlmProviderMeta } from './models.js';

interface DbProvider {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  docs_url: string | null;
  access_type: string;
  key_fields: string[];
  supports_streaming: boolean;
  dynamic: boolean;
  enabled: boolean;
}

interface DbModel {
  id: string;
  provider_id: string;
  label: string;
  context_tokens: number;
  max_output_tokens: number;
  input_per_1m: number;
  output_per_1m: number;
  cached_input_per_1m: number;
  capabilities: { tools: boolean; vision: boolean; thinking: boolean; streaming: boolean };
  default_rank: number;
  enabled: boolean;
  plans: string[];
  source: string;
}

let providerCache: { data: LlmProviderMeta[]; at: number } | null = null;
let modelCache: { data: LlmModel[]; at: number } | null = null;
const TTL = 60_000;

export async function loadProvidersFromDb(): Promise<LlmProviderMeta[] | null> {
  if (providerCache && Date.now() - providerCache.at < TTL) return providerCache.data;
  if (!dbAvailable()) return null;
  try {
    const rows = await tryQuery<DbProvider>(
      `SELECT id, name, description, website, docs_url, access_type,
              key_fields, supports_streaming, dynamic, enabled
       FROM ${SCHEMA}.llm_providers WHERE enabled = true ORDER BY name`,
      [],
    );
    if (!rows.length) return null;
    const providers: LlmProviderMeta[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description || '',
      website: r.website || '',
      docsUrl: r.docs_url || '',
      accessType: r.access_type,
      keyFields: Array.isArray(r.key_fields) ? r.key_fields : [],
      supportsStreaming: r.supports_streaming,
      dynamic: r.dynamic,
      models: [],
    }));
    providerCache = { data: providers, at: Date.now() };
    return providers;
  } catch (e) {
    log.debug('loadProvidersFromDb failed, falling back to JSON', errFields(e));
    return null;
  }
}

export async function loadModelsFromDb(): Promise<LlmModel[] | null> {
  if (modelCache && Date.now() - modelCache.at < TTL) return modelCache.data;
  if (!dbAvailable()) return null;
  try {
    const rows = await tryQuery<DbModel & { prov_key_fields: string[]; prov_access_type: string }>(
      `SELECT m.id, m.provider_id, m.label, m.context_tokens, m.max_output_tokens,
              m.input_per_1m, m.output_per_1m, m.cached_input_per_1m,
              m.capabilities, m.default_rank, m.enabled, m.plans, m.source,
              p.key_fields AS prov_key_fields, p.access_type AS prov_access_type
       FROM ${SCHEMA}.llm_models m
       JOIN ${SCHEMA}.llm_providers p ON p.id = m.provider_id
       WHERE m.enabled = true AND p.enabled = true
       ORDER BY m.default_rank`,
      [],
    );
    if (!rows.length) return null;
    const models: LlmModel[] = rows.map((r) => ({
      id: r.id,
      provider: r.provider_id,
      label: r.label,
      contextTokens: Number(r.context_tokens),
      maxOutputTokens: Number(r.max_output_tokens),
      inputPer1M: Number(r.input_per_1m),
      outputPer1M: Number(r.output_per_1m),
      cachedInputPer1M: Number(r.cached_input_per_1m),
      capabilities: r.capabilities || { tools: false, vision: false, thinking: false, streaming: true },
      accessType: r.prov_access_type as any,
      requiresKeys: Array.isArray(r.prov_key_fields) ? r.prov_key_fields : [],
      defaultRank: r.default_rank,
      enabled: r.enabled,
      plans: Array.isArray(r.plans) ? r.plans : [],
    }));
    modelCache = { data: models, at: Date.now() };
    return models;
  } catch (e) {
    log.debug('loadModelsFromDb failed, falling back to JSON', errFields(e));
    return null;
  }
}

export async function syncJsonToDb(
  providers: LlmProviderMeta[],
  models: LlmModel[],
): Promise<void> {
  if (!dbAvailable()) return;
  try {
    for (const p of providers) {
      await query(
        `INSERT INTO ${SCHEMA}.llm_providers (id, name, description, website, docs_url, access_type, key_fields, supports_streaming, dynamic, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'json')
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description,
           website = EXCLUDED.website, docs_url = EXCLUDED.docs_url,
           access_type = EXCLUDED.access_type, key_fields = EXCLUDED.key_fields,
           supports_streaming = EXCLUDED.supports_streaming, dynamic = EXCLUDED.dynamic,
           updated_at = now()
         WHERE ${SCHEMA}.llm_providers.id = EXCLUDED.id`,
        [p.id, p.name, p.description, p.website, p.docsUrl, p.accessType,
         JSON.stringify(p.keyFields), p.supportsStreaming, p.dynamic || false],
      );
    }
    for (const m of models) {
      await query(
        `INSERT INTO ${SCHEMA}.llm_models (id, provider_id, label, context_tokens, max_output_tokens,
           input_per_1m, output_per_1m, cached_input_per_1m, capabilities, default_rank, enabled, plans, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'json')
         ON CONFLICT (id) DO UPDATE SET
           provider_id = EXCLUDED.provider_id, label = EXCLUDED.label,
           context_tokens = EXCLUDED.context_tokens, max_output_tokens = EXCLUDED.max_output_tokens,
           input_per_1m = EXCLUDED.input_per_1m, output_per_1m = EXCLUDED.output_per_1m,
           cached_input_per_1m = EXCLUDED.cached_input_per_1m, capabilities = EXCLUDED.capabilities,
           default_rank = EXCLUDED.default_rank, enabled = EXCLUDED.enabled, plans = EXCLUDED.plans,
           updated_at = now()
         WHERE ${SCHEMA}.llm_models.source = 'json'`,
        [m.id, m.provider, m.label, m.contextTokens, m.maxOutputTokens,
         m.inputPer1M, m.outputPer1M, m.cachedInputPer1M,
         JSON.stringify(m.capabilities), m.defaultRank, m.enabled, JSON.stringify(m.plans || [])],
      );
    }
    invalidateDbCache();
    log.info(`synced ${providers.length} providers and ${models.length} models to DB`);
  } catch (e) {
    log.warn('syncJsonToDb failed (non-fatal, JSON used as fallback)', errFields(e));
  }
}

export async function upsertModel(model: {
  id: string;
  providerId: string;
  label: string;
  contextTokens: number;
  maxOutputTokens: number;
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M: number;
  capabilities: any;
  defaultRank: number;
  enabled: boolean;
  plans: string[];
  adminUserId: string;
}): Promise<void> {
  await query(
    `INSERT INTO ${SCHEMA}.llm_models (id, provider_id, label, context_tokens, max_output_tokens,
       input_per_1m, output_per_1m, cached_input_per_1m, capabilities, default_rank, enabled, plans, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'admin',$13)
     ON CONFLICT (id) DO UPDATE SET
       provider_id = EXCLUDED.provider_id, label = EXCLUDED.label,
       context_tokens = EXCLUDED.context_tokens, max_output_tokens = EXCLUDED.max_output_tokens,
       input_per_1m = EXCLUDED.input_per_1m, output_per_1m = EXCLUDED.output_per_1m,
       cached_input_per_1m = EXCLUDED.cached_input_per_1m, capabilities = EXCLUDED.capabilities,
       default_rank = EXCLUDED.default_rank, enabled = EXCLUDED.enabled, plans = EXCLUDED.plans,
       source = 'admin', created_by = EXCLUDED.created_by, updated_at = now()`,
    [model.id, model.providerId, model.label, model.contextTokens, model.maxOutputTokens,
     model.inputPer1M, model.outputPer1M, model.cachedInputPer1M,
     JSON.stringify(model.capabilities), model.defaultRank, model.enabled,
     JSON.stringify(model.plans), model.adminUserId],
  );
  invalidateDbCache();
}

export async function deleteModel(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM ${SCHEMA}.llm_models WHERE id = $1 RETURNING id`,
    [id],
  );
  invalidateDbCache();
  return rows.length > 0;
}

export function invalidateDbCache(): void {
  providerCache = null;
  modelCache = null;
}
