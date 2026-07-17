// Audio/video transcription (Whisper). Provider-neutral over any OpenAI-compatible
// /v1/audio/transcriptions endpoint — self-hosted (faster-whisper-server, whisper.cpp
// server) or OpenAI. Zero extra npm deps (multipart via global FormData/Blob/fetch).
// Best-effort: returns null on disable/oversize/failure so the AV processor degrades
// to metadata instead of erroring. Mirrors the pluggable-embeddings pattern.
import { env } from '../env.js';
import { log, errFields } from '../logger.js';

export interface TranscriptSegment {
  start?: number; // seconds
  end?: number;
  text: string;
}
export interface TranscriptResult {
  text: string;
  segments?: TranscriptSegment[];
  language?: string;
}

export function transcribeEnabled(): boolean {
  return env.transcribe.provider === 'local' || env.transcribe.provider === 'openai';
}

export function transcribeMaxBytes(): number {
  return env.transcribe.maxBytes;
}

/**
 * Transcribe an audio/video buffer to text. Returns null when transcription is
 * disabled, the file exceeds the size cap, or the service is unreachable/failing.
 * Never throws.
 */
export async function transcribeMedia(buffer: Buffer, filename: string, mime?: string | null): Promise<TranscriptResult | null> {
  if (!transcribeEnabled()) return null;
  if (buffer.length > env.transcribe.maxBytes) {
    log.info('media exceeds transcription size cap; skipping', { bytes: buffer.length, cap: env.transcribe.maxBytes });
    return null;
  }
  const url = env.transcribe.provider === 'openai' ? 'https://api.openai.com/v1/audio/transcriptions' : env.transcribe.url;
  const key = env.transcribe.apiKey;

  // Prefer verbose_json (segments + timestamps); fall back to json if unsupported.
  for (const format of ['verbose_json', 'json'] as const) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), env.transcribe.timeoutMs);
    try {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(buffer)], { type: mime || 'application/octet-stream' }), filename);
      form.append('model', env.transcribe.model);
      form.append('response_format', format);
      const res = await fetch(url, {
        method: 'POST',
        headers: key ? { authorization: `Bearer ${key}` } : {},
        body: form,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        // 400 often means the response_format isn't supported → try the simpler one.
        if (res.status === 400 && format === 'verbose_json') {
          continue;
        }
        log.warn('transcription request failed', { status: res.status, provider: env.transcribe.provider });
        return null;
      }
      const data = (await res.json()) as { text?: string; language?: string; segments?: { start?: number; end?: number; text?: string }[] };
      const segments = Array.isArray(data.segments)
        ? data.segments.map((s) => ({ start: s.start, end: s.end, text: (s.text || '').trim() })).filter((s) => s.text)
        : undefined;
      const text = (data.text || segments?.map((s) => s.text).join(' ') || '').trim();
      return text ? { text, segments, language: data.language } : null;
    } catch (e) {
      log.warn('transcription error', errFields(e));
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
