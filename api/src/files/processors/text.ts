// Plain text / markdown / csv / logs / html. Zero-dep; always available.
import type { FileProcessor, ProcessorInput, ExtractResult } from './types.js';
import { metadataBlock } from './types.js';

const EXTS = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'text', 'rtf', 'html', 'htm']);
const HTML_EXTS = new Set(['html', 'htm']);

export const textProcessor: FileProcessor = {
  id: 'text',
  match({ mime, ext }) {
    if (HTML_EXTS.has(ext) || mime === 'text/html' || mime === 'application/xhtml+xml') return 0.85;
    if (EXTS.has(ext)) return 0.9;
    if (mime.startsWith('text/') && mime !== 'text/xml') return 0.6;
    return 0;
  },
  async extract(input: ProcessorInput): Promise<ExtractResult> {
    const meta = metadataBlock(input);
    try {
      const raw = input.buffer.toString('utf8');
      const text =
        HTML_EXTS.has(input.ext) || input.mime === 'text/html' || input.mime === 'application/xhtml+xml'
          ? stripHtml(raw)
          : raw;
      return {
        blocks: [meta, { text, kind: 'text' }],
        meta: { chars: text.length },
        preview: text.slice(0, 400),
      };
    } catch {
      return { blocks: [meta], meta: {}, degraded: true };
    }
  },
};

/** Minimal HTML → readable text for RAG (no DOM deps). */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, '\n')
    .replace(/<(br|hr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
