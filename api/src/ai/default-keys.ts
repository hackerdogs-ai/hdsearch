// System-level default provider keys. Admins configure a key per provider field;
// it applies to ALL users (the open-source build has no plan tiers). When resolving
// credentials at call time the chain is: per-user encrypted key → system default
// key → dev .env fallback. Keys are AES-256-GCM encrypted like user keys (crypto.ts).
import { SCHEMA, query, tryQuery, dbAvailable } from '../db.js';
import { encryptSecret, decryptSecret, maskSecret } from '../crypto.js';
import { log, errFields } from '../logger.js';

interface CacheEntry {
  value: string | undefined;
  exp: number;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 30_000;

function ck(field: string): string {
  return `sysk::${field}`;
}

// Resolve the system default key for a provider field, regardless of plan tier —
// a system key set by an admin applies to every user (no plans in the OSS build).
export async function resolveDefaultKey(field: string): Promise<string | undefined> {
  const key = ck(field);
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;

  let value: string | undefined;
  if (dbAvailable()) {
    try {
      const rows = await query<{ secret_enc: string }>(
        `select secret_enc from ${SCHEMA}.system_provider_keys
         where field = $1 and status = 'active'
         order by updated_at desc limit 1`,
        [field],
      );
      if (rows[0]?.secret_enc) value = decryptSecret(rows[0].secret_enc);
    } catch (e) {
      log.debug('resolveDefaultKey db lookup failed', errFields(e));
    }
  }
  cache.set(key, { value, exp: Date.now() + TTL_MS });
  return value;
}

export interface SystemKeyMeta {
  id: number;
  provider: string;
  field: string;
  masked: string;
  label: string | null;
  status: string;
  createdBy: string;
  updatedAt: string;
}

export async function listDefaultKeys(): Promise<SystemKeyMeta[]> {
  const rows = await tryQuery<{
    id: number;
    provider: string;
    field: string;
    secret_enc: string;
    label: string | null;
    status: string;
    created_by: string;
    updated_at: string;
  }>(
    `select id, provider, field, secret_enc, label, status, created_by, updated_at
     from ${SCHEMA}.system_provider_keys order by provider, field`,
    [],
  );
  return rows.map((r) => {
    let masked = '••••';
    try {
      masked = maskSecret(decryptSecret(r.secret_enc));
    } catch { /* leave masked */ }
    return {
      id: r.id,
      provider: r.provider,
      field: r.field,
      masked,
      label: r.label,
      status: r.status,
      createdBy: r.created_by,
      updatedAt: r.updated_at,
    };
  });
}

export async function upsertDefaultKey(
  provider: string,
  field: string,
  secret: string,
  label: string | null,
  adminUserId: string,
): Promise<SystemKeyMeta> {
  const enc = encryptSecret(secret);
  // One system key per provider field (no plan tiers). plan_id is pinned to 'all'
  // for schema compatibility; any legacy per-tier rows for this field are dropped.
  await query(`delete from ${SCHEMA}.system_provider_keys where field = $1 and plan_id <> 'all'`, [field]);
  const rows = await query<{
    id: number;
    updated_at: string;
  }>(
    `insert into ${SCHEMA}.system_provider_keys (provider, field, plan_id, secret_enc, label, status, created_by, updated_at)
     values ($1,$2,'all',$3,$4,'active',$5, now())
     on conflict (field, plan_id) do update
       set secret_enc = excluded.secret_enc, provider = excluded.provider,
           label = excluded.label, status = 'active',
           created_by = excluded.created_by, updated_at = now()
     returning id, updated_at`,
    [provider, field, enc, label, adminUserId],
  );
  cache.delete(ck(field));
  return {
    id: rows[0]!.id,
    provider,
    field,
    masked: maskSecret(secret),
    label,
    status: 'active',
    createdBy: adminUserId,
    updatedAt: rows[0]!.updated_at,
  };
}

export async function deleteDefaultKey(field: string): Promise<boolean> {
  const rows = await query<{ field: string }>(
    `delete from ${SCHEMA}.system_provider_keys where field = $1 returning field`,
    [field],
  );
  cache.delete(ck(field));
  return rows.length > 0;
}

export function invalidateCache(): void {
  cache.clear();
}
