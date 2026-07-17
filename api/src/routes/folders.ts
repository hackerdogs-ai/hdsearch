// Folder CRUD + chat→folder assignment for the sidebar. Signed-in only.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAuth, requireScope, isDemoUser } from '../auth.js';
import {
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  assignThreadFolder,
  threadFolderMap,
  type FolderKind,
} from '../files/folders.js';

export const folderRoutes = new Hono();

folderRoutes.use('*', requireAuth());

const KINDS = ['chat', 'search', 'mixed'] as const;

folderRoutes.get('/', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  if (isDemoUser(p.userId)) return c.json({ folders: [], assignments: {} });
  const kind = c.req.query('kind') as FolderKind | undefined;
  const [folders, assignments] = await Promise.all([
    listFolders(p.userId, KINDS.includes(kind as any) ? kind : undefined),
    threadFolderMap(p.userId),
  ]);
  return c.json({ folders, assignments });
});

const CreateBody = z.object({ name: z.string().min(1).max(120), kind: z.enum(KINDS).default('chat') });

folderRoutes.post('/', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  if (isDemoUser(p.userId)) return c.json({ error: 'forbidden' }, 403);
  const parsed = CreateBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const folder = await createFolder(p.userId, parsed.data.name.trim(), parsed.data.kind);
  return c.json(folder, 201);
});

const PatchBody = z.object({ name: z.string().min(1).max(120).optional(), sort: z.number().int().optional() });

folderRoutes.patch('/:id', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  const parsed = PatchBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const ok = await updateFolder(p.userId, c.req.param('id')!, parsed.data);
  return c.json({ ok }, ok ? 200 : 404);
});

folderRoutes.delete('/:id', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  await deleteFolder(p.userId, c.req.param('id')!);
  return c.json({ ok: true });
});

// Assign / clear a chat thread's folder.
const AssignBody = z.object({ threadId: z.string().min(1).max(128), folderId: z.string().max(128).nullable() });

folderRoutes.post('/assign', requireScope('search:read'), async (c) => {
  const p = c.get('principal');
  if (isDemoUser(p.userId)) return c.json({ error: 'forbidden' }, 403);
  const parsed = AssignBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  await assignThreadFolder(p.userId, parsed.data.threadId, parsed.data.folderId);
  return c.json({ ok: true });
});
