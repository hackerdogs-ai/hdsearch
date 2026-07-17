import { DEFAULT_CACHE_TTL_SEC, normalizeCacheTtlSec } from './cache-ttl.js';
import { SCHEMA, tryQuery } from './db.js';
import { log, errFields } from './logger.js';

export interface ProviderPrefs {
  disabled: string[];
  ranks: Record<string, number>;
  /** Seconds to cache search/crawl results for this user (all providers). */
  cacheTtlSec?: number;
}

const EMPTY: ProviderPrefs = { disabled: [], ranks: {}, cacheTtlSec: DEFAULT_CACHE_TTL_SEC };

const cache = new Map<string, { prefs: ProviderPrefs; at: number }>();
const TTL = 60_000;

export async function getProviderPrefs(userId: string): Promise<ProviderPrefs> {
  try {
    const hit = cache.get(userId);
    if (hit && Date.now() - hit.at < TTL) return hit.prefs;
    const rows = await tryQuery<{ provider_prefs: unknown }>(
      `select provider_prefs from ${SCHEMA}.users where id=$1`,
      [userId],
    );
    const raw = rows[0]?.provider_prefs as Record<string, unknown> | null | undefined;
    const prefs: ProviderPrefs = {
      disabled: Array.isArray(raw?.disabled) ? (raw.disabled as string[]) : [],
      ranks: raw?.ranks && typeof raw.ranks === 'object' && !Array.isArray(raw.ranks)
        ? (raw.ranks as Record<string, number>)
        : {},
      cacheTtlSec: normalizeCacheTtlSec(raw?.cacheTtlSec),
    };
    cache.set(userId, { prefs, at: Date.now() });
    return prefs;
  } catch (e) {
    log.warn('getProviderPrefs failed, returning defaults', { userId, ...errFields(e) });
    return EMPTY;
  }
}

export async function setProviderPrefs(userId: string, prefs: ProviderPrefs): Promise<void> {
  try {
    await tryQuery(
      `update ${SCHEMA}.users set provider_prefs = $2, updated_at = now() where id = $1`,
      [userId, JSON.stringify(prefs)],
    );
    cache.set(userId, { prefs, at: Date.now() });
    log.info('provider prefs saved', {
      userId,
      disabled: prefs.disabled.length,
      ranks: Object.keys(prefs.ranks).length,
      cacheTtlSec: prefs.cacheTtlSec,
    });
  } catch (e) {
    log.error('setProviderPrefs failed', { userId, ...errFields(e) });
    throw e;
  }
}

export function isProviderDisabled(prefs: ProviderPrefs, providerId: string): boolean {
  return prefs.disabled.includes(providerId);
}

export function userPriority(prefs: ProviderPrefs, providerId: string, systemPriority: number, modality?: string): number {
  if (modality) {
    const modalRank = prefs.ranks[`${modality}:${providerId}`];
    if (modalRank != null) return modalRank;
  }
  const rank = prefs.ranks[providerId];
  return rank != null ? rank : systemPriority;
}

export const LLM_RANK_PREFIX = 'llm:';

export function llmRankKey(modelId: string): string {
  return `${LLM_RANK_PREFIX}${modelId}`;
}

/** User-ordered LLM model ids from saved ranks (best-first). */
export function userLlmRankOrder(prefs: ProviderPrefs): string[] {
  return Object.entries(prefs.ranks)
    .filter(([k]) => k.startsWith(LLM_RANK_PREFIX))
    .sort(([, a], [, b]) => a - b)
    .map(([k]) => k.slice(LLM_RANK_PREFIX.length));
}

export function hasUserLlmRanks(prefs: ProviderPrefs): boolean {
  return Object.keys(prefs.ranks).some((k) => k.startsWith(LLM_RANK_PREFIX));
}
