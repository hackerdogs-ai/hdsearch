// Browser client for sidebar folders (chat threads). Talks to the Next BFF
// (/api/folders/*). Best-effort — the sidebar degrades to "no folders" on failure.
export interface Folder {
  id: string;
  name: string;
  kind: 'chat' | 'search' | 'mixed';
  sort: number;
}

export interface FoldersState {
  folders: Folder[];
  assignments: Record<string, string>; // threadId -> folderId
}

export async function fetchChatFolders(): Promise<FoldersState> {
  try {
    const r = await fetch('/api/folders?kind=chat', { cache: 'no-store' });
    if (!r.ok) return { folders: [], assignments: {} };
    const j = await r.json();
    return { folders: (j.folders || []) as Folder[], assignments: (j.assignments || {}) as Record<string, string> };
  } catch {
    return { folders: [], assignments: {} };
  }
}

export async function createFolder(name: string): Promise<Folder | null> {
  try {
    const r = await fetch('/api/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, kind: 'chat' }),
    });
    if (!r.ok) return null;
    return (await r.json()) as Folder;
  } catch {
    return null;
  }
}

export async function deleteFolder(id: string): Promise<void> {
  await fetch(`/api/folders/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
}

export async function renameFolder(id: string, name: string): Promise<void> {
  await fetch(`/api/folders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  }).catch(() => {});
}

export async function assignThreadFolder(threadId: string, folderId: string | null): Promise<void> {
  await fetch('/api/folders/assign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ threadId, folderId }),
  }).catch(() => {});
}
