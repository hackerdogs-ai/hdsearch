// File upload + management endpoints. Uploads store raw bytes to S3, write the
// source-of-truth Postgres row, and enqueue a durable processing job — then return
// 202 immediately (processing is off the hot path). All reads/deletes are ownership-
// scoped. Demo/anonymous identities cannot upload. See docs/file-upload-rag.md §C.7.
import { Hono } from 'hono';
import { randomUUID, createHash } from 'node:crypto';
import { requireAuth, requireScope, isDemoUser } from '../auth.js';
import { env } from '../env.js';
import { s3Path } from '../env.js';
import { log, errFields } from '../logger.js';
import { putFile, getFileStream } from '../storage.js';
import { recordUsage } from '../metrics.js';
import { createFile, getUserFile, listFiles, setFolder } from '../files/db.js';
import { enqueue } from '../files/queue.js';
import { deleteFile, deleteFilesForThread } from '../files/cascade.js';

export const fileRoutes = new Hono();

fileRoutes.use('*', requireAuth());

// Public view of a file row (no internal S3 key).
function publicFile(f: {
  id: string; name: string; ext: string | null; mime: string | null; sizeBytes: number;
  threadId: string | null; folderId: string | null; status: string; degraded: boolean;
  error: string | null; pages: number | null; chunksTotal: number; chunksIndexed: number;
  preview: string | null; createdAt: string; updatedAt: string;
}) {
  return {
    id: f.id, name: f.name, ext: f.ext, mime: f.mime, size: f.sizeBytes,
    threadId: f.threadId, folderId: f.folderId, status: f.status, degraded: f.degraded,
    error: f.error, pages: f.pages, chunksTotal: f.chunksTotal, chunksIndexed: f.chunksIndexed,
    preview: f.preview, createdAt: f.createdAt, updatedAt: f.updatedAt,
  };
}

// ---- POST /v1/files : multipart upload -------------------------------------
fileRoutes.post('/', requireScope('vector:read'), async (c) => {
  const p = c.get('principal');
  if (isDemoUser(p.userId)) return c.json({ error: 'forbidden', message: 'sign in to upload files' }, 403);

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch (e) {
    return c.json({ error: 'bad_request', message: 'expected multipart/form-data' }, 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ error: 'bad_request', message: 'missing file field' }, 400);
  if (file.size <= 0) return c.json({ error: 'bad_request', message: 'empty file' }, 400);
  if (file.size > env.file.maxBytes) {
    return c.json(
      { error: 'file_too_large', message: `file exceeds ${Math.round(env.file.maxBytes / 1024 / 1024)} MB limit`, maxBytes: env.file.maxBytes },
      413,
    );
  }

  // Isolation: never fall back to a SHARED literal namespace. A missing threadId gets
  // a unique draft id so one conversation's files can never leak into another's
  // namespace (file:<user>:<thread>). The client always sends a per-conversation id.
  const rawThread = form.get('threadId');
  const threadId = (rawThread ? String(rawThread).slice(0, 128).trim() : '') || `draft-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const folderId = form.get('folderId') ? String(form.get('folderId')).slice(0, 128) : null;
  const name = sanitizeName(file.name || 'upload');
  const ext = extOf(name);
  const mime = file.type || 'application/octet-stream';
  const fileId = `file_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const namespace = `file:${p.userId}:${threadId}`;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch (e) {
    log.warn('file read failed', errFields(e));
    return c.json({ error: 'bad_request', message: 'could not read upload' }, 400);
  }
  // Re-check the true size (client could lie about File.size).
  if (buffer.length > env.file.maxBytes) {
    return c.json({ error: 'file_too_large', maxBytes: env.file.maxBytes }, 413);
  }
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const s3Key = s3Path(`files/${p.userId}/${threadId}/${fileId}/raw/${name}`);

  // 1) durable bytes first — nothing half-written if this throws.
  try {
    await putFile(s3Key, buffer, mime);
  } catch (e) {
    log.error('file storage failed', { fileId, ...errFields(e) });
    return c.json({ error: 'storage_unavailable', message: 'could not store file; retry shortly' }, 503);
  }

  // 2) source-of-truth row.
  try {
    await createFile({ id: fileId, userId: p.userId, threadId, folderId, name, ext, mime, sizeBytes: buffer.length, sha256, s3Key, namespace });
  } catch (e) {
    log.error('file row insert failed', { fileId, ...errFields(e) });
    // Bytes are stored; without a row we can't track it — surface the failure.
    return c.json({ error: 'db_unavailable', message: 'could not record file; retry shortly' }, 503);
  }

  // 3) enqueue processing (best-effort; worker's Postgres-scan fallback covers Redis-down).
  await enqueue({ fileId, userId: p.userId, threadId, s3Key });

  void recordUsage({ userId: p.userId, kind: 'vector', modality: 'file', resultCount: 1, cached: false, tookMs: 0, apiKeyId: p.keyId })
    .catch(() => {});

  log.info('file uploaded', { fileId, userId: p.userId, threadId, ext, size: buffer.length });
  return c.json({ fileId, status: 'queued', name, size: buffer.length }, 202);
});

// ---- GET /v1/files?threadId=… : list --------------------------------------
fileRoutes.get('/', requireScope('vector:read'), async (c) => {
  const p = c.get('principal');
  if (isDemoUser(p.userId)) return c.json({ files: [] });
  const threadId = c.req.query('threadId') || undefined;
  const files = await listFiles(p.userId, threadId, Number(c.req.query('limit')) || 200);
  return c.json({ files: files.map(publicFile) });
});

// ---- GET /v1/files/:id/status : lightweight poll --------------------------
fileRoutes.get('/:id/status', requireScope('vector:read'), async (c) => {
  const p = c.get('principal');
  const f = await getUserFile(p.userId, c.req.param('id')!);
  if (!f) return c.json({ error: 'not_found' }, 404);
  return c.json({ id: f.id, status: f.status, degraded: f.degraded, error: f.error, chunksIndexed: f.chunksIndexed, chunksTotal: f.chunksTotal });
});

// ---- GET /v1/files/:id/content : streamed download ------------------------
fileRoutes.get('/:id/content', requireScope('vector:read'), async (c) => {
  const p = c.get('principal');
  const f = await getUserFile(p.userId, c.req.param('id')!);
  if (!f) return c.json({ error: 'not_found' }, 404);
  const s = await getFileStream(f.s3Key);
  if (!s?.body) return c.json({ error: 'not_found' }, 404);
  const headers: Record<string, string> = {
    'Content-Type': f.mime || 'application/octet-stream',
    'Content-Disposition': `inline; filename="${encodeURIComponent(f.name)}"`,
  };
  if (s.contentLength) headers['Content-Length'] = String(s.contentLength);
  return new Response(s.body, { headers });
});

// ---- GET /v1/files/:id : metadata -----------------------------------------
fileRoutes.get('/:id', requireScope('vector:read'), async (c) => {
  const p = c.get('principal');
  const f = await getUserFile(p.userId, c.req.param('id')!);
  if (!f) return c.json({ error: 'not_found' }, 404);
  return c.json(publicFile(f));
});

// ---- PATCH /v1/files/:id : move to folder ---------------------------------
fileRoutes.patch('/:id', requireScope('vector:read'), async (c) => {
  const p = c.get('principal');
  const body = (await c.req.json().catch(() => null)) as { folderId?: string | null } | null;
  if (!body || !('folderId' in body)) return c.json({ error: 'bad_request' }, 400);
  const f = await getUserFile(p.userId, c.req.param('id')!);
  if (!f) return c.json({ error: 'not_found' }, 404);
  await setFolder(p.userId, f.id, body.folderId ?? null);
  return c.json({ ok: true });
});

// ---- DELETE /v1/files/:id : delete one (cascade) --------------------------
fileRoutes.delete('/:id', requireScope('vector:read'), async (c) => {
  const p = c.get('principal');
  const ok = await deleteFile(p.userId, c.req.param('id')!);
  return c.json({ ok });
});

// ---- DELETE /v1/files?threadId=… : delete all for a thread ----------------
fileRoutes.delete('/', requireScope('vector:read'), async (c) => {
  const p = c.get('principal');
  const threadId = c.req.query('threadId');
  if (!threadId) return c.json({ error: 'bad_request', message: 'threadId required' }, 400);
  await deleteFilesForThread(p.userId, threadId);
  return c.json({ ok: true });
});

function sanitizeName(name: string): string {
  return name.replace(/[\/\\\x00-\x1f]/g, '_').replace(/\.{2,}/g, '.').slice(0, 200) || 'upload';
}
function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}
