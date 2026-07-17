// S3-compatible object storage (SeaweedFS) for archiving raw crawl payloads
// (spec: "seaweedfs for storage in S3 compatible storage"). Best-effort: the API
// works without it; archival just won't happen. Bucket is auto-created on demand.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { env, s3Path } from './env.js';
import { sha1 } from './cache.js';
import { log, errFields } from './logger.js';
import type { CrawlResult } from './types.js';

const s3 = new S3Client({
  endpoint: env.s3Endpoint,
  region: env.s3Region,
  credentials: { accessKeyId: env.s3Key, secretAccessKey: env.s3Secret },
  forcePathStyle: true, // required for SeaweedFS / MinIO
});

let bucketReady = false;
async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.bucket }));
    bucketReady = true;
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: env.bucket }));
      bucketReady = true;
    } catch (e) {
      log.warn('could not ensure S3 bucket', errFields(e));
    }
  }
}

/** Archive a crawl result; returns the storage key (or throws). */
export async function archiveCrawl(userId: string, result: CrawlResult): Promise<string> {
  await ensureBucket();
  const key = s3Path(`crawls/${userId}/${sha1(result.url)}.json`);
  await s3.send(
    new PutObjectCommand({
      Bucket: env.bucket,
      Key: key,
      Body: JSON.stringify(result),
      ContentType: 'application/json',
    }),
  );
  return key;
}

// Durable search-history archive for paid users (beyond the 3-day Redis window).
// One immutable object per entry; listable under history/<userId>/.
export async function archiveHistory(userId: string, entry: { q: string; modality: string; ts: number }): Promise<string> {
  await ensureBucket();
  const key = s3Path(`history/${userId}/${entry.ts}_${sha1(entry.q + entry.modality)}.json`);
  await s3.send(
    new PutObjectCommand({ Bucket: env.bucket, Key: key, Body: JSON.stringify(entry), ContentType: 'application/json' }),
  );
  return key;
}

// Durable AI-thread archive for paid users. One immutable object per completed turn
// under ai-threads/<userId>/<threadId>/<updatedAt>_<sha1>.json. Same shape and lifecycle
// as archiveHistory. Best-effort — callers wrap with .catch() so a failed archive
// never breaks the chat path.
export async function archiveAiThread(userId: string, threadId: string, blob: unknown, updatedAt: number): Promise<string> {
  // Serialize SYNCHRONOUSLY at call time — the caller may mutate `blob` after this
  // returns but before we actually hit the network (e.g. Redis truncation in
  // saveAiThread runs during our ensureBucket() await), and we want the durable
  // archive to hold the pre-mutation snapshot.
  const payload = JSON.stringify(blob);
  await ensureBucket();
  const key = s3Path(`ai-threads/${userId}/${threadId}/${updatedAt}_${sha1(payload).slice(0, 12)}.json`);
  await s3.send(
    new PutObjectCommand({ Bucket: env.bucket, Key: key, Body: payload, ContentType: 'application/json' }),
  );
  return key;
}

// Delete every archived object under an S3 prefix. Paginates ListObjectsV2 and uses
// batched DeleteObjects (1000/call). Best-effort: individual failures are logged but
// the caller sees no error unless we couldn't reach S3 at all. Used to cascade the
// prefix wipe from Redis DELETEs so no orphan objects accumulate.
async function purgePrefix(prefix: string): Promise<number> {
  await ensureBucket();
  let removed = 0;
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: env.bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }),
    );
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((k) => !!k.Key);
    if (keys.length) {
      const res = await s3.send(
        new DeleteObjectsCommand({ Bucket: env.bucket, Delete: { Objects: keys, Quiet: true } }),
      );
      removed += keys.length;
      // AWS may partially fail — surface enough for triage without failing the caller.
      if (res.Errors?.length) {
        log.warn('s3 delete partial failure', { prefix, count: res.Errors.length, first: res.Errors[0]?.Key });
      }
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return removed;
}

/** Delete every archived revision of one AI thread (or all threads for a user when threadId is omitted). */
export async function deleteAiThreadArchives(userId: string, threadId?: string): Promise<void> {
  const prefix = s3Path(threadId ? `ai-threads/${userId}/${threadId}/` : `ai-threads/${userId}/`);
  try {
    const n = await purgePrefix(prefix);
    if (n) log.info('ai thread archives purged', { userId, threadId: threadId ?? '*', count: n });
  } catch (e) {
    log.warn('ai thread archive purge failed', { prefix, ...errFields(e) });
  }
}

/** Delete every archived search-history entry for a user. Closes the pre-existing
 *  gap where clearHistory only wiped Redis and left S3 objects orphaned. */
export async function deleteHistoryArchives(userId: string): Promise<void> {
  const prefix = s3Path(`history/${userId}/`);
  try {
    const n = await purgePrefix(prefix);
    if (n) log.info('history archives purged', { userId, count: n });
  } catch (e) {
    log.warn('history archive purge failed', { prefix, ...errFields(e) });
  }
}

// ---------------------------------------------------------------------------
// User-uploaded files (RAG). Raw bytes stored under files/<userId>/<threadId>/<fileId>/raw/<name>.
// ---------------------------------------------------------------------------

/** Store raw file bytes. Returns the storage key (or throws on hard S3 failure). */
export async function putFile(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType?: string,
): Promise<string> {
  await ensureBucket();
  await s3.send(
    new PutObjectCommand({
      Bucket: env.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    }),
  );
  return key;
}

/** Read a raw object back as a Buffer for processing. Returns null if missing/unreachable. */
export async function getFileBuffer(key: string): Promise<Buffer | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: env.bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    return bytes ? Buffer.from(bytes) : null;
  } catch (e) {
    log.debug('file fetch failed', errFields(e));
    return null;
  }
}

/** Stream a raw object for a download response (or null). */
export async function getFileStream(key: string): Promise<{ body: ReadableStream | null; contentType?: string; contentLength?: number } | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: env.bucket, Key: key }));
    return {
      body: (res.Body as any)?.transformToWebStream?.() ?? null,
      contentType: res.ContentType,
      contentLength: res.ContentLength,
    };
  } catch (e) {
    log.debug('file stream failed', errFields(e));
    return null;
  }
}

/**
 * Delete every stored file object for a thread (or all threads for a user when
 * threadId is omitted). Best-effort; part of the chat-delete cascade so no orphan
 * bytes remain. Returns count removed.
 */
export async function deleteFileObjects(userId: string, threadId?: string): Promise<number> {
  const prefix = s3Path(threadId ? `files/${userId}/${threadId}/` : `files/${userId}/`);
  try {
    const n = await purgePrefix(prefix);
    if (n) log.info('file objects purged', { userId, threadId: threadId ?? '*', count: n });
    return n;
  } catch (e) {
    log.warn('file object purge failed', { prefix, ...errFields(e) });
    return 0;
  }
}

/** Delete a single file's objects (its whole fileId prefix). */
export async function deleteOneFileObjects(userId: string, threadId: string, fileId: string): Promise<number> {
  const prefix = s3Path(`files/${userId}/${threadId}/${fileId}/`);
  try {
    return await purgePrefix(prefix);
  } catch (e) {
    log.warn('single file purge failed', { prefix, ...errFields(e) });
    return 0;
  }
}

export async function getArchived(key: string): Promise<string | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: env.bucket, Key: key }));
    return (await res.Body?.transformToString()) ?? null;
  } catch (e) {
    log.debug('archive fetch failed', errFields(e));
    return null;
  }
}

export async function storageHealthy(): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.bucket }));
    return true;
  } catch {
    await ensureBucket();
    return bucketReady;
  }
}
