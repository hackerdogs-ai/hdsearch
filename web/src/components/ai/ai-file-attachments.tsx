'use client';
// Composer file attachments: a paperclip button (AiAttachButton) that lives in the
// composer toolbar, and a chip tray (AiAttachmentTray) shown above the input. Both
// share the module attachment store so the SSE adapter can send the ready fileIds
// with the chat turn. Uploads stream through the BFF; status is polled to `ready`.
import { useCallback, useRef } from 'react';
import { useAssistantApi, useAssistantState } from '@assistant-ui/react';
import { useAiSearch } from './ai-search-context';
import {
  useAttachments,
  addAttachment,
  updateAttachment,
  removeAttachment,
  uploadThreadId,
  newLocalId,
  type Attachment,
} from './attachments-store';
import { uploadFile, waitForProcessing, deleteFile, FileTooLargeError } from '@/lib/files';
import { humanSize, FILE_MAX_BYTES } from '@/lib/files-shared';

async function startUpload(file: File) {
  const localId = newLocalId();
  addAttachment({ localId, name: file.name, size: file.size, status: 'uploading', progress: 0 });
  try {
    const handle = await uploadFile(file, uploadThreadId(), {
      onProgress: (f) => updateAttachment(localId, { progress: f }),
    });
    updateAttachment(localId, { fileId: handle.fileId, status: 'queued', progress: 1 });
    await waitForProcessing(handle.fileId, (status) => updateAttachment(localId, { status }));
  } catch (e) {
    const msg = e instanceof FileTooLargeError ? e.message : (e as Error).message || 'upload failed';
    updateAttachment(localId, { status: 'failed', error: msg });
  }
}

export function AiAttachButton({ className = '' }: { className?: string }) {
  const { signedIn } = useAiSearch();
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-selecting the same file
    for (const f of files) void startUpload(f);
  }, []);

  if (!signedIn) return null;
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={onPick}
        aria-hidden
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title={`Attach files (max ${Math.round(FILE_MAX_BYTES / 1024 / 1024)} MB each)`}
        aria-label="Attach files"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ink-200 text-ink-500 hover:border-ink-300 hover:bg-ink-50 hover:text-ink-700 ${className}`}
      >
        <span className="material-symbols-outlined text-xl leading-none">add</span>
      </button>
    </>
  );
}

/**
 * Dictate button — browser speech-to-text into the composer (assistant-ui
 * WebSpeechDictationAdapter, wired in ai-search-runtime.tsx). Hidden when the Web
 * Speech API is unavailable. Toggles recording; the composer shows the live
 * transcript as it dictates.
 */
export function AiDictateButton({ className = '' }: { className?: string }) {
  const api = useAssistantApi();
  const isDictating = useAssistantState((s) => !!s.composer.dictation);
  const supported =
    typeof window !== 'undefined' &&
    !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
  if (!supported) return null;

  const toggle = () => {
    const composer = api.composer();
    if (isDictating) composer.stopDictation();
    else composer.startDictation();
  };
  return (
    <button
      type="button"
      onClick={toggle}
      title={isDictating ? 'Stop dictation' : 'Dictate'}
      aria-label={isDictating ? 'Stop dictation' : 'Dictate'}
      aria-pressed={isDictating}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
        isDictating ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'text-ink-500 hover:bg-ink-50 hover:text-ink-700'
      } ${className}`}
    >
      <span className="material-symbols-outlined text-xl leading-none">{isDictating ? 'stop' : 'mic'}</span>
    </button>
  );
}

function StatusIcon({ a }: { a: Attachment }) {
  if (a.status === 'uploading') {
    return <span className="text-xs tabular-nums text-ink-400">{Math.round(a.progress * 100)}%</span>;
  }
  if (a.status === 'queued' || a.status === 'processing') {
    return (
      <span
        className="hd-progress-ring inline-block h-3.5 w-3.5 rounded-full border-2 border-brand-200 border-t-brand-500"
        title="Processing…"
        aria-label="Processing"
      />
    );
  }
  if (a.status === 'failed') {
    return <span className="material-symbols-outlined text-base text-red-500" title={a.error || 'Failed'}>error</span>;
  }
  return <span className="material-symbols-outlined text-base text-brand-600" title="Ready">check_circle</span>;
}

type MediaKind = 'image' | 'audio' | 'video' | 'document';
function classifyKind(name: string): MediaKind {
  const e = name.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'ico', 'heic', 'avif'].includes(e)) return 'image';
  if (['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus', 'wma'].includes(e)) return 'audio';
  if (['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'wmv', 'flv'].includes(e)) return 'video';
  return 'document';
}
const KIND_ICON: Record<MediaKind, string> = { image: 'image', audio: 'audio_file', video: 'movie', document: 'description' };

/** Warning when the currently-selected model can't process this attachment's media type.
 *  Audio/video are answerable via Whisper transcription (RAG) when configured, so they
 *  aren't warned here; the server sends a professional notice if there's no transcript. */
function capabilityWarning(kind: MediaKind, canVision: boolean): string {
  if (kind === 'image' && !canVision) return "This model can't view images — switch to a vision model.";
  return '';
}

export function AiAttachmentTray({ className = '' }: { className?: string }) {
  const attachments = useAttachments();
  const { models, modelOverride } = useAiSearch();
  const canVision = !!models.find((m) => m.id === modelOverride)?.capabilities?.vision;
  if (!attachments.length) return null;

  const onRemove = (a: Attachment) => {
    const removed = removeAttachment(a.localId);
    if (removed?.fileId) void deleteFile(removed.fileId);
  };

  return (
    <div className={`flex flex-wrap gap-1.5 border-b border-ink-100 px-2 py-2 sm:px-3 ${className}`}>
      {attachments.map((a) => {
        const kind = classifyKind(a.name);
        const warn = capabilityWarning(kind, canVision);
        return (
          <div
            key={a.localId}
            className={`flex max-w-[240px] items-center gap-1.5 rounded-lg border px-2 py-1 text-sm ${warn ? 'border-amber-300 bg-amber-50/70' : 'border-ink-200 bg-ink-50/60'}`}
            title={a.error || warn || a.name}
          >
            <span className={`material-symbols-outlined text-base ${warn ? 'text-amber-600' : 'text-ink-400'}`}>{KIND_ICON[kind]}</span>
            <span className="min-w-0 flex-1 truncate text-ink-700">{a.name}</span>
            {warn ? (
              <span className="material-symbols-outlined shrink-0 text-base text-amber-600" title={warn} aria-label={warn}>
                warning
              </span>
            ) : (
              <span className="shrink-0 text-xs text-ink-400">{humanSize(a.size)}</span>
            )}
            <StatusIcon a={a} />
            <button
              type="button"
              onClick={() => onRemove(a)}
              className="shrink-0 rounded p-0.5 text-ink-400 hover:text-ink-600"
              title="Remove"
              aria-label={`Remove ${a.name}`}
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
