// Vector storage + search in Redis (spec §10, §11). Design note / suggestion:
//
//   RediSearch (https://github.com/RediSearch/RediSearch) DOES help here: its
//   VECTOR field type gives true ANN (HNSW) KNN search in-Redis, co-located with
//   the same cache we already use to avoid upstream blocking — one datastore, no
//   extra service. Shared hd-redis runs redis-stack-server (RediSearch + JSON).
//
//   This module probes for the module at boot and transparently falls back to a
//   brute-force cosine scan when RediSearch is absent. With core infra up
//   (./start_core_infra.sh up), HDSEARCH_REDIS_URL=redis://127.0.0.1:6379/2.
//
// Every vector is stored with a TTL (default 24h, HDSEARCH_VECTOR_TTL) so the
// space self-cleans.
import { env } from './env.js';
// Vectors + the RediSearch index live on db 0 (RediSearch only indexes db 0); use the
// dedicated vector connection. `k()` just builds key strings (connection-agnostic).
import { vectorRedis as redis, k } from './store.js';
import { log, errFields } from './logger.js';
import { getEmbedder, vectorToBuffer } from './embeddings.js';
import { sha1 } from './cache.js';

let rediSearchAvailable: boolean | null = null;
const INDEX = env.vectorIndex;
const DOC_PREFIX = `${env.keyPrefix}:vec:doc:`;
const nsSet = (ns: string) => k('vec', 'ns', ns); // fallback id set per namespace

export interface VecDoc {
  id?: string;
  text: string;
  url?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface VecHit {
  id: string;
  score: number; // cosine similarity 0..1 (higher = closer)
  text: string;
  url?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

/** Probe once for the RediSearch module and (re)create the index if present. */
export async function ensureVectorIndex(): Promise<boolean> {
  if (rediSearchAvailable !== null) return rediSearchAvailable;
  try {
    await redis.call('FT.INFO', INDEX);
    rediSearchAvailable = true;
    return true;
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (/unknown command|ERR unknown/i.test(msg)) {
      rediSearchAvailable = false;
      log.warn('RediSearch not loaded; using brute-force vector fallback');
      return false;
    }
    // index just doesn't exist yet — try to create it
    try {
      await redis.call(
        'FT.CREATE', INDEX, 'ON', 'HASH', 'PREFIX', '1', DOC_PREFIX,
        'SCHEMA',
        'namespace', 'TAG',
        'text', 'TEXT',
        'url', 'TEXT',
        'title', 'TEXT',
        'vec', 'VECTOR', 'HNSW', '6', 'TYPE', 'FLOAT32', 'DIM', String(env.vectorDim), 'DISTANCE_METRIC', 'COSINE',
      );
      rediSearchAvailable = true;
      log.info('RediSearch vector index created', { index: INDEX, dim: env.vectorDim });
      return true;
    } catch (e2) {
      const m2 = String((e2 as Error).message || e2);
      if (/unknown command|ERR unknown/i.test(m2)) {
        rediSearchAvailable = false;
        log.warn('RediSearch not loaded; using brute-force vector fallback');
        return false;
      }
      rediSearchAvailable = true; // create raced; index exists
      return true;
    }
  }
}

function docKey(ns: string, id: string): string {
  return `${DOC_PREFIX}${ns}:${id}`;
}

/** Embed + store documents with a TTL. Returns the ids written. */
export async function indexDocuments(
  docs: VecDoc[],
  namespace: string,
  ttlSec?: number,
): Promise<string[]> {
  const ttl = ttlSec ?? env.vectorTtlSec;
  const useRs = await ensureVectorIndex();
  const embedder = getEmbedder();
  const vectors = await embedder.embed(docs.map((d) => d.text));

  const ids: string[] = [];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]!;
    const id = d.id || sha1(`${namespace}:${d.url || ''}:${d.text}`).slice(0, 16);
    const vec = vectors[i]!;
    const key = docKey(namespace, id);
    const fields: (string | Buffer)[] = [
      'namespace', namespace,
      'text', d.text,
      'url', d.url || '',
      'title', d.title || '',
      'metadata', JSON.stringify(d.metadata || {}),
      'vecjson', JSON.stringify(vec), // for brute-force fallback
    ];
    if (useRs) fields.push('vec', vectorToBuffer(vec));
    try {
      await redis.hset(key, ...(fields as any));
      await redis.expire(key, ttl);
      if (!useRs) {
        await redis.sadd(nsSet(namespace), id);
        await redis.expire(nsSet(namespace), Math.max(ttl, env.vectorTtlSec));
      }
      ids.push(id);
    } catch (e) {
      log.warn('vector store failed', { id, ...errFields(e) });
    }
  }
  return ids;
}

/** KNN search. Uses RediSearch when available, else brute-force cosine. */
export async function vectorSearch(query: string, namespace: string, kTop: number): Promise<VecHit[]> {
  const useRs = await ensureVectorIndex();
  const embedder = getEmbedder();
  const [qvec] = await embedder.embed([query]);
  if (!qvec) return [];

  return useRs ? rediSearchKnn(qvec, namespace, kTop) : bruteForce(qvec, namespace, kTop);
}

async function rediSearchKnn(qvec: number[], namespace: string, kTop: number): Promise<VecHit[]> {
  const blob = vectorToBuffer(qvec);
  // (@namespace:{ns})=>[KNN k @vec $blob AS score]
  const q = `(@namespace:{${escapeTag(namespace)}})=>[KNN ${kTop} @vec $blob AS score]`;
  try {
    const res: any = await redis.call(
      'FT.SEARCH', INDEX, q,
      'PARAMS', '2', 'blob', blob,
      'SORTBY', 'score',
      'RETURN', '5', 'text', 'url', 'title', 'metadata', 'score',
      'DIALECT', '2',
      'LIMIT', '0', String(kTop),
    );
    return parseFtSearch(res);
  } catch (e) {
    log.warn('FT.SEARCH failed; falling back to brute force', errFields(e));
    rediSearchAvailable = false;
    return bruteForce(qvec, namespace, kTop);
  }
}

function parseFtSearch(res: any[]): VecHit[] {
  // res = [total, key1, [f,v,...], key2, [...], ...]
  const out: VecHit[] = [];
  for (let i = 1; i < res.length; i += 2) {
    const key = String(res[i]);
    const arr = res[i + 1] as string[];
    const f: Record<string, string> = {};
    for (let j = 0; j < arr.length; j += 2) f[arr[j]!] = arr[j + 1]!;
    const dist = parseFloat(f.score ?? '1'); // COSINE distance 0..2; similarity = 1 - dist
    out.push({
      id: key.split(':').pop() || key,
      score: Math.max(0, 1 - dist),
      text: f.text || '',
      url: f.url || undefined,
      title: f.title || undefined,
      metadata: safeJson(f.metadata),
    });
  }
  return out;
}

async function bruteForce(qvec: number[], namespace: string, kTop: number): Promise<VecHit[]> {
  const ids = await redis.smembers(nsSet(namespace));
  const scored: VecHit[] = [];
  for (const id of ids) {
    const key = docKey(namespace, id);
    const data = await redis.hgetall(key);
    if (!data || !data.vecjson) {
      await redis.srem(nsSet(namespace), id); // expired; clean the set
      continue;
    }
    const vec = safeJson<number[]>(data.vecjson);
    if (!Array.isArray(vec)) continue;
    scored.push({
      id,
      score: cosine(qvec, vec),
      text: data.text || '',
      url: data.url || undefined,
      title: data.title || undefined,
      metadata: safeJson(data.metadata),
    });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, kTop);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function escapeTag(s: string): string {
  return s.replace(/[\s.,<>{}[\]"':;!@#$%^&*()\-+=~|]/g, '\\$&');
}
function safeJson<T = Record<string, unknown>>(s?: string): T | undefined {
  if (!s) return undefined;
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
}

/**
 * Eagerly delete every vector doc under a namespace (or a namespace prefix when
 * `prefix` is true — e.g. `file:<userId>:` to wipe all of a user's threads).
 * Docs also self-expire by TTL, but delete-on-chat-delete must leave zero orphans
 * (docs/file-upload-rag.md §C.11), so we scan + unlink here. Best-effort: a Redis
 * outage just means we fall back to TTL expiry. Returns the count removed.
 */
export async function deleteNamespace(namespace: string, prefix = false): Promise<number> {
  const match = `${DOC_PREFIX}${namespace}${prefix ? '' : ':'}*`;
  let removed = 0;
  try {
    let cursor = '0';
    do {
      // SCAN is non-blocking and safe on the shared vector db; UNLINK frees async.
      const [next, keys] = (await redis.scan(cursor, 'MATCH', match, 'COUNT', 500)) as [string, string[]];
      cursor = next;
      if (keys.length) {
        await redis.unlink(...keys);
        removed += keys.length;
      }
    } while (cursor !== '0');
    // Also drop the brute-force fallback id-set(s) for this namespace.
    if (prefix) {
      let c2 = '0';
      const setMatch = k('vec', 'ns', `${namespace}*`);
      do {
        const [next, keys] = (await redis.scan(c2, 'MATCH', setMatch, 'COUNT', 200)) as [string, string[]];
        c2 = next;
        if (keys.length) await redis.unlink(...keys);
      } while (c2 !== '0');
    } else {
      await redis.unlink(nsSet(namespace)).catch(() => {});
    }
  } catch (e) {
    log.warn('vector namespace delete failed', { namespace, prefix, ...errFields(e) });
  }
  return removed;
}
