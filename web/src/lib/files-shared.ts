// Shared file constants (safe for both browser and server — no server-only imports).
export const FILE_MAX_BYTES = 200 * 1024 * 1024; // 200 MB, mirrors HDSEARCH_FILE_MAX_BYTES

export type FileStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface UploadedFile {
  id: string;
  name: string;
  ext: string | null;
  mime: string | null;
  size: number;
  threadId: string | null;
  folderId: string | null;
  status: FileStatus;
  degraded: boolean;
  error: string | null;
  pages: number | null;
  chunksTotal: number;
  chunksIndexed: number;
  preview: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
