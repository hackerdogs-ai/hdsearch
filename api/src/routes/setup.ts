// First-run setup wizard API + Settings config. Lets the web wizard read the
// current endpoints, TEST-connect to a proposed endpoint (so the Next button can
// gate on reachability), and SAVE the config (file-backed).
//
// Auth: every route requires the first-party internal secret (only the web BFF
// calls these). Saving is open during first-run (no admin yet) and admin-only
// afterwards.
//
// Restart: DB / Redis / S3 / Tor clients are built once at boot. Saving returns
// restartRequired only when those values differ from the live process env.
import { Hono } from 'hono';
import { z } from 'zod';
import { connect } from 'node:net';
import { env } from '../env.js';
import { loadConfig, saveConfig, isSetupComplete, SERVICE_KEYS, type ServiceKey } from '../runtime-config.js';
import { roleForUser } from '../auth.js';
import { log } from '../logger.js';

export const setupRoutes = new Hono();

const LABELS: Record<ServiceKey, string> = {
  database: 'Database (Postgres / TimescaleDB)',
  redis: 'Redis (with RediSearch)',
  s3: 'Object storage (S3 / SeaweedFS)',
  embeddings: 'Embeddings',
  searxng: 'SearXNG (meta-search)',
  openserp: 'OpenSERP',
  crawl4ai: 'Crawl4AI',
  browserless: 'Browserless',
  tor: 'Tor proxy (darkweb)',
};
// Required to reach for setup to complete (core datastores) vs optional providers.
const REQUIRED: ServiceKey[] = ['database', 'redis'];

/** Services whose connection clients are snapshotted at API boot. */
const RESTART_KEYS = ['database', 'redis', 's3', 'tor'] as const;
type RestartKey = (typeof RESTART_KEYS)[number];

/** The currently-effective endpoint for a service (config → env → default). */
function currentUrl(key: ServiceKey): string {
  switch (key) {
    case 'database': return env.pgUrl;
    case 'redis': return env.redisUrl;
    case 's3': return env.s3Endpoint;
    case 'embeddings': return env.embeddingsUrl;
    case 'searxng': return env.searxngUrl;
    case 'openserp': return env.openserpUrl;
    case 'crawl4ai': return env.crawl4aiUrl;
    case 'browserless': return env.browserlessUrl;
    case 'tor': return env.torProxy;
  }
}

type SvcPatch = { url?: string; accessKey?: string; secretKey?: string; provider?: string };

/** Live boot-time values for infra that needs a process restart to reconnect. */
function liveInfra(key: RestartKey): { url: string; accessKey?: string; secretKey?: string } {
  switch (key) {
    case 'database': return { url: env.pgUrl };
    case 'redis': return { url: env.redisUrl };
    case 's3': return { url: env.s3Endpoint, accessKey: env.s3Key, secretKey: env.s3Secret };
    case 'tor': return { url: env.torProxy };
  }
}

/** Which restart-bound services in the save payload differ from the running process. */
function restartChanges(services: Partial<Record<ServiceKey, SvcPatch>>): RestartKey[] {
  const changed: RestartKey[] = [];
  for (const key of RESTART_KEYS) {
    const patch = services[key];
    if (!patch) continue;
    const live = liveInfra(key);
    if (patch.url !== undefined && patch.url.trim() !== (live.url || '').trim()) {
      changed.push(key);
      continue;
    }
    if (key === 's3') {
      if (patch.accessKey !== undefined && patch.accessKey !== live.accessKey) {
        changed.push(key);
        continue;
      }
      // Blank secret means "leave unchanged" (wizard omits or sends empty).
      if (patch.secretKey !== undefined && patch.secretKey !== '' && patch.secretKey !== live.secretKey) {
        changed.push(key);
      }
    }
  }
  return changed;
}

/** Parse host+port from any of the schemes we use (http, postgres, redis, socks5h). */
function hostPort(url: string): { host: string; port: number } | null {
  if (!url) return null;
  try {
    const u = new URL(url.replace(/^socks5h?:\/\//i, 'tcp://'));
    const byProto: Record<string, number> = {
      'postgres:': 5432, 'postgresql:': 5432, 'redis:': 6379, 'rediss:': 6379,
      'http:': 80, 'https:': 443, 'tcp:': 9050,
    };
    const port = u.port ? Number(u.port) : byProto[u.protocol] || 0;
    return u.hostname && port ? { host: u.hostname, port } : null;
  } catch {
    return null;
  }
}

/** TCP-connect reachability check (universal across DB/redis/http/socks). */
function tcpProbe(host: string, port: number, timeoutMs = 4000): Promise<{ reachable: boolean; ms: number; detail?: string }> {
  const t0 = Date.now();
  return new Promise((res) => {
    const sock = connect({ host, port });
    const finish = (reachable: boolean, detail?: string) => { sock.destroy(); res({ reachable, ms: Date.now() - t0, detail }); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false, 'timeout'));
    sock.once('error', (e) => finish(false, (e as Error).message));
  });
}

async function probe(url: string): Promise<{ reachable: boolean; ms: number; detail?: string }> {
  const hp = hostPort(url);
  if (!hp) return { reachable: false, ms: 0, detail: 'invalid or empty endpoint' };
  return tcpProbe(hp.host, hp.port);
}

// Only the first-party web BFF may call setup routes.
setupRoutes.use('*', async (c, next) => {
  const internal = c.req.header('x-hd-internal');
  if (!internal || internal !== env.internalSecret) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

// GET /v1/setup/status — pre-fill values + whether setup is done.
setupRoutes.get('/status', (c) => {
  const cfg = loadConfig();
  const services = SERVICE_KEYS.map((k) => ({
    key: k,
    label: LABELS[k],
    required: REQUIRED.includes(k),
    url: (cfg[k]?.url || '') || currentUrl(k),
    ...(k === 's3' ? { accessKey: cfg.s3?.accessKey ?? env.s3Key } : {}),
    ...(k === 'embeddings' ? { provider: cfg.embeddings?.provider ?? env.embeddingsProvider } : {}),
  }));
  return c.json({ setupComplete: isSetupComplete(), services });
});

// POST /v1/setup/test — reachability of a proposed endpoint (for the gated Next).
setupRoutes.post('/test', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { service?: string; url?: string } | null;
  const service = body?.service as ServiceKey | undefined;
  if (!service || !(SERVICE_KEYS as readonly string[]).includes(service)) return c.json({ error: 'bad_request', message: 'unknown service' }, 400);
  const url = (body?.url || '').trim() || currentUrl(service);
  const r = await probe(url);
  return c.json({ service, url, ...r });
});

// PUT /v1/setup/config — save endpoints (+ optional `complete`). Open during
// first-run; admin-only afterwards. restartRequired when DB/Redis/S3/Tor differ
// from the values the running API process was booted with.
const svc = z.object({ url: z.string().optional(), accessKey: z.string().optional(), secretKey: z.string().optional(), provider: z.string().optional() }).partial();
const SaveSchema = z.object({
  database: svc.optional(), redis: svc.optional(), s3: svc.optional(), embeddings: svc.optional(),
  searxng: svc.optional(), openserp: svc.optional(), crawl4ai: svc.optional(), browserless: svc.optional(), tor: svc.optional(),
  complete: z.boolean().optional(),
});
setupRoutes.put('/config', async (c) => {
  if (isSetupComplete()) {
    const user = c.req.header('x-hd-user') || '';
    const role = user ? await roleForUser(user) : 'user';
    if (role !== 'admin') return c.json({ error: 'forbidden', message: 'admin required to change configuration' }, 403);
  }
  const parsed = SaveSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const { complete, ...services } = parsed.data;
  try {
    saveConfig({ ...services, ...(typeof complete === 'boolean' ? { setupComplete: complete } : {}) });
  } catch (e) {
    return c.json({ error: 'server_error', message: (e as Error).message }, 500);
  }
  const changed = restartChanges(services);
  const restartRequired = changed.length > 0;
  log.info('setup config saved', { services: Object.keys(services), complete, restartRequired, changed });
  return c.json({ saved: true, restartRequired, changed });
});
