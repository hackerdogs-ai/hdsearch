// PDF (+ Illustrator .ai, which is usually PDF-compatible). Uses pdfjs-dist when
// installed; otherwise self-degrades to a metadata result. Page-capped + never throws.
// When a page has no text layer and OCR is enabled, optionally rasterize + tesseract.
import type { FileProcessor, ProcessorInput, ExtractResult, ExtractBlock } from './types.js';
import { metadataBlock } from './types.js';
import { optionalImport, withTimeout } from '../optional.js';

export const pdfProcessor: FileProcessor = {
  id: 'pdf',
  match({ mime, ext, magic }) {
    if (ext === 'pdf') return 0.95;
    if (ext === 'ai') return 0.4; // Illustrator: try PDF path, else generic salvages it
    if (mime === 'application/pdf') return 0.8;
    if (magic.slice(0, 5).toString('latin1') === '%PDF-') return 0.7;
    return 0;
  },
  async extract(input: ProcessorInput): Promise<ExtractResult> {
    const meta = metadataBlock(input);
    // pdfjs ships a Node-friendly legacy ESM build.
    const pdfjs: any =
      (await optionalImport('pdfjs-dist/legacy/build/pdf.mjs')) || (await optionalImport('pdfjs-dist'));
    if (!pdfjs?.getDocument) {
      return { blocks: [meta], meta: { note: 'pdfjs-dist not installed' }, degraded: true };
    }
    try {
      const data = new Uint8Array(input.buffer);
      const doc = await pdfjs.getDocument({ data, disableWorker: true, isEvalSupported: false }).promise;
      const total: number = doc.numPages || 0;
      const limit = Math.min(total, input.caps.maxPages);
      const blocks: ExtractBlock[] = [meta];
      let extracted = 0;
      let ocrPages = 0;
      const wantOcr = !!input.caps.ocr;

      for (let p = 1; p <= limit; p++) {
        try {
          const page = await doc.getPage(p);
          const content = await page.getTextContent();
          const text = (content.items || [])
            .map((it: any) => (typeof it.str === 'string' ? it.str : ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (text) {
            blocks.push({ text, kind: 'text', loc: { page: p } });
            extracted++;
          } else if (wantOcr) {
            const ocr = await withTimeout(() => ocrPdfPage(page), 45000, '', `pdf-ocr:p${p}`);
            if (ocr.trim()) {
              blocks.push({ text: ocr.trim(), kind: 'ocr', loc: { page: p } });
              extracted++;
              ocrPages++;
            }
          }
          page.cleanup?.();
        } catch {
          /* skip unreadable page */
        }
      }
      await doc.cleanup?.();
      const degraded = extracted === 0; // image-only/scanned PDF with no text layer
      const preview =
        blocks.find((b) => b.kind === 'text' || b.kind === 'ocr')?.text.slice(0, 400) || undefined;
      return {
        blocks,
        meta: { pages: total, extractedPages: extracted, ocrPages, truncated: total > limit },
        pages: total,
        degraded,
        preview,
      };
    } catch (e) {
      return { blocks: [meta], meta: { error: (e as Error).message }, degraded: true };
    }
  },
};

/** Rasterize one PDF page and OCR it. Best-effort — returns '' if canvas/tesseract unavailable. */
async function ocrPdfPage(page: any): Promise<string> {
  const canvasMod: any = await optionalImport('@napi-rs/canvas');
  const tesseract: any = await optionalImport('tesseract.js');
  if (!canvasMod?.createCanvas || !tesseract?.recognize) return '';

  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = canvasMod.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  // pdfjs expects a CanvasRenderingContext2D-like object; Node canvas satisfies this.
  await page.render({ canvasContext: ctx, viewport, canvasFactory: undefined }).promise;

  let png: Buffer;
  if (typeof canvas.toBuffer === 'function') {
    png = canvas.toBuffer('image/png');
  } else {
    return '';
  }
  const { data } = await tesseract.recognize(png, 'eng');
  return data?.text || '';
}
