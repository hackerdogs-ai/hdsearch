// The always-matches fallback (score 0.01). Guarantees the pipeline is TOTAL: any
// file — including opaque binaries (dwg, unknown) and any format whose optional
// parser dep is missing — yields at least a metadata document so RAG never
// hard-fails (docs/file-upload-rag.md §C.2/§C.3). Also opportunistically salvages
// printable-ASCII runs and embedded XMP metadata from binaries. Never throws.
import type { FileProcessor, ProcessorInput, ExtractResult } from './types.js';
import { metadataBlock } from './types.js';

export const genericProcessor: FileProcessor = {
  id: 'generic',
  match() {
    return 0.01; // lowest — only wins when nothing else matches
  },
  async extract(input: ProcessorInput): Promise<ExtractResult> {
    const extra: Record<string, unknown> = {};
    const blocks = [metadataBlock(input, extra)];
    try {
      const xmp = extractXmp(input.buffer);
      if (xmp) blocks.push({ text: xmp, kind: 'metadata' });
      // Only mine ASCII runs from smallish files to bound cost; big binaries stay metadata-only.
      if (input.buffer.length <= 8 * 1024 * 1024) {
        const ascii = printableRuns(input.buffer, 6, 20000);
        if (ascii.trim().length > 40) blocks.push({ text: ascii, kind: 'text' });
      }
    } catch {
      /* metadata block already present — nothing else to do */
    }
    return {
      blocks,
      meta: { fallback: true, mime: input.mime, ext: input.ext },
      degraded: true,
      preview: `${input.name} (${input.ext || input.mime || 'binary'})`,
    };
  },
};

/** Extract an embedded XMP packet (present in many design/image/PDF binaries). */
function extractXmp(buf: Buffer): string | null {
  const s = buf.toString('latin1');
  const start = s.indexOf('<x:xmpmeta');
  if (start === -1) return null;
  const end = s.indexOf('</x:xmpmeta>', start);
  if (end === -1) return null;
  const xmp = s.slice(start, end + 12);
  const text = xmp
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? `Embedded metadata: ${text.slice(0, 4000)}` : null;
}

/** Concatenate runs of printable ASCII of length >= min, up to a char cap. */
function printableRuns(buf: Buffer, min: number, cap: number): string {
  const out: string[] = [];
  let cur: number[] = [];
  let total = 0;
  for (let i = 0; i < buf.length && total < cap; i++) {
    const b = buf[i]!;
    if (b >= 0x20 && b <= 0x7e) {
      cur.push(b);
    } else {
      if (cur.length >= min) {
        const s = Buffer.from(cur).toString('ascii');
        out.push(s);
        total += s.length + 1;
      }
      cur = [];
    }
  }
  if (cur.length >= min) out.push(Buffer.from(cur).toString('ascii'));
  return out.join(' ');
}
