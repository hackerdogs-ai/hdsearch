// User-facing API keys (sk-hds-...). Postgres is the source of truth (shown in the
// panel, scoped per user); Redis is a hot verification cache so the request path
// stays O(1) and survives brief DB blips. Only the sha256 hash is ever stored;
// the full key is shown exactly once at creation (Claude-style).
import { randomBytes, createHash } from 'node:crypto';
import { SCHEMA, query, tryQuery } from './db.js';
import { redis, redisHealthy, markRedisDown, k } from './store.js';
import { log } from './logger.js';

export type Scope = 'search:read' | 'crawl:read' | 'vector:read' | 'admin:keys' | 'admin:platform';
export const DEFAULT_SCOPES: Scope[] = ['search:read', 'crawl:read', 'vector:read'];

export interface ApiKeyRecord {
  id: string;
  userId: string;
  name: string;
  scopes: Scope[];
  rateLimitPerMin: number;
  status: 'active' | 'revoked';
  keyPrefix: string;
  createdAt: string;
  lastUsedAt?: string;
}

const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function base62(n: number): string {
  const buf = randomBytes(n);
  let out = '';
  for (const b of buf) out += B62[b % 62];
  return out;
}
export const hashKey = (raw: string) => createHash('sha256').update(raw).digest('hex');
const VERIFY_KEY = (h: string) => k('apikey', h); // redis hot cache: hash -> JSON

export interface IssueOpts {
  userId: string;
  name: string;
  scopes?: Scope[];
  rateLimitPerMin?: number;
}

export async function issueKey(opts: IssueOpts): Promise<{ key: string; record: ApiKeyRecord }> {
  const secret = `sk-hds-${base62(43)}`;
  const id = `key_${base62(8).toLowerCase()}`;
  const scopes = opts.scopes?.length ? opts.scopes : DEFAULT_SCOPES;
  const rec: ApiKeyRecord = {
    id,
    userId: opts.userId,
    name: opts.name,
    scopes,
    rateLimitPerMin: opts.rateLimitPerMin ?? 120,
    status: 'active',
    keyPrefix: secret.slice(0, 12),
    createdAt: new Date().toISOString(),
  };
  const h = hashKey(secret);
  await query(
    `insert into ${SCHEMA}.api_keys (id, user_id, name, key_hash, key_prefix, scopes, rate_limit_per_min, status)
     values ($1,$2,$3,$4,$5,$6,$7,'active')`,
    [id, opts.userId, rec.name, h, rec.keyPrefix, scopes, rec.rateLimitPerMin],
  );
  cacheRecord(h, rec);
  return { key: secret, record: rec };
}

function cacheRecord(h: string, rec: ApiKeyRecord | null): void {
  if (!redisHealthy()) return;
  redis.set(VERIFY_KEY(h), JSON.stringify(rec), 'EX', 30).catch((e) => markRedisDown(e));
}

export async function verifyKey(raw: string): Promise<ApiKeyRecord | null> {
  if (!raw || !raw.startsWith('sk-hds-')) return null;
  const h = hashKey(raw);

  if (redisHealthy()) {
    const cached = await redis.get(VERIFY_KEY(h)).catch((e) => {
      markRedisDown(e);
      return null;
    });
    if (cached) {
      const rec = JSON.parse(cached) as ApiKeyRecord | null;
      return rec && rec.status === 'active' ? rec : null;
    }
  }

  const rows = await tryQuery<any>(
    `select id, user_id, name, scopes, rate_limit_per_min, status, key_prefix, created_at, last_used_at
       from ${SCHEMA}.api_keys where key_hash = $1`,
    [h],
  );
  if (!rows[0]) {
    cacheRecord(h, null);
    return null;
  }
  const r = rows[0];
  const rec: ApiKeyRecord = {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    scopes: r.scopes,
    rateLimitPerMin: r.rate_limit_per_min,
    status: r.status,
    keyPrefix: r.key_prefix,
    createdAt: new Date(r.created_at).toISOString(),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : undefined,
  };
  cacheRecord(h, rec);
  return rec.status === 'active' ? rec : null;
}

export async function touchKey(id: string): Promise<void> {
  // throttle: at most once / 60s per key
  const guard = k('apikey', 'touch', id);
  const fresh = await redis.set(guard, '1', 'EX', 60, 'NX').catch(() => null);
  if (!fresh) return;
  await tryQuery(`update ${SCHEMA}.api_keys set last_used_at = now() where id = $1`, [id]);
}

export async function listKeys(userId: string): Promise<ApiKeyRecord[]> {
  const rows = await tryQuery<any>(
    `select id, user_id, name, scopes, rate_limit_per_min, status, key_prefix, created_at, last_used_at
       from ${SCHEMA}.api_keys where user_id = $1 order by created_at desc`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    scopes: r.scopes,
    rateLimitPerMin: r.rate_limit_per_min,
    status: r.status,
    keyPrefix: r.key_prefix,
    createdAt: new Date(r.created_at).toISOString(),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : undefined,
  }));
}

export async function revokeKey(userId: string, id: string): Promise<boolean> {
  const rows = await query<{ key_hash: string }>(
    `update ${SCHEMA}.api_keys set status='revoked' where id=$1 and user_id=$2 returning key_hash`,
    [id, userId],
  );
  if (rows[0]) cacheRecord(rows[0].key_hash, null);
  return rows.length > 0;
}
