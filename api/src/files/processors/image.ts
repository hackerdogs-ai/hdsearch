// Raster images. Always emits metadata + sniffed dimensions (zero-dep). When
// HDSEARCH_FILE_OCR is on and tesseract.js is installed, also OCRs text from the
// image (time-boxed, optional). Vision captioning is a documented hook (off by
// default; would call the existing LLM vision keys). Never throws.
import type { FileProcessor, ProcessorInput, ExtractResult, ExtractBlock } from './types.js';
import { metadataBlock } from './types.js';
import { optionalImport, withTimeout } from '../optional.js';

const EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'ico', 'avif', 'heic']);
// Only true RASTER mimes — deliberately excludes vendor image/* types like
// image/vnd.dwg or image/vnd.adobe.photoshop so those fall to their own processor
// (psd) or the generic metadata fallback (dwg), not here.
const RASTER_MIME = new Set([
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp',
  'image/bmp', 'image/tiff', 'image/x-icon', 'image/vnd.microsoft.icon',
  'image/avif', 'image/heic', 'image/heif',
]);

export const imageProcessor: FileProcessor = {
  id: 'image',
  match({ mime, ext }) {
    if (EXTS.has(ext)) return 0.9;
    // NB: image/svg+xml is handled by xml (keep markup); psd by psd; dwg by generic.
    if (RASTER_MIME.has(mime)) return 0.6;
    return 0;
  },
  async extract(input: ProcessorInput): Promise<ExtractResult> {
    const dims = sniffDimensions(input.buffer, input.ext);
    const meta = metadataBlock(input, dims ? { Dimensions: `${dims.w}x${dims.h}` } : undefined);
    const blocks: ExtractBlock[] = [meta];

    if (input.caps.ocr) {
      const ocr = await withTimeout(() => runOcr(input.buffer), 60000, '', 'ocr');
      if (ocr.trim()) blocks.push({ text: ocr.trim(), kind: 'ocr' });
    }

    const hasText = blocks.some((b) => b.kind === 'ocr');
    return {
      blocks,
      meta: { ...(dims || {}), ocr: hasText },
      degraded: !hasText, // image with no extracted text is metadata-only by nature
      preview: hasText ? blocks.find((b) => b.kind === 'ocr')!.text.slice(0, 300) : `Image ${input.name}`,
    };
  },
};

async function runOcr(buffer: Buffer): Promise<string> {
  const tesseract: any = await optionalImport('tesseract.js');
  if (!tesseract?.recognize) return '';
  try {
    const { data } = await tesseract.recognize(buffer, 'eng');
    return data?.text || '';
  } catch {
    return '';
  }
}

/** Minimal header sniff for the common formats — no image lib needed. */
function sniffDimensions(buf: Buffer, ext: string): { w: number; h: number } | null {
  try {
    // PNG: width/height are big-endian uint32 at offsets 16/20.
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    }
    // GIF: little-endian uint16 at offsets 6/8.
    if (buf.length > 10 && buf.slice(0, 3).toString('ascii') === 'GIF') {
      return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    }
    // JPEG: scan SOFn markers for height/width.
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let o = 2;
      while (o + 9 < buf.length) {
        if (buf[o] !== 0xff) {
          o++;
          continue;
        }
        const marker = buf[o + 1]!;
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
        }
        o += 2 + buf.readUInt16BE(o + 2);
      }
    }
  } catch {
    /* ignore malformed headers */
  }
  void ext;
  return null;
}
