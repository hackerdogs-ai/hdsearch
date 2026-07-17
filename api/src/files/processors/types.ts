// Pluggable file processors. Mirrors the Embedder plugin shape (embeddings.ts) and
// the search-provider registry (providers/index.ts): adding a format = adding one
// module and registering it. The pipeline is TOTAL — a `generic` fallback always
// matches, and every registered processor's extract() is contractually forbidden
// from throwing (crash-proofing, docs/file-upload-rag.md §C.3).

export type BlockKind = 'text' | 'table' | 'ocr' | 'caption' | 'metadata' | 'markup';

export interface ExtractBlock {
  text: string;
  kind?: BlockKind;
  loc?: { page?: number; sheet?: string; slide?: number; layer?: string; chunk?: number };
}

export interface ExtractResult {
  blocks: ExtractBlock[];
  meta: Record<string, unknown>; // page/sheet counts, dims, author, xmp…
  preview?: string; // short text preview for the UI
  degraded?: boolean; // true when we fell back (e.g. metadata-only)
  pages?: number;
}

export interface ProcessorCaps {
  ocr: boolean;
  vision: boolean;
  maxPages: number;
  maxChars: number;
}

export interface ProcessorInput {
  buffer: Buffer;
  name: string;
  ext: string; // lower-case, no dot
  mime: string; // as reported (do not trust blindly)
  magic: Buffer; // first bytes for sniffing
  caps: ProcessorCaps;
}

export interface FileProcessor {
  id: string;
  /** Cheap match on mime + extension + magic bytes. Highest score wins; 0 = no match. */
  match(input: { mime: string; ext: string; magic: Buffer }): number;
  /**
   * Extract searchable text/blocks. MUST NOT throw for any input — on internal
   * failure, return a degraded result (at minimum a metadata block). The worker
   * wraps this in try/catch as defense-in-depth, but processors own their errors.
   */
  extract(input: ProcessorInput): Promise<ExtractResult>;
}

/** Build the always-safe metadata block every file gets, so retrieval never hard-fails. */
export function metadataBlock(input: ProcessorInput, extra?: Record<string, unknown>): ExtractBlock {
  const kb = Math.max(1, Math.round(input.buffer.length / 1024));
  const parts = [
    `File: ${input.name}`,
    input.ext ? `Type: ${input.ext.toUpperCase()}` : '',
    input.mime ? `MIME: ${input.mime}` : '',
    `Size: ${kb} KB`,
  ].filter(Boolean);
  if (extra) for (const [k, v] of Object.entries(extra)) parts.push(`${k}: ${String(v)}`);
  return { text: parts.join('\n'), kind: 'metadata' };
}

/** Clamp extracted text to the per-file char budget, appending a truncation note. */
export function clampChars(blocks: ExtractBlock[], maxChars: number): ExtractBlock[] {
  let used = 0;
  const out: ExtractBlock[] = [];
  for (const b of blocks) {
    if (used >= maxChars) break;
    const remaining = maxChars - used;
    if (b.text.length <= remaining) {
      out.push(b);
      used += b.text.length;
    } else {
      out.push({ ...b, text: b.text.slice(0, remaining) + '\n…[truncated: file exceeds extraction limit]' });
      used = maxChars;
      break;
    }
  }
  return out;
}
