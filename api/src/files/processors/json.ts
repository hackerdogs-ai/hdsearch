// JSON / JSONL / NDJSON. Requirement: "json … keep [it as] json". We preserve the
// structure verbatim (pretty-printed when valid) so the model sees real JSON, and
// fall back to raw text if it doesn't parse. Zero-dep.
import type { FileProcessor, ProcessorInput, ExtractResult } from './types.js';
import { metadataBlock } from './types.js';

const EXTS = new Set(['json', 'jsonl', 'ndjson', 'geojson']);

export const jsonProcessor: FileProcessor = {
  id: 'json',
  match({ mime, ext }) {
    if (EXTS.has(ext)) return 0.95;
    if (mime === 'application/json' || mime.endsWith('+json')) return 0.7;
    return 0;
  },
  async extract(input: ProcessorInput): Promise<ExtractResult> {
    const meta = metadataBlock(input);
    const raw = safeUtf8(input.buffer);
    if (raw == null) return { blocks: [meta], meta: {}, degraded: true };

    // JSONL/NDJSON: keep line-delimited objects as-is (don't force a single parse).
    if (input.ext === 'jsonl' || input.ext === 'ndjson' || /\}\s*\n\s*\{/.test(raw.slice(0, 2000))) {
      return { blocks: [meta, { text: raw, kind: 'text' }], meta: { format: 'jsonl' }, preview: raw.slice(0, 400) };
    }
    try {
      const parsed = JSON.parse(raw);
      const pretty = JSON.stringify(parsed, null, 2);
      return {
        blocks: [meta, { text: pretty, kind: 'text' }],
        meta: { format: 'json', keys: topKeys(parsed) },
        preview: pretty.slice(0, 400),
      };
    } catch {
      // Malformed JSON — index the raw text so it's still searchable.
      return { blocks: [meta, { text: raw, kind: 'text' }], meta: { format: 'json', invalid: true }, degraded: true, preview: raw.slice(0, 400) };
    }
  },
};

function safeUtf8(buf: Buffer): string | null {
  try {
    return buf.toString('utf8');
  } catch {
    return null;
  }
}
function topKeys(v: unknown): string[] {
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.keys(v as object).slice(0, 50);
  return [];
}
