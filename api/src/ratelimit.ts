// Per-key sliding-window rate limiting backed by Redis (atomic INCR+EXPIRE).
// Fails OPEN when Redis is down — availability over strictness, since the
// computed-cache already shields upstreams from abuse.
import { redis, redisHealthy, markRedisDown, k } from './store.js';

export interface RateResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetSec: number;
}

export async function rateLimit(id: string, perMin: number): Promise<RateResult> {
  const limit = Math.max(1, perMin);
  if (!redisHealthy()) return { allowed: true, remaining: limit, limit, resetSec: 60 };

  const windowId = Math.floor(Date.now() / 60000);
  const key = k('rl', id, String(windowId));
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 65);
    const ttl = await redis.ttl(key);
    return {
      allowed: n <= limit,
      remaining: Math.max(0, limit - n),
      limit,
      resetSec: ttl > 0 ? ttl : 60,
    };
  } catch (e) {
    markRedisDown(e);
    return { allowed: true, remaining: limit, limit, resetSec: 60 };
  }
}
