// Browser-side file upload client. Uses XHR for upload progress; polls the BFF for
// processing status. All calls go through the Next BFF (/api/files/*), which injects
// auth + streams to the hd-search API. The 200 MB guard is enforced here first
// (fast, no wasted upload) and again server-side.
import { FILE_MAX_BYTES, type UploadedFile, type FileStatus } from './files-shared';

export interface UploadHandle {
  fileId: string;
  status: FileStatus;
  name: string;
  size: number;
}

export class FileTooLargeError extends Error {
  constructor() {
    super(`File exceeds the ${Math.round(FILE_MAX_BYTES / 1024 / 1024)} MB limit.`);
  }
}

/** Upload one file to a thread. onProgress reports 0..1. Rejects on failure. */
export function uploadFile(
  file: File,
  threadId: string,
  opts: { folderId?: string; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<UploadHandle> {
  if (file.size > FILE_MAX_BYTES) return Promise.reject(new FileTooLargeError());

  return new Promise<UploadHandle>((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    form.append('threadId', threadId);
    if (opts.folderId) form.append('folderId', opts.folderId);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');
    xhr.responseType = 'json';
    if (xhr.upload && opts.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress!(e.loaded / e.total);
      };
    }
    xhr.onload = () => {
      const body = xhr.response || safeParse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300 && body?.fileId) {
        resolve({ fileId: body.fileId, status: (body.status as FileStatus) || 'queued', name: body.name || file.name, size: body.size ?? file.size });
      } else {
        reject(new Error(body?.message || body?.error || `upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('network error during upload'));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    if (opts.signal) opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

export async function getFileStatus(fileId: string): Promise<{ status: FileStatus; degraded: boolean; error: string | null; chunksIndexed: number; chunksTotal: number } | null> {
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(fileId)}/status`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Poll until the file reaches a terminal state (ready|failed) or the signal aborts. */
export async function waitForProcessing(
  fileId: string,
  onUpdate: (status: FileStatus) => void,
  signal?: AbortSignal,
): Promise<FileStatus> {
  let delay = 800;
  for (;;) {
    if (signal?.aborted) return 'processing';
    const s = await getFileStatus(fileId);
    if (s) {
      onUpdate(s.status);
      if (s.status === 'ready' || s.status === 'failed') return s.status;
    }
    await sleep(delay);
    delay = Math.min(delay * 1.4, 4000);
  }
}

export async function deleteFile(fileId: string): Promise<void> {
  await fetch(`/api/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' }).catch(() => {});
}

export async function listThreadFiles(threadId: string): Promise<UploadedFile[]> {
  try {
    const res = await fetch(`/api/files?threadId=${encodeURIComponent(threadId)}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.files || []) as UploadedFile[];
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
