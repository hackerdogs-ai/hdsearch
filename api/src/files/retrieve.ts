// RAG retrieval for a chat turn. Searches the thread's file namespace and builds a
// grounded-context block + citations to inject into the LLM turn. Best-effort: any
// failure returns null so the chat proceeds ungrounded rather than erroring
// (docs/file-upload-rag.md §C.7/§C.10).
import { env } from '../env.js';
import { log, errFields } from '../logger.js';
import { vectorSearch, type VecHit } from '../vector.js';
import { embeddingsEnabled } from '../embeddings.js';
import { getFileBuffer } from '../storage.js';
import { getUserFiles, listFiles, type FileRecord } from './db.js';
import type { MsgImage } from '../ai/providers/types.js';

export interface FileCitation {
  fileId: string;
  name: string;
  page?: number;
  sheet?: string;
  score: number;
}

export interface RetrievedContext {
  context: string; // formatted block to prepend to the system/user turn
  citations: FileCitation[];
}

/**
 * Retrieve up to topK relevant chunks from the thread's uploaded files. When
 * `fileIds` is provided, only those files are considered — and their *stored*
 * namespaces are searched (not just `file:<user>:<chatThreadId>`), so a draft/
 * remote thread-id mismatch still grounds the model. Returns null when there is
 * nothing to ground on (no files, retrieval failed with no preview fallback).
 */
export async function retrieveFileContext(
  userId: string,
  threadId: string,
  query: string,
  fileIds?: string[],
): Promise<RetrievedContext | null> {
  if (!query.trim()) return null;
  try {
    const named = fileIds?.length ? await getUserFiles(userId, fileIds) : [];
    const namespaces = namespacesToSearch(userId, threadId, named);
    if (!namespaces.length) return null;

    const filter = fileIds?.length ? new Set(fileIds) : null;
    let hits: VecHit[] = [];

    if (embeddingsEnabled()) {
      const overFetch = Math.max(env.file.ragTopK * 2, env.file.ragTopK);
      const raw: VecHit[] = [];
      for (const ns of namespaces) {
        const part = await vectorSearch(query, ns, overFetch);
        raw.push(...part);
      }
      // Dedupe by id (same chunk can appear if namespaces overlap).
      const seen = new Set<string>();
      const deduped = raw
        .filter((h) => {
          if (seen.has(h.id)) return false;
          seen.add(h.id);
          return true;
        })
        .filter((h) => !filter || filter.has(String((h.metadata as any)?.fileId ?? '')))
        .sort((a, b) => b.score - a.score);

      // Explicit attachments: accept lower-scoring hits so "summarize this doc"
      // still grounds even when the prompt is generic vs. the chunk text.
      const minScore = filter ? Math.min(env.file.ragMinScore, 0.05) : env.file.ragMinScore;
      hits = deduped.filter((h) => h.score >= minScore).slice(0, env.file.ragTopK);
      // Last resort with named files: take top-K regardless of score.
      if (!hits.length && filter && deduped.length) {
        hits = deduped.slice(0, env.file.ragTopK);
      }
    }

    if (hits.length) {
      return formatHits(hits);
    }

    // No vector hits — still tell the model about attached documents (preview /
    // status) so it doesn't claim nothing was attached. Covers all document kinds
    // equally: pdf, office, text, html, json, etc.
    const filesForFallback =
      named.length > 0
        ? named.filter((f) => f.status !== 'failed')
        : threadId
          ? (await listFiles(userId, threadId, 50)).filter((f) => f.status === 'ready')
          : [];
    return formatFileFallback(filesForFallback);
  } catch (e) {
    log.warn('file RAG retrieval failed', { threadId, ...errFields(e) });
    return null;
  }
}

function namespacesToSearch(userId: string, threadId: string, named: FileRecord[]): string[] {
  const set = new Set<string>();
  if (threadId) set.add(`file:${userId}:${threadId}`);
  for (const f of named) {
    if (f.namespace) set.add(f.namespace);
  }
  return [...set];
}

function formatHits(hits: VecHit[]): RetrievedContext {
  const citations: FileCitation[] = [];
  const parts: string[] = [];
  hits.forEach((h, i) => {
    const meta = (h.metadata || {}) as Record<string, unknown>;
    const name = h.title || String(meta.fileId || 'file');
    const loc = meta.page ? ` p.${meta.page}` : meta.sheet ? ` [${meta.sheet}]` : '';
    parts.push(`[${i + 1}] ${name}${loc}\n${h.text}`);
    citations.push({
      fileId: String(meta.fileId || ''),
      name,
      page: typeof meta.page === 'number' ? meta.page : undefined,
      sheet: typeof meta.sheet === 'string' ? meta.sheet : undefined,
      score: h.score,
    });
  });

  const context =
    'The user has attached documents to this conversation. Use the following excerpts to answer, ' +
    'and cite sources as [n] where relevant:\n\n' +
    parts.join('\n\n---\n\n');
  return { context, citations };
}

/** When vectors are missing/empty, inject file names + previews so the model knows attachments exist. */
function formatFileFallback(files: FileRecord[]): RetrievedContext | null {
  if (!files.length) return null;
  const citations: FileCitation[] = [];
  const parts: string[] = [];
  const anyPending = files.some((f) => f.status === 'queued' || f.status === 'processing');
  files.forEach((f, i) => {
    const preview = (f.preview || '').trim();
    let statusNote = '';
    if (f.status === 'queued' || f.status === 'processing') {
      statusNote = ' (still processing — text not fully available yet)';
    } else if (f.chunksIndexed === 0) {
      statusNote = ' (text index unavailable — only a short preview may be present)';
    } else if (f.degraded) {
      statusNote = ' (partial extraction)';
    }
    parts.push(
      `[${i + 1}] ${f.name}${statusNote}\n` +
        (preview || `(No extracted preview available for this ${f.ext || 'file'}.)`),
    );
    citations.push({ fileId: f.id, name: f.name, score: 0 });
  });
  const pendingNote = anyPending
    ? 'Some attachments are still being processed. Acknowledge them and ask the user to retry once processing finishes if you need the full text. '
    : '';
  const context =
    'The user has attached the following documents to this conversation. ' +
    pendingNote +
    'Relevant indexed excerpts were not available, so only filenames and short previews are provided. ' +
    'Answer using what you can from these previews; if the preview is insufficient for the question, ' +
    'say so clearly and ask the user to paste key sections or wait for processing to complete.\n\n' +
    parts.join('\n\n---\n\n');
  return { context, citations };
}

// Anthropic-supported image media types.
const VISION_MIME = /^image\/(png|jpe?g|gif|webp)$/i;
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // per-image (Anthropic caps ~5MB)
const MAX_TOTAL_IMAGE_BYTES = 18 * 1024 * 1024; // overall budget per turn

export type MediaKind = 'image' | 'audio' | 'video' | 'document';

export interface MediaAnalysis {
  images: MsgImage[]; // ready to attach to a vision model
  unsupported: { kind: MediaKind; names: string[] }[]; // present but the model can't process
}

/**
 * Analyze a thread's media attachments against the model's capabilities. Images go to
 * a vision-capable model as base64 blocks; anything the model can't process (images on
 * a non-vision model, or any audio/video — no provider consumes those yet) is reported
 * so the caller can tell the user professionally. Optionally restricted to `fileIds`.
 * Best-effort — returns empty analysis on any issue.
 */
export async function analyzeThreadMedia(
  userId: string,
  threadId: string,
  fileIds: string[] | undefined,
  caps: { vision: boolean },
): Promise<MediaAnalysis> {
  const empty: MediaAnalysis = { images: [], unsupported: [] };
  try {
    const wanted = fileIds && fileIds.length ? new Set(fileIds) : null;
    // Prefer explicit fileIds (works across draft/remote thread-id mismatch); fall back
    // to listing the chat thread's files when the client didn't name any.
    const files = wanted
      ? (await getUserFiles(userId, [...wanted])).filter((f) => f.status !== 'failed')
      : threadId
        ? (await listFiles(userId, threadId, 200)).filter((f) => f.status !== 'failed')
        : [];
    const images: MsgImage[] = [];
    const unsupported = new Map<MediaKind, string[]>();
    const flag = (kind: MediaKind, name: string) => {
      const list = unsupported.get(kind) ?? [];
      list.push(name);
      unsupported.set(kind, list);
    };
    let total = 0;
    for (const f of files) {
      const kind = fileKind(f.mime, f.ext);
      if (kind === 'image') {
        const attachable =
          caps.vision && f.mime != null && VISION_MIME.test(f.mime) && f.sizeBytes <= MAX_IMAGE_BYTES && images.length < MAX_IMAGES;
        if (attachable) {
          const buf = await getFileBuffer(f.s3Key);
          if (buf && total + buf.length <= MAX_TOTAL_IMAGE_BYTES) {
            total += buf.length;
            images.push({ mediaType: normalizeMime(f.mime!), dataBase64: buf.toString('base64') });
            continue;
          }
        }
        if (!caps.vision) flag('image', f.name);
      } else if (kind === 'audio' || kind === 'video') {
        // With Whisper transcription (files/transcribe.ts) an AV file gets indexed
        // chunks and is answerable via RAG. Only flag as unsupported when there's no
        // transcript (transcription disabled / oversized / failed).
        if (f.chunksIndexed === 0) flag(kind, f.name);
      }
      // documents are handled by RAG text extraction, not as media
    }
    return { images, unsupported: [...unsupported.entries()].map(([kind, names]) => ({ kind, names })) };
  } catch (e) {
    log.warn('analyzeThreadMedia failed', { threadId, ...errFields(e) });
    return empty;
  }
}

/** A concise, professional note the model uses to explain a media limitation in its own voice. */
export function buildMediaLimitationNote(unsupported: MediaAnalysis['unsupported'], modelLabel: string): string {
  const kinds = unsupported.map((u) => u.kind);
  const names = unsupported.flatMap((u) => u.names).slice(0, 8);
  const kindList = Array.from(new Set(kinds)).join(', ');
  const suggestion = kinds.includes('image')
    ? ' For images, suggest switching to a vision-capable model (e.g. Claude Opus).'
    : ' Audio and video input are not supported by the available models yet.';
  return (
    `\n\n[System note: The user attached ${names.join(', ')} (${kindList}) which the current model "${modelLabel}" cannot process. ` +
    `Politely tell the user you can't analyze the attached ${kindList} with this model, then answer any text question they asked.${suggestion}]`
  );
}

export function fileKind(mime?: string | null, ext?: string | null): MediaKind {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  const e = (ext || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'ico', 'heic', 'avif'].includes(e)) return 'image';
  if (['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus', 'wma'].includes(e)) return 'audio';
  if (['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'wmv', 'flv'].includes(e)) return 'video';
  return 'document';
}

function normalizeMime(mime: string): string {
  const m = mime.toLowerCase();
  return m === 'image/jpg' ? 'image/jpeg' : m;
}
