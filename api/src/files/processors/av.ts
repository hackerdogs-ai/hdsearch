// Audio & video. Transcribes speech to searchable text via Whisper (files/transcribe.ts)
// so RAG can answer over spoken content. Segments carry timestamps so chunks/citations
// can point at a time offset. When transcription is disabled/oversized/failed, degrades
// to a metadata document. Never throws.
import type { FileProcessor, ProcessorInput, ExtractResult, ExtractBlock } from './types.js';
import { metadataBlock } from './types.js';
import { transcribeEnabled, transcribeMedia, transcribeMaxBytes } from '../transcribe.js';

const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'oga', 'flac', 'aac', 'opus', 'wma', 'mpga']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'wmv', 'flv', 'mpeg', 'mpg']);

export const avProcessor: FileProcessor = {
  id: 'av',
  match({ mime, ext }) {
    if (mime.startsWith('audio/') || mime.startsWith('video/')) return 0.9;
    if (AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext)) return 0.85;
    return 0;
  },
  async extract(input: ProcessorInput): Promise<ExtractResult> {
    const isVideo = input.mime.startsWith('video/') || VIDEO_EXTS.has(input.ext);
    const meta = metadataBlock(input, { Kind: isVideo ? 'video' : 'audio' });

    if (!transcribeEnabled()) {
      return { blocks: [meta], meta: { transcribed: false, note: 'transcription disabled' }, degraded: true };
    }
    if (input.buffer.length > transcribeMaxBytes()) {
      return {
        blocks: [meta],
        meta: { transcribed: false, note: 'exceeds transcription size cap' },
        degraded: true,
        preview: `${isVideo ? 'Video' : 'Audio'} ${input.name} (too large to transcribe)`,
      };
    }

    const result = await transcribeMedia(input.buffer, input.name, input.mime);
    if (!result) {
      return { blocks: [meta], meta: { transcribed: false }, degraded: true };
    }

    const blocks: ExtractBlock[] = [meta];
    if (result.segments?.length) {
      // Prefix each segment with its start time so timestamps survive into chunks.
      const text = result.segments.map((s) => (s.start != null ? `[${fmtTime(s.start)}] ` : '') + s.text).join('\n');
      blocks.push({ text, kind: 'text' });
    } else {
      blocks.push({ text: result.text, kind: 'text' });
    }
    return {
      blocks,
      meta: { transcribed: true, language: result.language, chars: result.text.length, segments: result.segments?.length },
      preview: result.text.slice(0, 400),
    };
  },
};

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
