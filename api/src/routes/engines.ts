// Engine discovery (spec §5): list available search/crawl engines, their
// modalities, access type, priority and docs. Powers the Services UI page and
// lets clients pick a specific engine.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { catalog, getProvider } from '../providers/index.js';
import { isSearch, isCrawl } from '../providers/types.js';
import { MODALITIES } from '../types.js';
import { hasKeysFor } from '../keystore.js';
import { getProviderPrefs, setProviderPrefs } from '../provider-prefs.js';
import {
  allowedCacheTtlSec,
  cacheTtlOptions,
  getAdminCacheTtlLimits,
  normalizeCacheTtlSec,
} from '../cache-ttl.js';
import { log, errFields } from '../logger.js';

export const engineRoutes = new Hono();

engineRoutes.use('*', requireAuth());

// GET /v1/engines  — optional ?category=search|crawl|darkweb  ?modality=web|images...
engineRoutes.get('/', async (c) => {
  const p = c.get('principal');
  const category = c.req.query('category');
  const modality = c.req.query('modality');
  let list = catalog();
  if (category) list = list.filter((e) => e.category === category || (category === 'search' && e.category === 'darkweb'));
  if (modality) list = list.filter((e) => e.modalities?.includes(modality as any));

  // annotate availability for THIS user (keys present?)
  const annotated = await Promise.all(
    list.map(async (e) => ({
      ...e,
      available: await hasKeysFor(p.userId, e.requiresKeys.length ? e.requiresKeys : undefined),
    })),
  );
  return c.json({ modalities: MODALITIES, count: annotated.length, engines: annotated });
});

// GET /v1/engines/prefs — current user's provider preferences
engineRoutes.get('/prefs', async (c) => {
  const p = c.get('principal');
  const prefs = await getProviderPrefs(p.userId);
  const cacheTtlSec = normalizeCacheTtlSec(prefs.cacheTtlSec);
  const admin = getAdminCacheTtlLimits();
  return c.json({
    prefs: { ...prefs, cacheTtlSec },
    cacheTtlLimits: {
      defaultSec: admin.defaultSec,
      maxSec: admin.maxSec,
      options: cacheTtlOptions(),
    },
  });
});

// PUT /v1/engines/prefs — save user's provider preferences (partial updates merge with stored prefs)
const CacheTtlSchema = z.union([
  z.literal(900),
  z.literal(1800),
  z.literal(3600),
  z.literal(86400),
]);
const PrefsSchema = z.object({
  disabled: z.array(z.string()).max(100).optional(),
  ranks: z.record(z.string(), z.number().int().min(1).max(9999)).optional(),
  cacheTtlSec: CacheTtlSchema.optional(),
});
engineRoutes.put('/prefs', async (c) => {
  const p = c.get('principal');
  const parsed = PrefsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  try {
    const current = await getProviderPrefs(p.userId);
    const allowed = allowedCacheTtlSec();
    const merged = {
      disabled: parsed.data.disabled ?? current.disabled,
      ranks: parsed.data.ranks ?? current.ranks,
      cacheTtlSec:
        parsed.data.cacheTtlSec != null
          ? normalizeCacheTtlSec(parsed.data.cacheTtlSec)
          : normalizeCacheTtlSec(current.cacheTtlSec),
    };
    if (merged.cacheTtlSec != null && !allowed.has(merged.cacheTtlSec)) {
      return c.json({ error: 'bad_request', message: 'cacheTtlSec exceeds the configured maximum' }, 400);
    }
    await setProviderPrefs(p.userId, merged);
    return c.json({ ok: true, prefs: merged });
  } catch (e) {
    log.error('PUT /prefs failed', { userId: p.userId, ...errFields(e) });
    return c.json({ error: 'internal', message: 'could not save preferences' }, 500);
  }
});

// GET /v1/engines/by-modality — providers grouped by modality (for per-modality ranking UI)
engineRoutes.get('/by-modality', async (c) => {
  const p = c.get('principal');
  const list = catalog();
  const annotated = await Promise.all(
    list.map(async (e) => ({
      ...e,
      available: await hasKeysFor(p.userId, e.requiresKeys.length ? e.requiresKeys : undefined),
    })),
  );
  const grouped: Record<string, typeof annotated> = {};
  for (const e of annotated) {
    if (e.modalities) {
      for (const m of e.modalities) {
        (grouped[m] ??= []).push(e);
      }
    }
    if (e.category === 'crawl') {
      (grouped['crawl'] ??= []).push(e);
    }
  }
  return c.json({ grouped });
});

// GET /v1/engines/:id
engineRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const p = getProvider(id);
  if (!p) return c.json({ error: 'not_found', message: `unknown engine '${id}'` }, 404);
  return c.json({
    id: p.id,
    label: p.label,
    category: p.category,
    accessType: p.accessType,
    modalities: isSearch(p) ? p.modalities : undefined,
    rendersJs: isCrawl(p) ? p.rendersJs : undefined,
    requiresKeys: p.requiresKeys || [],
    cacheTtlSec: p.cacheTtlSec,
    docsUrl: p.docsUrl,
    endpoint: p.endpoint,
    description: p.description,
  });
});
