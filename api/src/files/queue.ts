// Durable, resumable processing queue on Redis (no external broker). Reliable-queue
// pattern: claim moves a job from the pending list to an in-flight list atomically
// (RPOPLPUSH); a heartbeat marks liveness; a reaper requeues jobs whose worker died
// (stale heartbeat). Bounded retries then dead-letter. Everything is best-effort and
// guarded on redisHealthy() so a Redis outage degrades to the Postgres-scan fallback
// (docs/file-upload-rag.md §C.6).
import { redis, redisHealthy, k } from '../store.js';
import { env } from '../env.js';
import { log, errFields } from '../logger.js';

const PENDING = k('files', 'jobs'); // LIST of fileIds waiting
const INFLIGHT = k('files', 'processing'); // LIST of fileIds claimed
const FAILED = k('files', 'failed'); // dead-letter LIST
const jobKey = (fileId: string) => k('files', 'job', fileId); // HASH payload + heartbeat
const JOB_TTL = 7 * 24 * 3600; // job metadata self-cleans after a week

export interface JobPayload {
  fileId: string;
  userId: string;
  threadId: string;
  s3Key: string;
  attempts: number;
}

/** Add a file to the pending queue. Best-effort; the Postgres row is the durable record. */
export async function enqueue(p: Omit<JobPayload, 'attempts'>): Promise<void> {
  if (!redisHealthy()) return;
  try {
    const pipe = redis.pipeline();
    pipe.hset(jobKey(p.fileId), {
      fileId: p.fileId,
      userId: p.userId,
      threadId: p.threadId,
      s3Key: p.s3Key,
      attempts: '0',
      enqueuedAt: String(Date.now()),
    });
    pipe.expire(jobKey(p.fileId), JOB_TTL);
    pipe.lrem(PENDING, 0, p.fileId); // avoid dupes on replay
    pipe.lpush(PENDING, p.fileId);
    await pipe.exec();
  } catch (e) {
    log.warn('file enqueue failed', { fileId: p.fileId, ...errFields(e) });
  }
}

/** Atomically claim the next pending job → in-flight. Returns null if none/unavailable. */
export async function claim(): Promise<JobPayload | null> {
  if (!redisHealthy()) return null;
  try {
    const fileId = (await redis.rpoplpush(PENDING, INFLIGHT)) as string | null;
    if (!fileId) return null;
    const h = await redis.hgetall(jobKey(fileId));
    const attempts = Number(h.attempts || '0');
    await redis.hset(jobKey(fileId), { heartbeat: String(Date.now()) });
    return {
      fileId,
      userId: h.userId || '',
      threadId: h.threadId || '',
      s3Key: h.s3Key || '',
      attempts,
    };
  } catch (e) {
    log.warn('file claim failed', errFields(e));
    return null;
  }
}

export async function heartbeat(fileId: string): Promise<void> {
  if (!redisHealthy()) return;
  try {
    await redis.hset(jobKey(fileId), { heartbeat: String(Date.now()) });
  } catch {
    /* transient */
  }
}

/** Successful completion: drop from in-flight and delete the job hash. */
export async function ack(fileId: string): Promise<void> {
  if (!redisHealthy()) return;
  try {
    const pipe = redis.pipeline();
    pipe.lrem(INFLIGHT, 0, fileId);
    pipe.del(jobKey(fileId));
    await pipe.exec();
  } catch (e) {
    log.warn('file ack failed', { fileId, ...errFields(e) });
  }
}

/**
 * Failure: increment attempts; requeue if under the cap, else dead-letter. Returns
 * true when the job was retried (caller should NOT mark the file failed yet).
 */
export async function retryOrFail(fileId: string): Promise<boolean> {
  if (!redisHealthy()) return false;
  try {
    const attempts = Number((await redis.hget(jobKey(fileId), 'attempts')) || '0') + 1;
    await redis.hset(jobKey(fileId), { attempts: String(attempts) });
    await redis.lrem(INFLIGHT, 0, fileId);
    if (attempts < env.file.maxAttempts) {
      await redis.lpush(PENDING, fileId);
      return true;
    }
    await redis.lpush(FAILED, fileId);
    await redis.del(jobKey(fileId));
    return false;
  } catch (e) {
    log.warn('file retryOrFail failed', { fileId, ...errFields(e) });
    return false;
  }
}

/**
 * Requeue any in-flight job whose heartbeat is stale (worker crashed mid-process).
 * Returns the number requeued.
 */
export async function reap(staleMs: number): Promise<number> {
  if (!redisHealthy()) return 0;
  let requeued = 0;
  try {
    const inflight = await redis.lrange(INFLIGHT, 0, -1);
    const now = Date.now();
    for (const fileId of inflight) {
      const hb = Number((await redis.hget(jobKey(fileId), 'heartbeat')) || '0');
      if (now - hb > staleMs) {
        // fold back through retryOrFail so a repeatedly-crashing file eventually dead-letters
        const retried = await retryOrFail(fileId);
        requeued += retried ? 1 : 0;
        if (!retried) log.warn('file dead-lettered after stale heartbeat', { fileId });
      }
    }
  } catch (e) {
    log.warn('file reap failed', errFields(e));
  }
  return requeued;
}

/** Remove a file from every queue tier (used by the delete cascade). */
export async function removeJob(fileId: string): Promise<void> {
  if (!redisHealthy()) return;
  try {
    const pipe = redis.pipeline();
    pipe.lrem(PENDING, 0, fileId);
    pipe.lrem(INFLIGHT, 0, fileId);
    pipe.lrem(FAILED, 0, fileId);
    pipe.del(jobKey(fileId));
    await pipe.exec();
  } catch (e) {
    log.warn('file removeJob failed', { fileId, ...errFields(e) });
  }
}

/** Best-effort depth snapshot for health/metrics. */
export async function queueDepth(): Promise<{ pending: number; inflight: number; failed: number }> {
  if (!redisHealthy()) return { pending: 0, inflight: 0, failed: 0 };
  try {
    const [pending, inflight, failed] = await Promise.all([
      redis.llen(PENDING),
      redis.llen(INFLIGHT),
      redis.llen(FAILED),
    ]);
    return { pending, inflight, failed };
  } catch {
    return { pending: 0, inflight: 0, failed: 0 };
  }
}
