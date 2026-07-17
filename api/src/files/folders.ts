// Sidebar folders. Folder identity is durable in Postgres (hd_search.folders);
// a chat's assignment to a folder is a cheap Redis hash (threadId → folderId) so
// moving a chat doesn't need a Postgres write on every sidebar action. Both tiers
// are best-effort and user-scoped.
import { query, tryQuery, SCHEMA } from '../db.js';
import { redis, redisHealthy, k } from '../store.js';
import { log, errFields } from '../logger.js';

export type FolderKind = 'chat' | 'search' | 'mixed';

export interface Folder {
  id: string;
  name: string;
  kind: FolderKind;
  sort: number;
}

interface FolderRow {
  id: string;
  name: string;
  kind: FolderKind;
  sort: number;
}

const assignKey = (userId: string) => k('ai', 'folders', userId); // HASH threadId → folderId

function newId(): string {
  return `folder_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export async function listFolders(userId: string, kind?: FolderKind): Promise<Folder[]> {
  const rows = kind
    ? await tryQuery<FolderRow>(
        `select id, name, kind, sort from ${SCHEMA}.folders where user_id=$1 and kind in ($2,'mixed') order by sort, created_at`,
        [userId, kind],
      )
    : await tryQuery<FolderRow>(
        `select id, name, kind, sort from ${SCHEMA}.folders where user_id=$1 order by sort, created_at`,
        [userId],
      );
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, sort: r.sort }));
}

export async function createFolder(userId: string, name: string, kind: FolderKind): Promise<Folder> {
  const id = newId();
  await query(
    `insert into ${SCHEMA}.folders (id, user_id, name, kind) values ($1,$2,$3,$4)`,
    [id, userId, name.slice(0, 120), kind],
  );
  return { id, name: name.slice(0, 120), kind, sort: 0 };
}

export async function updateFolder(
  userId: string,
  id: string,
  patch: { name?: string; sort?: number },
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [id, userId];
  if (patch.name !== undefined) {
    params.push(patch.name.slice(0, 120));
    sets.push(`name=$${params.length}`);
  }
  if (patch.sort !== undefined) {
    params.push(patch.sort);
    sets.push(`sort=$${params.length}`);
  }
  if (!sets.length) return false;
  const rows = await tryQuery(
    `update ${SCHEMA}.folders set ${sets.join(', ')}, updated_at=now() where id=$1 and user_id=$2 returning id`,
    params,
  );
  return rows.length > 0;
}

/** Delete a folder. Chats assigned to it fall back to "unfiled" (assignment removed). */
export async function deleteFolder(userId: string, id: string): Promise<void> {
  await tryQuery(`delete from ${SCHEMA}.folders where id=$1 and user_id=$2`, [id, userId]);
  // best-effort: also drop file rows' folder link + thread assignments pointing here
  await tryQuery(`update ${SCHEMA}.files set folder_id=null where user_id=$1 and folder_id=$2`, [userId, id]);
  if (redisHealthy()) {
    try {
      const map = await redis.hgetall(assignKey(userId));
      const toClear = Object.entries(map).filter(([, v]) => v === id).map(([tid]) => tid);
      if (toClear.length) await redis.hdel(assignKey(userId), ...toClear);
    } catch (e) {
      log.debug('folder assignment cleanup failed', errFields(e));
    }
  }
}

/** Assign (or clear, when folderId is null) a chat thread to a folder. */
export async function assignThreadFolder(userId: string, threadId: string, folderId: string | null): Promise<void> {
  if (!redisHealthy()) return;
  try {
    if (folderId) await redis.hset(assignKey(userId), threadId, folderId);
    else await redis.hdel(assignKey(userId), threadId);
  } catch (e) {
    log.warn('assign thread folder failed', { threadId, ...errFields(e) });
  }
}

/** Map of threadId → folderId for the current user (for sidebar grouping). */
export async function threadFolderMap(userId: string): Promise<Record<string, string>> {
  if (!redisHealthy()) return {};
  try {
    return await redis.hgetall(assignKey(userId));
  } catch {
    return {};
  }
}

/** Remove a single thread's folder assignment (called on chat delete). */
export async function clearThreadFolder(userId: string, threadId: string): Promise<void> {
  if (!redisHealthy()) return;
  try {
    await redis.hdel(assignKey(userId), threadId);
  } catch {
    /* best-effort */
  }
}
