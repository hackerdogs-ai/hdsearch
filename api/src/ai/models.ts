// LLM model registry for AI Mode. Loads providers and models from:
//   1. Database (if available) — includes admin-created models
//   2. llm-providers.json (fallback) — shipped defaults
// On first startup with DB, JSON models are synced into the DB so admin edits
// and JSON defaults coexist. Dynamic providers (Ollama) are still discovered
// at runtime and merged in.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelPrice } from '../credits.js';
import { loadModelsFromDb, loadProvidersFromDb, syncJsonToDb, invalidateDbCache } from './model-registry-db.js';
import { log } from '../logger.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface LlmModel extends ModelPrice {
  id: string;
  provider: string;
  label: string;
  contextTokens: number;
  maxOutputTokens: number;
  capabilities: { tools: boolean; vision: boolean; thinking: boolean; streaming: boolean };
  accessType: 'commercial' | 'self-hosted' | 'freemium';
  requiresKeys: string[];
  defaultRank: number;
  enabled: boolean;
  plans?: string[];
}

export interface LlmProviderMeta {
  id: string;
  name: string;
  description: string;
  website: string;
  docsUrl: string;
  accessType: string;
  keyFields: string[];
  supportsStreaming: boolean;
  dynamic?: boolean;
  models: LlmModel[];
}

interface PlanAccessEntry {
  description: string;
  maxModels: number | null;
  defaultModel: string;
}

interface Registry {
  providers: any[];
  planAccess: Record<string, PlanAccessEntry>;
}

function loadRegistry(): Registry {
  const raw = readFileSync(resolve(HERE, 'llm-providers.json'), 'utf8');
  return JSON.parse(raw);
}

const registry = loadRegistry();

function buildModelsFromRegistry(): LlmModel[] {
  const models: LlmModel[] = [];
  for (const prov of registry.providers) {
    if (prov.dynamic) continue;
    for (const m of prov.models) {
      models.push({
        id: m.id,
        provider: prov.id,
        label: m.label,
        contextTokens: m.contextTokens,
        maxOutputTokens: m.maxOutputTokens,
        inputPer1M: m.inputPer1M,
        outputPer1M: m.outputPer1M,
        cachedInputPer1M: m.cachedInputPer1M ?? m.inputPer1M * 0.1,
        capabilities: m.capabilities,
        accessType: prov.accessType,
        requiresKeys: prov.keyFields,
        defaultRank: m.defaultRank,
        enabled: m.enabled !== false,
        plans: m.plans,
      });
    }
  }
  return models;
}

function buildProviderMeta(): LlmProviderMeta[] {
  return registry.providers.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    website: p.website,
    docsUrl: p.docsUrl,
    accessType: p.accessType,
    keyFields: p.keyFields,
    supportsStreaming: p.supportsStreaming,
    dynamic: p.dynamic,
    models: [],
  }));
}

// JSON-based static data (always available as fallback)
const JSON_STATIC: LlmModel[] = buildModelsFromRegistry();
const JSON_PROVIDERS: LlmProviderMeta[] = buildProviderMeta();

// Runtime state: DB models override JSON when available
let STATIC: LlmModel[] = JSON_STATIC;
let PROVIDER_META: LlmProviderMeta[] = JSON_PROVIDERS;
let DYNAMIC: LlmModel[] = [];
let dbSynced = false;

function rebuildIndex(): Map<string, LlmModel> {
  const map = new Map<string, LlmModel>();
  for (const x of [...STATIC, ...DYNAMIC]) map.set(x.id, x);
  return map;
}
let BY_ID = rebuildIndex();

export const DEFAULT_MODEL_ID = registry.planAccess.devtest?.defaultModel || 'claude-opus-4-8';

export async function refreshDynamicModels(): Promise<void> {
  try {
    const { listOllamaModels } = await import('./providers/ollama.js');
    DYNAMIC = await listOllamaModels();
  } catch {
    DYNAMIC = [];
  }
  BY_ID = rebuildIndex();
}

export async function refreshFromDb(): Promise<void> {
  if (!dbSynced) {
    await syncJsonToDb(JSON_PROVIDERS, JSON_STATIC);
    dbSynced = true;
  }
  const dbModels = await loadModelsFromDb();
  if (dbModels && dbModels.length > 0) {
    STATIC = dbModels;
    log.debug(`loaded ${dbModels.length} models from DB`);
  } else {
    STATIC = JSON_STATIC;
  }
  const dbProviders = await loadProvidersFromDb();
  if (dbProviders && dbProviders.length > 0) {
    PROVIDER_META = dbProviders;
  } else {
    PROVIDER_META = JSON_PROVIDERS;
  }
  BY_ID = rebuildIndex();
}

export function listModels(): LlmModel[] {
  return [...STATIC, ...DYNAMIC].filter((x) => x.enabled).sort((a, b) => a.defaultRank - b.defaultRank);
}

export function getModel(id: string): LlmModel | undefined {
  return BY_ID.get(id);
}

export function defaultModel(): LlmModel {
  return BY_ID.get(DEFAULT_MODEL_ID) ?? listModels()[0]!;
}

export function getProviderMeta(): LlmProviderMeta[] {
  return PROVIDER_META;
}

export function getProviderMetaById(id: string): LlmProviderMeta | undefined {
  return PROVIDER_META.find((p) => p.id === id);
}

export { invalidateDbCache } from './model-registry-db.js';
