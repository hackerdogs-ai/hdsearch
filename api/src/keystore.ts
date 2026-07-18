// Credential resolution + storage. The rules (spec §7):
//   • Commercial providers need keys configured PER USER, encrypted in Postgres.
//   • In RUN_MODE=dev, a single set of .env keys is used as a fallback for every
//     commercial provider (so a developer can exercise everything locally).
//   • Free / self-hosted providers need no key and are always available.
//
// Keys are encrypted with AES-256-GCM (crypto.ts) before insert and decrypted
// only here, in-process, at call time. A short in-memory cache avoids hitting
// Postgres on every provider call within a request burst.
import { env, isDev } from './env.js';
import { SCHEMA, query, tryQuery, dbAvailable } from './db.js';
import { encryptSecret, decryptSecret, maskSecret } from './crypto.js';
import { log, errFields } from './logger.js';
import { resolveDefaultKey } from './ai/default-keys.js';
import type { ProviderContext } from './providers/types.js';

interface CacheEntry {
  value: string | undefined;
  exp: number;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 15000;

function cacheKey(userId: string | undefined, field: string): string {
  return `${userId || '_dev'}::${field}`;
}

/** Resolve a credential: per-user encrypted key → system default key → dev .env fallback. */
export async function resolveKey(
  userId: string | undefined,
  field: string,
): Promise<string | undefined> {
  const ck = cacheKey(userId, field);
  const hit = cache.get(ck);
  if (hit && hit.exp > Date.now()) return hit.value;

  let value: string | undefined;

  // 1. Per-user encrypted key (highest priority)
  if (userId && dbAvailable()) {
    try {
      const rows = await query<{ secret_enc: string }>(
        `select secret_enc from ${SCHEMA}.user_provider_keys
         where user_id = $1 and field = $2 and status = 'active'
         order by updated_at desc limit 1`,
        [userId, field],
      );
      if (rows[0]?.secret_enc) value = decryptSecret(rows[0].secret_enc);
    } catch (e) {
      log.debug('resolveKey db lookup failed', errFields(e));
    }
  }

  // 2. System default key (set by an admin; applies to all users)
  if (!value) {
    value = await resolveDefaultKey(field);
  }

  // 3. Dev fallback: a single shared key set from .env, only when RUN_MODE=dev.
  if (!value && isDev()) {
    value = env.devKeys[field] || undefined;
  }

  cache.set(ck, { value, exp: Date.now() + TTL_MS });
  return value;
}

/** Build a per-request ProviderContext bound to a user. */
export function contextFor(userId?: string): ProviderContext {
  return {
    userId,
    getKey: (field: string) => resolveKey(userId, field),
  };
}

/** Has this user (or the system default or dev fallback) got every key a provider needs? */
export async function hasKeysFor(
  userId: string | undefined,
  requiresKeys: string[] | undefined,
): Promise<boolean> {
  if (!requiresKeys || requiresKeys.length === 0) return true;
  for (const field of requiresKeys) {
    const v = await resolveKey(userId, field);
    if (!v) return false;
  }
  return true;
}

// ---- management (used by the keys route / user panel) ------------------------

export interface StoredKeyMeta {
  provider: string;
  field: string;
  masked: string;
  status: string;
  updatedAt: string;
}

export async function upsertUserKey(
  userId: string,
  provider: string,
  field: string,
  secret: string,
): Promise<StoredKeyMeta> {
  const enc = encryptSecret(secret);
  const rows = await query<{ updated_at: string }>(
    `insert into ${SCHEMA}.user_provider_keys (user_id, provider, field, secret_enc, status, updated_at)
     values ($1,$2,$3,$4,'active', now())
     on conflict (user_id, field) do update
       set secret_enc = excluded.secret_enc, provider = excluded.provider,
           status = 'active', updated_at = now()
     returning updated_at`,
    [userId, provider, field, enc],
  );
  cache.delete(cacheKey(userId, field));
  return { provider, field, masked: maskSecret(secret), status: 'active', updatedAt: rows[0]!.updated_at };
}

export async function listUserKeys(userId: string): Promise<StoredKeyMeta[]> {
  const rows = await tryQuery<{
    provider: string;
    field: string;
    secret_enc: string;
    status: string;
    updated_at: string;
  }>(
    `select provider, field, secret_enc, status, updated_at
     from ${SCHEMA}.user_provider_keys where user_id = $1 order by provider, field`,
    [userId],
  );
  return rows.map((r) => {
    let masked = '••••';
    try {
      masked = maskSecret(decryptSecret(r.secret_enc));
    } catch {
      /* leave masked */
    }
    return { provider: r.provider, field: r.field, masked, status: r.status, updatedAt: r.updated_at };
  });
}

export async function deleteUserKey(userId: string, field: string): Promise<boolean> {
  const rows = await query<{ field: string }>(
    `delete from ${SCHEMA}.user_provider_keys where user_id = $1 and field = $2 returning field`,
    [userId, field],
  );
  cache.delete(cacheKey(userId, field));
  return rows.length > 0;
}
