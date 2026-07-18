// File-backed runtime configuration for infra/provider ENDPOINTS — set by the
// first-run setup wizard (or the Settings page) without editing env or rebuilding.
//
// Why a file (not the DB): the database connection itself is one of these values,
// so it can't live in the database. The file sits next to the secrets file (a
// shared Docker volume), is read at startup, and is overlaid onto env config.
//
// Precedence when resolving a value:  config file  →  env var  →  built-in default.
// Changing an infra endpoint takes effect on the next API restart (reconnect).
//
// NOTE: standalone module (no import from env.ts) to avoid a circular import.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function pkgRoot(): string {
  let dir = HERE;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(HERE, '..');
}

// Same directory as the secrets file (a shared, persisted volume in Docker).
const CONFIG_FILE =
  process.env.HDSEARCH_CONFIG_FILE ||
  (process.env.HDSEARCH_SECRETS_FILE
    ? resolve(dirname(process.env.HDSEARCH_SECRETS_FILE), 'hdsearch-config.json')
    : resolve(pkgRoot(), '..', '.hdsearch-config.json'));

/** One service's connection settings. `url` is the primary field; some services
 *  carry extra credentials. Anything unset falls back to env → default. */
export interface ServiceConfig {
  url?: string;
  accessKey?: string;
  secretKey?: string;
  provider?: string; // embeddings only: 'minilm' | 'openai' | 'none'
}

export interface RuntimeConfig {
  database?: ServiceConfig;
  redis?: ServiceConfig;
  s3?: ServiceConfig;
  embeddings?: ServiceConfig;
  searxng?: ServiceConfig;
  openserp?: ServiceConfig;
  crawl4ai?: ServiceConfig;
  browserless?: ServiceConfig;
  tor?: ServiceConfig;
  /** Set true once the wizard is finished so it isn't shown again. */
  setupComplete?: boolean;
  /** Admin toggle for open sign-up. Unset = fall back to env / built-in default
   *  (open). false = invite-only (admin creates accounts). */
  allowSignup?: boolean;
  /** Default Redis result-cache TTL (seconds) when a request omits `ttl`
   *  or requests a value above the hard max. */
  defaultCacheTtlSec?: number;
  /** Hard max Redis result-cache TTL (seconds) for API/`ttl` and account prefs. */
  maxCacheTtlSec?: number;
}

/** The service keys the wizard/settings can configure, in display order. */
export const SERVICE_KEYS = [
  'database', 'redis', 's3', 'embeddings',
  'searxng', 'openserp', 'crawl4ai', 'browserless', 'tor',
] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

let cache: RuntimeConfig | null = null;

export function loadConfig(): RuntimeConfig {
  if (cache) return cache;
  try {
    cache = existsSync(CONFIG_FILE) ? (JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) as RuntimeConfig) : {};
  } catch {
    cache = {};
  }
  return cache;
}

/** Merge and persist. Returns the merged config. Throws if the file can't be written. */
export function saveConfig(patch: RuntimeConfig): RuntimeConfig {
  const current = loadConfig();
  const merged: RuntimeConfig = { ...current };
  for (const k of SERVICE_KEYS) {
    if (patch[k]) merged[k] = { ...(current[k] || {}), ...patch[k] };
  }
  if (typeof patch.setupComplete === 'boolean') merged.setupComplete = patch.setupComplete;
  if (typeof patch.allowSignup === 'boolean') merged.allowSignup = patch.allowSignup;
  if (typeof patch.defaultCacheTtlSec === 'number') merged.defaultCacheTtlSec = patch.defaultCacheTtlSec;
  if (typeof patch.maxCacheTtlSec === 'number') merged.maxCacheTtlSec = patch.maxCacheTtlSec;
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
  cache = merged;
  return merged;
}

export function configFilePath(): string {
  return CONFIG_FILE;
}

export function isSetupComplete(): boolean {
  return !!loadConfig().setupComplete;
}

/** Admin's persisted sign-up policy, or undefined if never set (use env/default). */
export function getAllowSignup(): boolean | undefined {
  return loadConfig().allowSignup;
}

/** Admin's persisted default result-cache TTL (seconds), or undefined if unset. */
export function getDefaultCacheTtlSec(): number | undefined {
  const v = loadConfig().defaultCacheTtlSec;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Admin's persisted hard-max result-cache TTL (seconds), or undefined if unset. */
export function getMaxCacheTtlSec(): number | undefined {
  const v = loadConfig().maxCacheTtlSec;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Resolve a value: config-file → env → default. */
export function pick(fileVal: string | undefined, envVal: string | undefined, def: string): string {
  const f = fileVal?.trim();
  if (f) return f;
  const e = envVal?.trim();
  if (e) return e;
  return def;
}
