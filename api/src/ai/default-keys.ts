// System-level default provider keys for AI Mode. Super users configure a key
// per (provider field, plan tier). When resolving credentials at call time the
// chain is: per-user encrypted key → plan default key → dev .env fallback.
// Keys are encrypted with the same AES-256-GCM as user keys (crypto.ts).
import { SCHEMA, query, tryQuery, dbAvailable } from '../db.js';
import { encryptSecret, decryptSecret, maskSecret } from '../crypto.js';
import { log, errFields } from '../logger.js';

interface CacheEntry {
  value: string | undefined;
  exp: number;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 30_000;

function ck(field: string, planId: string): string {
  return `sysk::${field}::${planId}`;
}

export async function resolveDefaultKey(
  field: string,
  planId: string,
): Promise<string | undefined> {
  const key = ck(field, planId);
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;

  let value: string | undefined;
  if (dbAvailable()) {
    try {
      const rows = await query<{ secret_enc: string }>(
        `select secret_enc from ${SCHEMA}.system_provider_keys
         where field = $1 and plan_id = $2 and status = 'active'
         order by updated_at desc limit 1`,
        [field, planId],
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
  planId: string;
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
    plan_id: string;
    secret_enc: string;
    label: string | null;
    status: string;
    created_by: string;
    updated_at: string;
  }>(
    `select id, provider, field, plan_id, secret_enc, label, status, created_by, updated_at
     from ${SCHEMA}.system_provider_keys order by provider, field, plan_id`,
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
      planId: r.plan_id,
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
  planId: string,
  secret: string,
  label: string | null,
  adminUserId: string,
): Promise<SystemKeyMeta> {
  const enc = encryptSecret(secret);
  const rows = await query<{
    id: number;
    updated_at: string;
  }>(
    `insert into ${SCHEMA}.system_provider_keys (provider, field, plan_id, secret_enc, label, status, created_by, updated_at)
     values ($1,$2,$3,$4,$5,'active',$6, now())
     on conflict (field, plan_id) do update
       set secret_enc = excluded.secret_enc, provider = excluded.provider,
           label = excluded.label, status = 'active',
           created_by = excluded.created_by, updated_at = now()
     returning id, updated_at`,
    [provider, field, planId, enc, label, adminUserId],
  );
  cache.delete(ck(field, planId));
  return {
    id: rows[0]!.id,
    provider,
    field,
    planId,
    masked: maskSecret(secret),
    label,
    status: 'active',
    createdBy: adminUserId,
    updatedAt: rows[0]!.updated_at,
  };
}

export async function deleteDefaultKey(field: string, planId: string): Promise<boolean> {
  const rows = await query<{ field: string }>(
    `delete from ${SCHEMA}.system_provider_keys where field = $1 and plan_id = $2 returning field`,
    [field, planId],
  );
  cache.delete(ck(field, planId));
  return rows.length > 0;
}

export function invalidateCache(): void {
  cache.clear();
}
