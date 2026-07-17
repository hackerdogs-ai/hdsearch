// Photoshop PSD/PSB. Uses ag-psd (optional dep) to read the layer tree + text-layer
// contents WITHOUT decoding pixel data (fast, low-memory). Extracts every text
// layer's string plus a layer-name outline + canvas size. Self-degrades to metadata
// if ag-psd isn't installed. Never throws.
import type { FileProcessor, ProcessorInput, ExtractResult, ExtractBlock } from './types.js';
import { metadataBlock } from './types.js';
import { optionalImport } from '../optional.js';

export const psdProcessor: FileProcessor = {
  id: 'psd',
  match({ mime, ext, magic }) {
    if (ext === 'psd' || ext === 'psb') return 0.95;
    if (mime === 'image/vnd.adobe.photoshop') return 0.8;
    // PSD magic: "8BPS"
    if (magic.slice(0, 4).toString('latin1') === '8BPS') return 0.7;
    return 0;
  },
  async extract(input: ProcessorInput): Promise<ExtractResult> {
    const meta = metadataBlock(input);
    const agPsd: any = await optionalImport('ag-psd');
    const readPsd = agPsd?.readPsd || agPsd?.default?.readPsd;
    if (!readPsd) return { blocks: [meta], meta: { note: 'ag-psd not installed' }, degraded: true };
    try {
      const psd = readPsd(input.buffer, {
        skipLayerImageData: true,
        skipCompositeImageData: true,
        skipThumbnail: true,
      });
      const texts: string[] = [];
      const names: string[] = [];
      walk(psd?.children || [], (layer) => {
        if (layer.name) names.push(layer.name);
        const t = layer.text?.text;
        if (typeof t === 'string' && t.trim()) texts.push(t.trim());
      });
      const blocks: ExtractBlock[] = [
        metadataBlock(input, { Canvas: `${psd?.width ?? '?'}x${psd?.height ?? '?'}`, Layers: names.length }),
      ];
      if (names.length) blocks.push({ text: `Layers: ${names.slice(0, 100).join(', ')}`, kind: 'metadata' });
      const textContent = texts.join('\n');
      if (textContent.trim()) blocks.push({ text: textContent, kind: 'text', loc: { layer: 'text-layers' } });
      return {
        blocks,
        meta: { width: psd?.width, height: psd?.height, layers: names.length, textLayers: texts.length },
        degraded: !textContent.trim(),
        preview: (textContent || names.join(', ')).slice(0, 400),
      };
    } catch (e) {
      return { blocks: [meta], meta: { error: (e as Error).message }, degraded: true };
    }
  },
};

function walk(children: any[], fn: (layer: any) => void) {
  for (const c of children || []) {
    fn(c);
    if (Array.isArray(c.children)) walk(c.children, fn);
  }
}
