// Search + vector endpoints (spec §1, §3, §5, §11). Gated by auth + scopes.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireScope, isDemoUser } from '../auth.js';
import { SearchRequestSchema, VectorIndexRequestSchema, VectorSearchRequestSchema } from '../types.js';
import { runSearch } from '../engine.js';
import { recordUsage, recordError } from '../metrics.js';
import { recordHistory } from '../history.js';
import { indexDocuments, vectorSearch } from '../vector.js';
import { embeddingsEnabled } from '../embeddings.js';
import { log, errFields } from '../logger.js';

export const searchRoutes = new Hono();

searchRoutes.use('*', requireAuth());

// ---- POST /v1/search ----------------------------------------------------------
searchRoutes.post('/', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad_request', message: 'invalid JSON body' }, 400);
  }
  const parsed = SearchRequestSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);

  try {
    const resp = await runSearch(parsed.data, p.userId);
    const usedEngines = resp.enginesUsed.filter((e) => e.ok).map((e) => e.engine);
    const isFirstPage = (parsed.data.page ?? 1) <= 1;
    void recordUsage({
      userId: p.userId,
      kind: 'search',
      query: parsed.data.q,
      modality: parsed.data.modality,
      engineUsed: usedEngines[0],
      engines: resp.enginesUsed,
      resultCount: resp.total,
      cached: resp.cached,
      tookMs: resp.tookMs,
      apiKeyId: p.keyId,
      skipCounter: !isFirstPage,
    });
    if (isFirstPage && !isDemoUser(p.userId) && !parsed.data.temporary) {
      void recordHistory(p.userId, {
        q: parsed.data.q,
        modality: parsed.data.modality,
        ts: Date.now(),
        count: resp.total,
        source: 'search',
      });
    }
    return c.json(resp);
  } catch (e) {
    log.error('search failed', errFields(e));
    void recordError(p.userId, parsed.data.engine, (e as Error).message);
    return c.json({ error: 'search_failed', message: (e as Error).message }, 502);
  }
});

// ---- GET /v1/search?q=... (convenience) --------------------------------------
searchRoutes.get('/', requireScope('search:read'), async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'bad_request', message: 'q is required' }, 400);
  const p = c.get('principal');
  const parsed = SearchRequestSchema.safeParse({
    q,
    modality: c.req.query('modality'),
    engine: c.req.query('engine'),
    mode: c.req.query('mode'),
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
    page: c.req.query('page') ? Number(c.req.query('page')) : undefined,
    country: c.req.query('country'),
    lang: c.req.query('lang'),
    freshness: c.req.query('freshness'),
    facets: c.req.query('facets') === 'true',
    searchDepth: c.req.query('searchDepth') || c.req.query('depth'),
    temporary: c.req.query('temporary') === 'true',
    noCache: c.req.query('noCache') === 'true',
    ttl: c.req.query('ttl') ? Number(c.req.query('ttl')) : undefined,
  });
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);

  const resp = await runSearch(parsed.data, p.userId);
  const usedEngines = resp.enginesUsed.filter((e) => e.ok).map((e) => e.engine);
  const isFirstPage = (parsed.data.page ?? 1) <= 1;
  void recordUsage({
    userId: p.userId,
    kind: 'search',
    query: parsed.data.q,
    modality: parsed.data.modality,
    engineUsed: usedEngines[0],
    engines: resp.enginesUsed,
    resultCount: resp.total,
    cached: resp.cached,
    tookMs: resp.tookMs,
    apiKeyId: p.keyId,
    skipCounter: !isFirstPage,
  });
  return c.json(resp);
});

// ---- POST /v1/search/vector/index --------------------------------------------
searchRoutes.post('/vector/index', requireScope('vector:read'), async (c) => {
  const p = c.get('principal');
  if (!embeddingsEnabled()) return c.json({ error: 'unavailable', message: 'embeddings disabled' }, 503);

  const parsed = VectorIndexRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);

  // namespace is scoped per user to prevent cross-tenant leakage
  const ns = `${p.userId}:${parsed.data.namespace}`;
  try {
    const ids = await indexDocuments(parsed.data.documents, ns, parsed.data.ttl);
    void recordUsage({ userId: p.userId, kind: 'vector', query: `index:${parsed.data.namespace}`, resultCount: ids.length, cached: false, tookMs: 0, apiKeyId: p.keyId });
    return c.json({ namespace: parsed.data.namespace, indexed: ids.length, ids, ttl: parsed.data.ttl ?? undefined });
  } catch (e) {
    log.error('vector index failed', errFields(e));
    return c.json({ error: 'vector_index_failed', message: (e as Error).message }, 502);
  }
});

// ---- POST /v1/search/vector (KNN search) -------------------------------------
searchRoutes.post('/vector', requireScope('vector:read'), async (c) => {
  const p = c.get('principal');
  if (!embeddingsEnabled()) return c.json({ error: 'unavailable', message: 'embeddings disabled' }, 503);

  const parsed = VectorSearchRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);

  const ns = `${p.userId}:${parsed.data.namespace}`;
  const t0 = Date.now();
  try {
    // optionally ground with live web results first, then KNN over them
    if (parsed.data.groundWithWeb) {
      const web = await runSearch(
        { q: parsed.data.q, modality: 'web', mode: 'aggregate', limit: 20, page: 1, safe: true, facets: false, noCache: false },
        p.userId,
      );
      const docs = web.results
        .filter((r) => r.snippet || r.title)
        .map((r) => ({ id: r.id, text: `${r.title}\n${r.snippet || ''}`, url: r.url, title: r.title }));
      if (docs.length) await indexDocuments(docs, ns, undefined);
    }
    const hits = await vectorSearch(parsed.data.q, ns, parsed.data.k);
    void recordUsage({ userId: p.userId, kind: 'vector', query: parsed.data.q, resultCount: hits.length, cached: false, tookMs: Date.now() - t0, apiKeyId: p.keyId });
    return c.json({ query: parsed.data.q, namespace: parsed.data.namespace, results: hits, total: hits.length, tookMs: Date.now() - t0 });
  } catch (e) {
    log.error('vector search failed', errFields(e));
    return c.json({ error: 'vector_search_failed', message: (e as Error).message }, 502);
  }
});
