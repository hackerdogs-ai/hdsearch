// Postgres data-access for uploaded files. Source of truth for file identity +
// status. All writes are best-effort where the caller can tolerate it (tryQuery),
// but create/read use query() so the upload route can surface a hard DB failure.
import { query, tryQuery, SCHEMA } from '../db.js';
import { log, errFields } from '../logger.js';

export type FileStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface FileRecord {
  id: string;
  userId: string;
  threadId: string | null;
  folderId: string | null;
  name: string;
  ext: string | null;
  mime: string | null;
  sizeBytes: number;
  sha256: string | null;
  s3Key: string;
  namespace: string;
  processor: string | null;
  status: FileStatus;
  degraded: boolean;
  error: string | null;
  pages: number | null;
  chunksTotal: number;
  chunksIndexed: number;
  preview: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  user_id: string;
  thread_id: string | null;
  folder_id: string | null;
  name: string;
  ext: string | null;
  mime: string | null;
  size_bytes: string | number;
  sha256: string | null;
  s3_key: string;
  namespace: string;
  processor: string | null;
  status: FileStatus;
  degraded: boolean;
  error: string | null;
  pages: number | null;
  chunks_total: number;
  chunks_indexed: number;
  preview: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

function map(r: Row): FileRecord {
  return {
    id: r.id,
    userId: r.user_id,
    threadId: r.thread_id,
    folderId: r.folder_id,
    name: r.name,
    ext: r.ext,
    mime: r.mime,
    sizeBytes: Number(r.size_bytes),
    sha256: r.sha256,
    s3Key: r.s3_key,
    namespace: r.namespace,
    processor: r.processor,
    status: r.status,
    degraded: r.degraded,
    error: r.error,
    pages: r.pages,
    chunksTotal: r.chunks_total,
    chunksIndexed: r.chunks_indexed,
    preview: r.preview,
    attempts: r.attempts,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface NewFile {
  id: string;
  userId: string;
  threadId: string | null;
  folderId: string | null;
  name: string;
  ext: string | null;
  mime: string | null;
  sizeBytes: number;
  sha256: string | null;
  s3Key: string;
  namespace: string;
}

/** Insert a queued file row. Idempotent on id (safe to replay). Throws on hard DB failure. */
export async function createFile(f: NewFile): Promise<void> {
  await query(
    `insert into ${SCHEMA}.files
       (id, user_id, thread_id, folder_id, name, ext, mime, size_bytes, sha256, s3_key, namespace, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'queued')
     on conflict (id) do nothing`,
    [f.id, f.userId, f.threadId, f.folderId, f.name, f.ext, f.mime, f.sizeBytes, f.sha256, f.s3Key, f.namespace],
  );
}

export async function getFile(id: string): Promise<FileRecord | null> {
  const rows = await tryQuery<Row>(`select * from ${SCHEMA}.files where id=$1`, [id]);
  return rows[0] ? map(rows[0]) : null;
}

/** Ownership-scoped read for API handlers. */
export async function getUserFile(userId: string, id: string): Promise<FileRecord | null> {
  const rows = await tryQuery<Row>(`select * from ${SCHEMA}.files where id=$1 and user_id=$2`, [id, userId]);
  return rows[0] ? map(rows[0]) : null;
}

export async function listFiles(userId: string, threadId?: string, limit = 200): Promise<FileRecord[]> {
  const rows = threadId
    ? await tryQuery<Row>(
        `select * from ${SCHEMA}.files where user_id=$1 and thread_id=$2 order by created_at desc limit $3`,
        [userId, threadId, limit],
      )
    : await tryQuery<Row>(`select * from ${SCHEMA}.files where user_id=$1 order by created_at desc limit $2`, [userId, limit]);
  return rows.map(map);
}

export async function setProcessing(id: string): Promise<void> {
  await tryQuery(
    `update ${SCHEMA}.files set status='processing', attempts=attempts+1, updated_at=now() where id=$1`,
    [id],
  );
}

export interface ReadyPatch {
  processor: string;
  degraded: boolean;
  pages: number | null;
  chunksTotal: number;
  chunksIndexed: number;
  preview: string | null;
}

export async function setReady(id: string, p: ReadyPatch): Promise<void> {
  await tryQuery(
    `update ${SCHEMA}.files
       set status='ready', processor=$2, degraded=$3, pages=$4, chunks_total=$5, chunks_indexed=$6,
           preview=$7, error=null, updated_at=now()
     where id=$1`,
    [id, p.processor, p.degraded, p.pages, p.chunksTotal, p.chunksIndexed, p.preview],
  );
}

export async function setFailed(id: string, reason: string): Promise<void> {
  await tryQuery(`update ${SCHEMA}.files set status='failed', error=$2, updated_at=now() where id=$1`, [id, reason.slice(0, 500)]);
}

export async function deleteFileRow(userId: string, id: string): Promise<void> {
  await tryQuery(`delete from ${SCHEMA}.files where id=$1 and user_id=$2`, [id, userId]);
}

export async function deleteThreadFileRows(userId: string, threadId: string): Promise<void> {
  await tryQuery(`delete from ${SCHEMA}.files where user_id=$1 and thread_id=$2`, [userId, threadId]);
}

export async function deleteAllUserFileRows(userId: string): Promise<void> {
  await tryQuery(`delete from ${SCHEMA}.files where user_id=$1`, [userId]);
}

export async function setFolder(userId: string, id: string, folderId: string | null): Promise<void> {
  await tryQuery(`update ${SCHEMA}.files set folder_id=$3, updated_at=now() where id=$1 and user_id=$2`, [id, userId, folderId]);
}

/** Cheap gate: does this thread have at least one successfully-processed file? */
export async function threadHasReadyFiles(userId: string, threadId: string): Promise<boolean> {
  const rows = await tryQuery<{ one: number }>(
    `select 1 as one from ${SCHEMA}.files where user_id=$1 and thread_id=$2 and status='ready' and chunks_indexed > 0 limit 1`,
    [userId, threadId],
  );
  return rows.length > 0;
}

/**
 * Rows stuck in queued/processing (e.g. a crash before a terminal write). Used by the
 * worker's Postgres-scan fallback (Redis-down resilience) and startup reconcile.
 */
export async function findStuck(limit = 100): Promise<FileRecord[]> {
  try {
    const rows = await query<Row>(
      `select * from ${SCHEMA}.files where status in ('queued','processing') order by updated_at asc limit $1`,
      [limit],
    );
    return rows.map(map);
  } catch (e) {
    log.debug('findStuck failed', errFields(e));
    return [];
  }
}
