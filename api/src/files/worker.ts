// In-process file-processing workers. Concurrency-bounded so a burst of 200 MB
// files can't exhaust memory. Resilience layers (docs/file-upload-rag.md §C.6):
//   • reliable Redis queue (primary) with heartbeat + reaper for crash recovery
//   • Postgres-scan fallback when Redis is down (rows stuck in queued/processing)
//   • startup reconcile requeues anything left mid-flight by a previous crash
// start/stop are idempotent and safe to call from boot + graceful shutdown.
import { env } from '../env.js';
import { log, errFields } from '../logger.js';
import { redisHealthy } from '../store.js';
import { claim, heartbeat, ack, retryOrFail, reap, enqueue, queueDepth, type JobPayload } from './queue.js';
import { setProcessing, setFailed, findStuck } from './db.js';
import { processFile } from './process.js';

let running = false;
const loops: Promise<void>[] = [];
let reaper: NodeJS.Timeout | undefined;
const localInflight = new Set<string>(); // dedupe for the Redis-down DB fallback

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startFileWorkers(): void {
  if (running) return;
  running = true;
  void reconcileOnStart();
  for (let i = 0; i < env.file.workerConcurrency; i++) loops.push(workerLoop(i));
  reaper = setInterval(() => {
    void reap(env.file.jobStaleMs).then((n) => {
      if (n) log.info('file reaper requeued stale jobs', { count: n });
    });
  }, Math.max(15000, Math.floor(env.file.jobStaleMs / 2)));
  if (reaper.unref) reaper.unref();
  log.info('file workers started', { concurrency: env.file.workerConcurrency });
}

export async function stopFileWorkers(): Promise<void> {
  running = false;
  if (reaper) clearInterval(reaper);
  await Promise.allSettled(loops).catch(() => {});
  loops.length = 0;
}

async function workerLoop(id: number): Promise<void> {
  while (running) {
    let job: JobPayload | null = null;
    try {
      job = await claim();
      if (!job) job = await claimFromDb(); // Redis-down / empty-queue fallback
    } catch (e) {
      log.debug('claim error', { id, ...errFields(e) });
    }
    if (!job) {
      await sleep(1500);
      continue;
    }
    await runJob(job).catch((e) => log.warn('runJob crashed', { fileId: job!.fileId, ...errFields(e) }));
  }
}

async function runJob(job: JobPayload): Promise<void> {
  await setProcessing(job.fileId);
  const hb = setInterval(() => void heartbeat(job.fileId), 5000);
  if (hb.unref) hb.unref();
  try {
    const outcome = await processFile(job); // sets the row to ready/failed internally
    await ack(job.fileId); // terminal either way — remove from the queue
    if (outcome === 'failed') log.info('file reached terminal failed state', { fileId: job.fileId });
  } catch (e) {
    // Transient failure (e.g. S3 unreadable) — bounded retry, then dead-letter + mark failed.
    const retried = await retryOrFail(job.fileId);
    if (!retried) await setFailed(job.fileId, (e as Error).message || 'processing error');
    log.warn('file processing error', { fileId: job.fileId, retried, ...errFields(e) });
  } finally {
    clearInterval(hb);
    localInflight.delete(job.fileId);
  }
}

/**
 * Fallback claimer used when Redis is unavailable (queue ops are no-ops then).
 * Pulls a stuck row straight from Postgres, deduped by a local in-flight set so
 * two workers in one process don't grab the same row. Bounded and best-effort.
 */
async function claimFromDb(): Promise<JobPayload | null> {
  if (redisHealthy()) return null; // Redis path already covers this case
  const stuck = await findStuck(env.file.workerConcurrency * 3);
  for (const f of stuck) {
    if (localInflight.has(f.id)) continue;
    if (f.attempts >= env.file.maxAttempts) {
      await setFailed(f.id, 'exceeded max attempts (redis unavailable)');
      continue;
    }
    localInflight.add(f.id);
    return { fileId: f.id, userId: f.userId, threadId: f.threadId || '', s3Key: f.s3Key, attempts: f.attempts };
  }
  return null;
}

/** On boot, requeue anything a prior crash left mid-flight. */
async function reconcileOnStart(): Promise<void> {
  try {
    const reaped = await reap(0); // any in-flight with no live heartbeat this process
    const stuck = await findStuck(500);
    let requeued = 0;
    if (redisHealthy()) {
      for (const f of stuck) {
        if (f.attempts >= env.file.maxAttempts) {
          await setFailed(f.id, 'exceeded max attempts on reconcile');
          continue;
        }
        await enqueue({ fileId: f.id, userId: f.userId, threadId: f.threadId || '', s3Key: f.s3Key });
        requeued++;
      }
    }
    const depth = await queueDepth();
    log.info('file worker reconcile complete', { reaped, requeued, ...depth });
  } catch (e) {
    log.warn('file worker reconcile failed', errFields(e));
  }
}
