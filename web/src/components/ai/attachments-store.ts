'use client';
// Tiny external store shared between the composer (which uploads files) and the SSE
// adapter (which must send the SAME threadId + the ready fileIds). A new, unsent chat
// has no threadId yet, so we mint a stable "draft" id the moment the user attaches a
// file and bind both the uploads and the first chat turn to it — the server accepts
// body.threadId, so the file namespace (file:<user>:<threadId>) lines up for RAG.
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
 */
export function setActiveThread(localId: string | undefined, remoteId: string | undefined) {
  if (localId !== currentLocalId) {
    currentLocalId = localId;
    activeThreadId = remoteId;
    draftThreadId = null;
    if (store.length) {
      store = [];
      emit();
    }
  } else if (remoteId && remoteId !== activeThreadId) {
    // Same conversation — the server just assigned the remote id after the first turn.
    activeThreadId = remoteId;
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

/** Thread id to bind an upload to. Mints a stable draft id for a new chat. */
export function uploadThreadId(): string {
  if (activeThreadId) return activeThreadId;
  if (!draftThreadId) draftThreadId = cryptoRandomId();
  return draftThreadId;
}

/** threadId to force onto the next chat turn (only when a new chat has draft files). */
export function chatThreadIdOverride(): string | undefined {
  if (activeThreadId) return undefined;
  return store.length && draftThreadId ? draftThreadId : undefined;
}

/** Ready-to-query file ids for the current compose context. */
export function readyFileIds(): string[] {
  return store.filter((a) => a.status === 'ready' && a.fileId).map((a) => a.fileId!) as string[];
}

export function anyPending(): boolean {
  return store.some((a) => a.status === 'uploading' || a.status === 'queued' || a.status === 'processing');
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
