// Search history (server tiers). Anonymous/demo users keep history in the browser
// only; signed-in users get a 3-day rolling history in Redis; paid users also get a
// durable archive in S3/SeaweedFS. Recorded best-effort off the search hot path.
import { redis, redisHealthy, k } from './store.js';
import { archiveHistory, deleteHistoryArchives } from './storage.js';
import { log, errFields } from './logger.js';

export interface HistoryEntry {
  q: string;
  modality: string;
  ts: number; // epoch ms
  count?: number;
  source?: 'search' | 'ai';
  model?: string;
}

const MAX_ENTRIES = 200;
const TTL_SEC = 3 * 24 * 3600; // 3 days (logged-in Redis tier)
/** Plans whose users get a durable S3 archive on top of the Redis tier. Shared with
 *  ai-threads.ts so the AI-thread archive uses the exact same paid-plan gate. */
export const PAID_PLANS = new Set(['devtest', 'production', 'enterprise', 'dev']);

const histKey = (userId: string) => k('history', userId);

export async function recordHistory(userId: string, plan: string, entry: HistoryEntry): Promise<void> {
  // logged-in tier: 3-day rolling list in Redis
  if (redisHealthy()) {
    try {
      const key = histKey(userId);
      await redis.lpush(key, JSON.stringify(entry));
      await redis.ltrim(key, 0, MAX_ENTRIES - 1);
      await redis.expire(key, TTL_SEC);
    } catch (e) {
      log.warn('history record failed', errFields(e));
    }
  }
  // paid tier: durable S3/SeaweedFS archive
  if (PAID_PLANS.has(plan)) {
    archiveHistory(userId, entry).catch((e) => log.warn('history archive failed', errFields(e)));
  }
}

export async function listHistory(userId: string, limit = MAX_ENTRIES): Promise<HistoryEntry[]> {
  if (!redisHealthy()) return [];
  try {
    const raw = await redis.lrange(histKey(userId), 0, limit - 1);
    return raw
      .map((s) => {
        try {
          return JSON.parse(s) as HistoryEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is HistoryEntry => !!e);
  } catch (e) {
    log.warn('history list failed', errFields(e));
    return [];
  }
}

export async function clearHistory(userId: string): Promise<void> {
  // Cascade the S3 archive prefix wipe so paid users' account-clear removes both
  // tiers. Fires unconditionally (not gated on paid) since a plan downgrade could
  // leave stale archives around; the clear must sweep them regardless. Best-effort.
  void deleteHistoryArchives(userId);
  if (redisHealthy()) await redis.del(histKey(userId)).catch((e) => log.warn('history clear failed', errFields(e)));
}

export const historyTierFor = (plan: string) => (PAID_PLANS.has(plan) ? 'redis+archive' : 'redis');
