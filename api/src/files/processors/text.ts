// Plain text / markdown / csv / logs. Zero-dep; always available.
import type { FileProcessor, ProcessorInput, ExtractResult } from './types.js';
import { metadataBlock } from './types.js';

const EXTS = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'text', 'rtf']);

export const textProcessor: FileProcessor = {
  id: 'text',
  match({ mime, ext }) {
    if (EXTS.has(ext)) return 0.9;
    if (mime.startsWith('text/') && mime !== 'text/xml' && mime !== 'text/html') return 0.6;
    return 0;
  },
  async extract(input: ProcessorInput): Promise<ExtractResult> {
    const meta = metadataBlock(input);
    try {
      const text = input.buffer.toString('utf8');
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
