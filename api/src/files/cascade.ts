// Delete cascade — the "zero orphans" guarantee (docs/file-upload-rag.md §C.11).
// Each tier (S3 objects, vector docs, Postgres rows, queue jobs) fires
// INDEPENDENTLY and best-effort, so an outage in one never blocks the others. Wired
// into ai-threads.ts deleteAiThread / clearAiThreads and the DELETE /v1/files routes.
import { log } from '../logger.js';
import { deleteOneFileObjects, deleteFileObjects } from '../storage.js';
import { deleteNamespace } from '../vector.js';
import { listFiles, getUserFile, deleteFileRow, deleteThreadFileRows, deleteAllUserFileRows } from './db.js';
import { removeJob } from './queue.js';

export const threadNamespace = (userId: string, threadId: string) => `file:${userId}:${threadId}`;

/** Delete a single file everywhere it lives. */
export async function deleteFile(userId: string, fileId: string): Promise<boolean> {
  const rec = await getUserFile(userId, fileId);
  if (!rec) return false;
  const threadId = rec.threadId || '_';
  await Promise.allSettled([
    deleteOneFileObjects(userId, threadId, fileId),
    // this file's chunks are keyed <namespace>:<fileId>:<n> — delete just those docs
    deleteNamespace(`${rec.namespace}:${fileId}`, false),
    removeJob(fileId),
    deleteFileRow(userId, fileId),
  ]);
  log.info('file deleted', { userId, fileId });
  return true;
}

/** Delete every file attached to a thread (called on chat delete). */
export async function deleteFilesForThread(userId: string, threadId: string): Promise<void> {
  if (!threadId) return;
  // Snapshot ids first so we can also clear their queue jobs.
  const files = await listFiles(userId, threadId, 1000).catch(() => []);
  await Promise.allSettled([
    deleteFileObjects(userId, threadId),
    deleteNamespace(threadNamespace(userId, threadId), false),
    deleteThreadFileRows(userId, threadId),
    ...files.map((f) => removeJob(f.id)),
  ]);
  if (files.length) log.info('thread files deleted', { userId, threadId, count: files.length });
}

/** Delete every file for a user (called on account "clear all chats"). */
export async function deleteAllUserFiles(userId: string): Promise<void> {
  const files = await listFiles(userId, undefined, 5000).catch(() => []);
  await Promise.allSettled([
    deleteFileObjects(userId), // whole files/<userId>/ prefix
    deleteNamespace(`file:${userId}:`, true), // all of this user's thread namespaces
    deleteAllUserFileRows(userId),
    ...files.map((f) => removeJob(f.id)),
  ]);
  if (files.length) log.info('all user files deleted', { userId, count: files.length });
}
