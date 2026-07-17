// Redis connection + health tracking. Mirrors hd-feeds resiliency: a tripped
// "redis down" flag lets hot paths fail fast / serve from local caches instead
// of blocking on a dead socket. Auto-recovers on the next successful command.
import Redis from 'ioredis';
import { env } from './env.js';
import { log, errFields } from './logger.js';

export const redis = new Redis(env.redisUrl, {
  lazyConnect: false,
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  connectTimeout: 5000,
  retryStrategy: (times) => Math.min(times * 200, 3000),
});

// Dedicated connection for the RediSearch vector index. RediSearch only indexes db 0, so
// the vector docs + index live on db 0 (env.vectorRedisUrl) while everything else uses the
// isolated db above. Same host; only the logical db differs. See vector.ts.
export const vectorRedis =
  env.vectorRedisUrl === env.redisUrl
    ? redis
    : new Redis(env.vectorRedisUrl, {
        lazyConnect: false,
        maxRetriesPerRequest: 2,
        enableReadyCheck: true,
        connectTimeout: 5000,
        retryStrategy: (times) => Math.min(times * 200, 3000),
      });
if (vectorRedis !== redis) {
  vectorRedis.on('error', (e) => {
    const now = Date.now();
    if (now - lastDownLog > 10000) {
      lastDownLog = now;
      log.warn('vector redis (db0) unavailable', errFields(e));
    }
  });
}

let healthy = true;
let lastDownLog = 0;

redis.on('error', (e) => markRedisDown(e));
redis.on('ready', () => {
  if (!healthy) log.info('redis recovered');
  healthy = true;
});

export function redisHealthy(): boolean {
  return healthy;
}

export function markRedisDown(e: unknown): void {
  healthy = false;
  const now = Date.now();
  if (now - lastDownLog > 10000) {
    lastDownLog = now;
    log.warn('redis unavailable', errFields(e));
  }
}

/** Prefix a key with the service namespace, e.g. k('cache','abc') -> hds:cache:abc */
export function k(...parts: string[]): string {
  return [env.keyPrefix, ...parts].join(':');
}

export async function pingRedis(): Promise<boolean> {
  try {
    await redis.ping();
    healthy = true;
    return true;
  } catch (e) {
    markRedisDown(e);
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  for (const c of vectorRedis === redis ? [redis] : [redis, vectorRedis]) {
    try {
      await c.quit();
    } catch {
      c.disconnect();
    }
  }
}
