// AI chat thread persistence (server tiers). Mirrors the search-history pattern in
// history.ts: signed-in users get a 3-day rolling store in Redis; paid users also
// get a durable S3 archive of the full untruncated blob (P2). Threads are mutable,
// so the index is a ZSET keyed by updatedAt (vs. history's append-only LIST), and
// the full blob lives in a separate STRING for cheap sidebar reads. Demo,
// anonymous, and temporary-mode chats are never persisted here. Delete cascades
// through S3 too — the product must never leak orphan archive objects.
// Best-effort: failures never block the chat path.
import { redis, redisHealthy, k } from './store.js';
import { log, errFields } from './logger.js';
import { archiveEligible } from './history.js';
import { archiveAiThread, deleteAiThreadArchives } from './storage.js';
import { deleteFilesForThread, deleteAllUserFiles } from './files/cascade.js';
import { clearThreadFolder } from './files/folders.js';

const MAX_THREADS = 200;
const TTL_SEC = 3 * 24 * 3600;          // 3 days, same rolling window as search history
const MAX_BLOB_BYTES = 512 * 1024;      // 512 KB cap; truncate oldest tool payloads first
const MAX_MESSAGES = 100;               // and/or 100 messages, whichever first

export type AiContentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown; result?: unknown; isError?: boolean };

export interface AiMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  content: AiContentPart[];
  createdAt: number;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

export interface AiThreadBlob {
  threadId: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AiMessageRecord[];
  temporary: false;                     // never true in storage; temp threads are never written
}

export interface AiThreadIndexEntry {
  threadId: string;
  title: string;
  ts: number;                           // = updatedAt, mirrors zset score
  messageCount: number;
  model?: string;
}

// Sorted-set index per user. Score = updatedAt (ms). Member = threadId.
// Mutable threads need upsert semantics; LIST + LPUSH would create duplicates.
const indexKey = (userId: string) => k('ai', 'threads', userId);
// Small per-thread metadata blob (title, messageCount, model) — read on sidebar list.
const metaKey  = (userId: string, threadId: string) => k('ai', 'thread', 'meta', userId, threadId);
// Full body for restore on thread open.
const bodyKey  = (userId: string, threadId: string) => k('ai', 'thread', 'body', userId, threadId);

function truncateBlob(blob: AiThreadBlob): AiThreadBlob {
  // Cap by message count first — cheap and O(1).
  if (blob.messages.length > MAX_MESSAGES) {
    blob.messages = blob.messages.slice(-MAX_MESSAGES);
  }
  // Fast path — under budget, one serialization.
  if (JSON.stringify(blob).length <= MAX_BLOB_BYTES) return blob;

  // Over budget: tool results dominate blob size. Strip them ALL in one pass and
  // check again. This is an aggressive trade — we lose fidelity in older tool
  // results even if some could fit — but avoids the O(n²) restringify-per-part
  // loop that used to burn ~25ms on tool-heavy chats. Message text (user-authored,
  // small) is preserved for the transcript.
  for (const m of blob.messages) {
    for (const part of m.content) {
      if (part.type === 'tool-call' && part.result !== undefined) {
        part.result = { truncated: true };
      }
    }
  }
  if (JSON.stringify(blob).length <= MAX_BLOB_BYTES) return blob;

  // Still over budget — the text itself is huge (pathological case). Drop oldest
  // messages until it fits. Check every drop so we stop as soon as we're under.
  while (blob.messages.length > 1 && JSON.stringify(blob).length > MAX_BLOB_BYTES) {
    blob.messages.shift();
  }
  return blob;
}

/**
 * Persist a thread blob.
 * - Redis (hot tier): always attempted for signed-in users, TTL 3 days, truncated blob.
 * - S3 (durable archive): fired in parallel for every non-demo user, untruncated blob.
 * Both paths are best-effort — failures are logged, never thrown.
 */
export async function saveAiThread(blob: AiThreadBlob): Promise<void> {
  // Fire the S3 archive with the FULL blob (unaffected by Redis truncation) before
  // the hot-tier work, so the durable copy is written even if Redis is down.
  if (archiveEligible(blob.userId)) {
    archiveAiThread(blob.userId, blob.threadId, blob, blob.updatedAt).catch((e) =>
      log.warn('ai thread archive failed', errFields(e)),
    );
  }

  if (!redisHealthy()) return;
  try {
    const trimmed = truncateBlob({ ...blob, messages: [...blob.messages] });
    const meta: AiThreadIndexEntry = {
      threadId: trimmed.threadId,
      title: trimmed.title,
      ts: trimmed.updatedAt,
      messageCount: trimmed.messages.length,
      model: [...trimmed.messages].reverse().find((m) => m.model)?.model,
    };
    const ix = indexKey(trimmed.userId);
    const mk = metaKey(trimmed.userId, trimmed.threadId);
    const bk = bodyKey(trimmed.userId, trimmed.threadId);

    // Save + read post-save count in ONE pipeline. Later commands in an ioredis
    // pipeline see the effects of earlier ones on Redis's view, so zcard reflects
    // the post-ZADD size. Eliminates a follow-up round trip on every save.
    const pipe = redis.pipeline();
    pipe.zadd(ix, trimmed.updatedAt, trimmed.threadId);
    pipe.set(mk, JSON.stringify(meta), 'EX', TTL_SEC);
    pipe.set(bk, JSON.stringify(trimmed), 'EX', TTL_SEC);
    pipe.expire(ix, TTL_SEC);
    pipe.zcard(ix);
    const results = await pipe.exec();

    // Cap thread count: oldest (lowest score) wins eviction. Rare path — only
    // triggers when a user crosses MAX_THREADS. We drop the meta + body too so
    // no orphan STRINGs remain.
    const count = Number(results?.[4]?.[1] ?? 0);
    if (count > MAX_THREADS) {
      const evict = await redis.zrange(ix, 0, count - MAX_THREADS - 1);
      if (evict.length) {
        const evictPipe = redis.pipeline();
        evictPipe.zrem(ix, ...evict);
        for (const tid of evict) {
          evictPipe.del(metaKey(trimmed.userId, tid));
          evictPipe.del(bodyKey(trimmed.userId, tid));
        }
        await evictPipe.exec();
      }
    }
  } catch (e) {
    log.warn('ai thread save failed', errFields(e));
  }
}

/** Most-recent-first index entries for the sidebar. Empty if Redis is down. */
export async function listAiThreadIndex(userId: string, limit = MAX_THREADS): Promise<AiThreadIndexEntry[]> {
  if (!redisHealthy()) return [];
  try {
    const ids = await redis.zrevrange(indexKey(userId), 0, Math.max(0, limit - 1));
    if (!ids.length) return [];
    const pipe = redis.pipeline();
    for (const tid of ids) pipe.get(metaKey(userId, tid));
    const res = await pipe.exec();
    const out: AiThreadIndexEntry[] = [];
    res?.forEach(([, val]) => {
      if (typeof val !== 'string') return;
      try { out.push(JSON.parse(val) as AiThreadIndexEntry); } catch { /* skip */ }
    });
    return out;
  } catch (e) {
    log.warn('ai thread list failed', errFields(e));
    return [];
  }
}

/** Load full thread body. Returns null if missing, expired, or Redis is down. */
export async function loadAiThread(userId: string, threadId: string): Promise<AiThreadBlob | null> {
  if (!redisHealthy()) return null;
  try {
    const raw = await redis.get(bodyKey(userId, threadId));
    if (!raw) return null;
    const blob = JSON.parse(raw) as AiThreadBlob;
    if (blob.userId !== userId) return null;                  // defense-in-depth, key already scoped
    return blob;
  } catch (e) {
    log.warn('ai thread load failed', errFields(e));
    return null;
  }
}

/** Rename: updates meta + body title, refreshes TTL on the rolling window. */
export async function renameAiThread(userId: string, threadId: string, title: string): Promise<boolean> {
  if (!redisHealthy()) return false;
  try {
    const blob = await loadAiThread(userId, threadId);
    if (!blob) return false;
    blob.title = title;
    blob.updatedAt = Date.now();
    await saveAiThread(blob);
    return true;
  } catch (e) {
    log.warn('ai thread rename failed', errFields(e));
    return false;
  }
}

/**
 * Delete one thread. Cascades the S3 archive prefix wipe so no orphan revisions
 * remain — user asked for zero orphan data anywhere. Both tiers are best-effort
 * and fire independently: a Redis outage doesn't stop the S3 cleanup, and vice
 * versa.
 */
export async function deleteAiThread(userId: string, threadId: string): Promise<void> {
  // S3 cleanup fires unconditionally (not gated on paid) — a plan downgrade could
  // leave a paid user's old archives sitting around; the delete must sweep them.
  void deleteAiThreadArchives(userId, threadId);
  // Cascade: uploaded files (S3 + vector + Postgres + queue) and folder assignment.
  // Independent best-effort tiers — a Redis outage doesn't stop the file/S3 cleanup.
  void deleteFilesForThread(userId, threadId);
  void clearThreadFolder(userId, threadId);
  if (!redisHealthy()) return;
  try {
    const pipe = redis.pipeline();
    pipe.zrem(indexKey(userId), threadId);
    pipe.del(metaKey(userId, threadId));
    pipe.del(bodyKey(userId, threadId));
    await pipe.exec();
  } catch (e) {
    log.warn('ai thread delete failed', errFields(e));
  }
}

/** Wipe all AI threads for a user (account clear) — Redis keyspace + S3 prefix. */
export async function clearAiThreads(userId: string): Promise<void> {
  void deleteAiThreadArchives(userId);
  // Cascade: wipe every uploaded file for the user (S3 prefix + all thread namespaces).
  void deleteAllUserFiles(userId);
  if (!redisHealthy()) return;
  try {
    const ids = await redis.zrange(indexKey(userId), 0, -1);
    const pipe = redis.pipeline();
    pipe.del(indexKey(userId));
    for (const tid of ids) {
      pipe.del(metaKey(userId, tid));
      pipe.del(bodyKey(userId, tid));
    }
    await pipe.exec();
  } catch (e) {
    log.warn('ai thread clear failed', errFields(e));
  }
}

/** True when this is the first turn the server has seen for a (user, thread) pair. */
export async function isFirstTurn(userId: string, threadId: string): Promise<boolean> {
  if (!redisHealthy()) return true;
  try {
    const score = await redis.zscore(indexKey(userId), threadId);
    return score === null;
  } catch {
    return true;
  }
}

/** Tier label for the /v1/ai/threads response — mirrors historyTierFor so the client
 *  can show the same "Synced · 3-day server history + durable archive" copy. */
export const aiThreadTierFor = (userId: string) => (archiveEligible(userId) ? 'redis+archive' : 'redis');
