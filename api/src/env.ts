// Config loader for hd-search. Reads from process.env first, then an optional
// shared env file (HDSEARCH_ENV_FILE or ./hd-search.env at the service root).
// Real process env always wins (container overrides). Matches hd-feeds style.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveSecret } from './secrets.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// Walk up to the service root (the dir that holds package.json). Robust whether
// we run from src/ (tsx) or dist/src/ (compiled).
function findServiceRoot(): string {
  let dir = HERE;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(HERE, '..');
}
const ROOT = findServiceRoot();

function loadEnvFile(p: string) {
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2]!.trim();
    // strip a trailing inline comment (space + #...), but only on UNquoted values
    if (!/^["']/.test(val)) val = val.replace(/\s+#.*$/, '').trim();
    val = val.replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile(resolve(ROOT, process.env.HDSEARCH_ENV_FILE || 'hd-search.env'));
// also try the api-local .env for convenience in dev
loadEnvFile(resolve(ROOT, '.env'));

const e = process.env;
const int = (v: string | undefined, d: number) => (v && !Number.isNaN(+v) ? +v : d);
const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(v));

export type RunMode = 'dev' | 'prod';

export const SERVICE_ROOT = ROOT;

export const env = {
  // ---- server ----
  port: int(e.HDSEARCH_API_PORT, 8791),
  host: e.HDSEARCH_API_HOST || '0.0.0.0',
  runMode: ((e.RUN_MODE || 'prod').toLowerCase() === 'dev' ? 'dev' : 'prod') as RunMode,
  logLevel: (e.HDSEARCH_LOG_LEVEL || 'info').toLowerCase(),

  // ---- redis (shared hd-redis Redis Stack + RediSearch) ----
  // hd-search's general keyspace lives on a DEDICATED logical db (db 5) to stay isolated
  // from the other services sharing hd-redis: db 0 (core), db 1 (hd-feeds), db 3/4
  // (celery), db 15 (worldmonitor). Key prefix `hds:` adds a second layer of isolation.
  redisUrl: e.HDSEARCH_REDIS_URL || e.REDIS_URL || 'redis://127.0.0.1:6379/5',
  // RediSearch can ONLY create indexes on db 0 ("Cannot create index on db != 0"), so the
  // vector index + its `hds:vec:` docs live on db 0 (prefix-isolated). Defaults to the same
  // host/port as redisUrl but db 0; override with HDSEARCH_VECTOR_REDIS_URL.
  vectorRedisUrl:
    e.HDSEARCH_VECTOR_REDIS_URL ||
    (e.HDSEARCH_REDIS_URL || e.REDIS_URL || 'redis://127.0.0.1:6379/5').replace(/\/\d+$/, '/0'),
  keyPrefix: e.HDSEARCH_REDIS_PREFIX || 'hds',

  // ---- postgres / timescale (per-user encrypted provider keys, history, metrics) ----
  pgUrl:
    e.HDSEARCH_DATABASE_URL ||
    e.DATABASE_URL ||
    'postgres://postgres:postgres@127.0.0.1:5432/hd_search',
  pgSchema: e.HDSEARCH_PG_SCHEMA || 'hd_search',

  // ---- s3-compatible store (seaweedfs): raw crawl payloads, large blobs ----
  s3Endpoint: e.HDSEARCH_S3_ENDPOINT || e.STORAGE_AWS_ENDPOINT_URL || 'http://127.0.0.1:8333',
  s3Region: e.STORAGE_AWS_REGION || 'us-east-1',
  s3Key: e.STORAGE_AWS_ACCESS_KEY_ID || 'admin',
  s3Secret: e.STORAGE_AWS_SECRET_ACCESS_KEY || 'key',
  bucket: e.HDSEARCH_BUCKET || 'hd-search',
  prefix: e.HDSEARCH_PREFIX ?? 'hd-search',

  // ---- encryption (AES-256-GCM) for stored provider credentials ----
  // 32-byte key as hex. Auto-generated + persisted to the shared secrets file if
  // not provided via env, so encryption works out of the box (set it explicitly in
  // production and back it up — losing it makes stored provider keys unreadable).
  encryptionKey: resolveSecret('encryptionKey', e.HDSEARCH_ENCRYPTION_KEY, 32),

  // ---- internal trust secret for the first-party web BFF (X-HD-Internal) ----
  // Auto-generated + persisted (shared with the web app via the same file) so the
  // panel can call the API without manual configuration.
  internalSecret: resolveSecret('internalSecret', e.HDSEARCH_INTERNAL_SECRET, 32),

  // ---- priority list (CSV; priority number is the first column) ----
  priorityCsvPath: resolve(ROOT, e.HDSEARCH_PRIORITY_CSV || 'src/priorities.csv'),
  priorityReloadSec: int(e.HDSEARCH_PRIORITY_RELOAD_SEC, 300),

  // ---- engine behaviour ----
  defaultRateLimitPerMin: int(e.HDSEARCH_API_DEFAULT_RATE_LIMIT, 120),
  // default cache TTL when a provider does not declare its own (seconds)
  defaultCacheTtlSec: int(e.HDSEARCH_DEFAULT_CACHE_TTL, 900),
  providerTimeoutMs: int(e.HDSEARCH_PROVIDER_TIMEOUT_MS, 10000),
  providerRetries: int(e.HDSEARCH_PROVIDER_RETRIES, 1),
  maxResults: int(e.HDSEARCH_MAX_RESULTS, 50),
  // fan out to N providers in parallel and merge (mode=aggregate).
  aggregateFanout: int(e.HDSEARCH_AGGREGATE_FANOUT, 5),
  // aggregate mode soft deadline: return whatever's ready by this time instead of
  // blocking on the slowest provider (bounds tail latency on the home page).
  aggregateDeadlineMs: int(e.HDSEARCH_AGGREGATE_DEADLINE_MS, 6000),

  // ---- vector search ----
  vectorTtlSec: int(e.HDSEARCH_VECTOR_TTL, 86400), // 24h default per spec
  vectorDim: int(e.HDSEARCH_VECTOR_DIM, 384), // MiniLM L6 = 384
  vectorIndex: e.HDSEARCH_VECTOR_INDEX || 'hds:vec:idx',
  // embeddings provider: 'minilm' (self-hosted, default) | 'openai' | 'none'
  embeddingsProvider: (e.HDSEARCH_EMBEDDINGS_PROVIDER || 'minilm').toLowerCase(),
  embeddingsUrl: e.HDSEARCH_EMBEDDINGS_URL || 'http://127.0.0.1:8081', // transformers-inference t2v (host 8081→container 8080)
  // Embedding HTTP timeout — generous (default 60s) because a cold self-hosted MiniLM
  // can take ~10s on its first request, which would otherwise blow the 10s provider
  // default and leave file chunks un-indexed (chunks_indexed=0, degraded).
  embeddingsTimeoutMs: int(e.HDSEARCH_EMBEDDINGS_TIMEOUT_MS, 60000),
  openaiKey: e.OPENAI_API_KEY || '',
  openaiEmbeddingModel: e.HDSEARCH_OPENAI_EMBED_MODEL || 'text-embedding-3-small',

  // ---- file upload + processing + RAG (see docs/file-upload-rag.md) ----
  file: {
    maxBytes: int(e.HDSEARCH_FILE_MAX_BYTES, 200 * 1024 * 1024), // 200 MB hard cap
    vectorTtlSec: int(e.HDSEARCH_FILE_VECTOR_TTL, 30 * 24 * 3600), // 30d (files outlive crawl cache)
    workerConcurrency: Math.max(1, int(e.HDSEARCH_FILE_WORKER_CONCURRENCY, 2)),
    maxAttempts: Math.max(1, int(e.HDSEARCH_FILE_MAX_ATTEMPTS, 3)),
    jobStaleMs: int(e.HDSEARCH_FILE_JOB_STALE_MS, 120000), // heartbeat staleness → reap/retry
    processTimeoutMs: int(e.HDSEARCH_FILE_PROCESS_TIMEOUT_MS, 300000), // per-file processing budget
    maxPages: int(e.HDSEARCH_FILE_MAX_PAGES, 2000),
    maxChars: int(e.HDSEARCH_FILE_MAX_CHARS, 5_000_000),
    ocr: bool(e.HDSEARCH_FILE_OCR, false), // tesseract.js (optional dep)
    vision: bool(e.HDSEARCH_FILE_VISION, false), // vision captioning via LLM keys
    avUrl: e.HDSEARCH_FILE_AV_URL || '', // optional AV scan endpoint; empty = disabled
    figmaToken: e.HDSEARCH_FIGMA_TOKEN || '',
    // retrieval: how many chunks to inject into a grounded chat turn
    ragTopK: int(e.HDSEARCH_FILE_RAG_TOPK, 8),
    ragMinScore: Number(e.HDSEARCH_FILE_RAG_MIN_SCORE) || 0.2,
  },

  // ---- audio/video transcription (Whisper) — makes AV files searchable via RAG ----
  // provider: 'local' (self-hosted OpenAI-compatible /v1/audio/transcriptions, e.g.
  // faster-whisper-server) | 'openai' | 'none' (default, off). Zero extra npm deps.
  transcribe: {
    provider: (e.HDSEARCH_TRANSCRIBE_PROVIDER || 'none').toLowerCase(), // 'local' | 'openai' | 'none'
    url: e.HDSEARCH_TRANSCRIBE_URL || 'http://127.0.0.1:8082/v1/audio/transcriptions',
    model: e.HDSEARCH_TRANSCRIBE_MODEL || 'whisper-1',
    maxBytes: int(e.HDSEARCH_TRANSCRIBE_MAX_BYTES, 25 * 1024 * 1024), // 25 MB (OpenAI cap)
    apiKey: e.HDSEARCH_TRANSCRIBE_KEY || e.OPENAI_API_KEY || '',
    timeoutMs: int(e.HDSEARCH_TRANSCRIBE_TIMEOUT_MS, 120000),
  },

  // ---- self-hosted provider endpoints (free, highest priority) ----
  openserpUrl: e.HDSEARCH_OPENSERP_URL || 'http://127.0.0.1:7007',
  // OpenSERP supports google, yandex, bing, baidu in this build. For maximum
  // breadth we query ALL of them and merge+dedupe (HDSEARCH_OPENSERP_MERGE=true).
  // Google may captcha datacenter IPs (engine-level fallback covers it).
  openserpEngine: e.HDSEARCH_OPENSERP_ENGINE || 'yandex',
  openserpEngines: e.HDSEARCH_OPENSERP_ENGINES || 'google,yandex,bing,baidu',
  // merge=true → fan out to all engines and merge; false → first engine with results wins
  openserpMerge: bool(e.HDSEARCH_OPENSERP_MERGE, true),
  // per-engine timeout for openserp (browser scrapes are slow + serialized)
  openserpTimeoutMs: int(e.HDSEARCH_OPENSERP_TIMEOUT_MS, 30000),
  searxngUrl: e.HDSEARCH_SEARXNG_URL || 'http://127.0.0.1:8899',
  crawl4aiUrl: e.HDSEARCH_CRAWL4AI_URL || 'http://127.0.0.1:11235', // reuses hackerdogs-crawl4ai
  browserlessUrl: e.HDSEARCH_BROWSERLESS_URL || 'http://127.0.0.1:3000', // reuses hackerdogs-browserless
  browserlessToken: e.HDSEARCH_BROWSERLESS_TOKEN || e.BROWSERLESS_TOKEN || '',
  // AI Mode: local Ollama endpoint (self-hosted LLMs, no key, $0 cost).
  ollamaUrl: e.HDSEARCH_OLLAMA_URL || 'http://127.0.0.1:11434',
  // Geocoder for the Maps modality. Engine: 'photon' (komoot, self-hostable) or
  // 'nominatim' (OSM, self-hostable). Default to the public Photon instance; point
  // HDSEARCH_GEOCODER_URL at your own container for zero-cost self-hosting.
  geocoderEngine: (e.HDSEARCH_GEOCODER_ENGINE || 'photon').toLowerCase(),
  geocoderUrl:
    e.HDSEARCH_GEOCODER_URL ||
    ((e.HDSEARCH_GEOCODER_ENGINE || 'photon').toLowerCase() === 'nominatim'
      ? 'https://nominatim.openstreetmap.org'
      : 'https://photon.komoot.io'),
  // Overpass API — used for "<category> in <place>" maps queries (all POIs of an OSM
  // tag within an area). Free public default; self-hostable (overpass-api docker).
  overpassUrl: e.HDSEARCH_OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  ahmiaUrl: e.HDSEARCH_AHMIA_URL || 'https://ahmia.fi',
  // Ahmia onion mirror (used as a Tor fallback when clearnet is blocked)
  ahmiaOnion: e.HDSEARCH_AHMIA_ONION || 'http://juhanurmihxlp77nkq76byazcldy2hlmovfu2epvl5ankdibsot4csyd.onion',
  // Tor SOCKS5 proxy for .onion darkweb providers (socks5h = remote DNS). Empty = disabled.
  torProxy: e.HDSEARCH_TOR_PROXY || '',
  // Torch onion search engine address (configurable; onion addresses rot over time)
  torchOnion: e.HDSEARCH_TORCH_ONION || 'http://torchdeedp3i2jigzjdmfpn5ttjhthh5wbmda2rr3jvqjg5p77c54dqd.onion',

  // ---- commercial default keys (used ONLY when runMode === 'dev') ----
  // Per-user keys (encrypted in Postgres) always take precedence in prod.
  devKeys: {
    serpapi: e.SERPAPI_API_KEY || '',
    serper: e.SERPER_API_KEY || '',
    brave: e.BRAVE_SEARCH_API_KEY || '',
    tavily: e.TAVILY_API_KEY || '',
    exa: e.EXA_API_KEY || '',
    kagi: e.KAGI_API_KEY || '',
    firecrawl: e.FIRECRAWL_API_KEY || '',
    jina: e.JINA_API_KEY || '',
    google_cse: e.GOOGLE_CSE_API_KEY || '',
    google_cse_cx: e.GOOGLE_CSE_CX || '',
    yandex: e.YANDEX_API_KEY || '',
    mojeek: e.MOJEEK_API_KEY || '',
    newsapi: e.NEWSAPI_API_KEY || '',
    github: e.GITHUB_TOKEN || '',
    intelx: e.INTELX_API_KEY || '',
    // LLM providers (AI Mode) — same dev fallback as search keys when RUN_MODE=dev
    anthropic: e.HDSEARCH_ANTHROPIC_KEY || e.ANTHROPIC_API_KEY || '',
    openai: e.HDSEARCH_OPENAI_KEY || e.OPENAI_API_KEY || '',
    google: e.HDSEARCH_GOOGLE_AI_KEY || e.GOOGLE_GENERATIVE_AI_API_KEY || '',
    xai: e.HDSEARCH_XAI_KEY || e.XAI_API_KEY || '',
    openrouter: e.HDSEARCH_OPENROUTER_KEY || e.OPENROUTER_API_KEY || '',
    groq: e.HDSEARCH_GROQ_KEY || e.GROQ_API_KEY || '',
    mistral: e.HDSEARCH_MISTRAL_KEY || e.MISTRAL_API_KEY || '',
    azure_openai: e.HDSEARCH_AZURE_OPENAI_KEY || e.AZURE_OPENAI_API_KEY || '',
    aws_access_key: e.AWS_ACCESS_KEY_ID || '',
  } as Record<string, string>,

  // ---- local (self-hosted) auth ----
  // First-run creates the admin account; after that registration is closed unless
  // openSignup is on. adminEmail/adminPassword bootstrap the admin headlessly (Docker).
  openSignup: /^(1|true|yes|on)$/i.test(e.HDSEARCH_OPEN_SIGNUP || ''),
  adminEmail: (e.HDSEARCH_ADMIN_EMAIL || e.ADMIN_EMAIL || '').trim(),
  adminPassword: e.HDSEARCH_ADMIN_PASSWORD || e.ADMIN_PASSWORD || '',

  // ---- central auth (hackerdogs-core) integration ----
  // Auth mode for the API. 'legacy' = current behavior only (own session + sk-hds keys).
  // 'core' = also accept the central Hackerdogs JWT. 'both' = legacy + core (for cutover).
  authMode: (e.HDSEARCH_AUTH_MODE || 'legacy').toLowerCase() as 'legacy' | 'core' | 'both',
  // Shared HS256 secret the core signs its JWTs with (must match hackerdogs-core JWT_SECRET_KEY).
  jwtSecretKey: e.JWT_SECRET_KEY || e.HDSEARCH_JWT_SECRET_KEY || '',
  // Base URL of the core API (token-exchange / /auth/me) used to resolve a user's plan by JWT.
  coreBaseUrl: (e.HD_CORE_BASE_URL || e.VITE_HACKERDOGS_AUTH_BASE || 'https://preview.hackerdogs.ai').replace(/\/+$/, ''),
  // Optional service JWT for public plan catalog (GET /v1/plans → /gpdtplansui).
  coreCatalogJwt: e.HD_CORE_CATALOG_JWT || '',

  // ---- hdfeeds integration (trends panel on /search) ----
  // URL: localhost in api/.env (terminal); docker-compose hardcodes http://hdfeeds:8787.
  // Auth: copy HDFEEDS_INTERNAL_SECRET from hdfeeds n8n/hd-feeds.env → HDSEARCH_HDFEEDS_INTERNAL_SECRET.
  hdfeedsBaseUrl: (e.HDSEARCH_HDFEEDS_BASE_URL || 'http://localhost:8787').replace(/\/+$/, ''),
  hdfeedsApiKey: e.HDSEARCH_HDFEEDS_API_KEY || '',
  hdfeedsInternalSecret: e.HDSEARCH_HDFEEDS_INTERNAL_SECRET || '',
  hdfeedsServiceId: e.HDSEARCH_HDFEEDS_SERVICE_ID || 'hdsearch',
  hdfeedsTimeoutMs: int(e.HDSEARCH_HDFEEDS_TIMEOUT_MS, 5000),
  trendsWindowHours: int(e.HDSEARCH_TRENDS_WINDOW_HOURS, 24),
  trendsLimit: int(e.HDSEARCH_TRENDS_LIMIT, 12),
  trendsCacheTtlSec: int(e.HDSEARCH_TRENDS_CACHE_TTL, 600),
  trendsMinUsers: int(e.HDSEARCH_TRENDS_MIN_USERS, 3),

  // optional: mint a first admin key on boot if no keys exist
  bootstrapAdminKey: e.HDSEARCH_API_BOOTSTRAP_ADMIN_KEY || '',
  // key verification cache window (ms)
  keyCacheMs: int(e.HDSEARCH_API_KEY_CACHE_MS, 10000),
};

export const isDev = () => env.runMode === 'dev';

export const s3Path = (id: string) =>
  `${env.prefix ? env.prefix.replace(/\/+$/, '') + '/' : ''}${id}`;
