// Token-aware-ish chunker (char-approximated: ~4 chars/token). Splits extracted
// blocks into ~800-token windows with ~120-token overlap on paragraph/line
// boundaries, preserving each block's location (page/sheet/slide) so citations can
// point back precisely. Small blocks (e.g. a whole small table or a metadata block)
// are kept whole.
import type { ExtractBlock } from './processors/types.js';

const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 800;
const OVERLAP_TOKENS = 120;
const TARGET = TARGET_TOKENS * CHARS_PER_TOKEN; // ~3200 chars
const OVERLAP = OVERLAP_TOKENS * CHARS_PER_TOKEN; // ~480 chars
const MIN_CHUNK = 24; // drop near-empty fragments

export interface Chunk {
  text: string;
  index: number;
  loc?: ExtractBlock['loc'];
  kind?: ExtractBlock['kind'];
}

export function chunkBlocks(blocks: ExtractBlock[]): Chunk[] {
  const chunks: Chunk[] = [];
  let index = 0;
  for (const block of blocks) {
    const text = block.text?.trim();
    if (!text || text.length < 1) continue;
    if (text.length <= TARGET) {
      // A whole block (even a short one) is meaningful content — keep it. MIN_CHUNK
      // only filters tiny leftover fragments produced when splitting long text.
      chunks.push({ text, index: index++, loc: block.loc, kind: block.kind });
      continue;
    }
    for (const piece of splitLong(text)) {
      if (piece.length >= MIN_CHUNK) chunks.push({ text: piece, index: index++, loc: block.loc, kind: block.kind });
    }
  }
  return chunks;
}

/** Greedy paragraph/line packing into ~TARGET windows with OVERLAP carry-over. */
function splitLong(text: string): string[] {
  const units = text.split(/\n{2,}/); // paragraphs first
  const out: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = '';
  };
  for (let unit of units) {
    // A single mega-paragraph still needs hard splitting.
    while (unit.length > TARGET) {
      const head = unit.slice(0, TARGET);
      const cut = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('. '), head.lastIndexOf(' '));
      const at = cut > TARGET * 0.6 ? cut + 1 : TARGET;
      if (buf) flush();
      out.push(unit.slice(0, at).trim());
      unit = unit.slice(Math.max(0, at - OVERLAP)); // carry overlap
    }
    if (buf.length + unit.length + 2 > TARGET) {
      const tail = buf.slice(Math.max(0, buf.length - OVERLAP));
      flush();
      buf = tail ? `${tail}\n\n${unit}` : unit;
    } else {
      buf = buf ? `${buf}\n\n${unit}` : unit;
    }
  }
  flush();
  return out;
}
