'use client';
// Tiny external store shared between the composer (which uploads documents) and the
// SSE adapter (which must send the SAME threadId + attachment fileIds). A new, unsent
// chat has no threadId yet, so we mint a stable "draft" id when needed and bind both
// the uploads and the first chat turn to it — the server accepts body.threadId, so
// the file namespace (file:<user>:<threadId>) lines up for document RAG.
import { useSyncExternalStore } from 'react';

export type AttachmentStatus = 'uploading' | 'queued' | 'processing' | 'ready' | 'failed';

export interface Attachment {
  localId: string;
  fileId?: string;
  name: string;
  size: number;
  status: AttachmentStatus;
  progress: number; // 0..1 during upload
  error?: string;
}

let activeThreadId: string | undefined; // server thread id once assigned
let currentLocalId: string | undefined; // assistant-ui local thread id = conversation identity
let draftThreadId: string | null = null; // minted for a brand-new chat with attachments
let store: Attachment[] = [];
const listeners = new Set<() => void>();

function emit() {
  store = [...store];
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * The runtime reports the mounted thread. `localId` is assistant-ui's per-conversation
 * id (stable even before the server assigns a remote id, and DISTINCT for each new
 * chat) — it's the identity we key the compose tray on. `remoteId` is the server thread
 * once known. Switching conversations (including creating a new chat) clears the tray;
 * the server-side files stay attached to their own thread (namespace file:<user>:<id>).
 *
 * First bind (undefined → localId) must NOT clear the tray: the user may have attached
 * files before history.load() ran. Those uploads stay under draftThreadId; chat prefers
 * that draft via chatThreadIdOverride(), and the API also resolves RAG by fileIds.
 */
export function setActiveThread(localId: string | undefined, remoteId: string | undefined) {
  if (localId !== currentLocalId) {
    const firstBind = currentLocalId === undefined && !!localId;
    currentLocalId = localId;
    if (firstBind) {
      // Keep draft + tray. Prefer the local id as active when there is no draft yet so
      // subsequent uploads land in the same namespace initialize() will adopt as remoteId.
      activeThreadId = draftThreadId ?? remoteId ?? localId;
    } else {
      activeThreadId = remoteId;
      draftThreadId = null;
      if (store.length) {
        store = [];
        emit();
      }
    }
  } else if (remoteId && remoteId !== activeThreadId) {
    // Same conversation — the server just assigned the remote id after the first turn.
    // Don't orphan draft-bound uploads by switching the active id out from under them.
    if (!(store.length && draftThreadId && activeThreadId === draftThreadId)) {
      activeThreadId = remoteId;
    }
  }
}

/** Explicit reset when the user starts a NEW chat, independent of runtime mount timing. */
export function resetForNewChat() {
  currentLocalId = undefined;
  activeThreadId = undefined;
  draftThreadId = null;
  if (store.length) {
    store = [];
    emit();
  }
}

/** Thread id to bind an upload to. Prefers the assistant-ui local id (same value
 *  initialize() promotes to remoteId) so uploads and the first chat turn share a
 *  namespace. Falls back to a minted draft only when the runtime hasn't mounted yet. */
export function uploadThreadId(): string {
  if (activeThreadId) return activeThreadId;
  if (currentLocalId) return currentLocalId;
  if (!draftThreadId) draftThreadId = cryptoRandomId();
  return draftThreadId;
}

/** threadId to force onto the next chat turn when the compose tray has files.
 *  Prefers the draft id uploads were bound to so RAG/history stay aligned even if
 *  assistant-ui later assigns a different remote id. */
export function chatThreadIdOverride(): string | undefined {
  if (!store.length) return undefined;
  return draftThreadId || activeThreadId || currentLocalId || undefined;
}

/** File ids to send with the chat turn — every attachment that has a server id
 *  (queued / processing / ready). Failed uploads are omitted. Sending pending ids
 *  lets the API acknowledge documents that are still extracting instead of the
 *  model claiming nothing was attached. */
export function attachmentFileIds(): string[] {
  return store
    .filter((a) => a.fileId && a.status !== 'failed' && a.status !== 'uploading')
    .map((a) => a.fileId!) as string[];
}

export function anyPending(): boolean {
  return store.some((a) => a.status === 'uploading' || a.status === 'queued' || a.status === 'processing');
}

/** React subscription for pending uploads/processing — used to gate Send. */
export function useAttachmentsPending(): boolean {
  return useSyncExternalStore(subscribe, anyPending, () => false);
}

export function addAttachment(a: Attachment) {
  store = [...store, a];
  emit();
}
export function updateAttachment(localId: string, patch: Partial<Attachment>) {
  store = store.map((a) => (a.localId === localId ? { ...a, ...patch } : a));
  emit();
}
export function removeAttachment(localId: string): Attachment | undefined {
  const found = store.find((a) => a.localId === localId);
  store = store.filter((a) => a.localId !== localId);
  emit();
  return found;
}
export function clearAttachments() {
  if (!store.length) return;
  store = [];
  emit();
}

export function useAttachments(): Attachment[] {
  return useSyncExternalStore(subscribe, () => store, () => store);
}

export function newLocalId(): string {
  return cryptoRandomId();
}

function cryptoRandomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}
