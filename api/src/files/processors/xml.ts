// XML / SVG / RSS / XSD. Requirement: "xml keep xml". We preserve the raw markup
// (one block) AND emit a text-node projection (a second block) so semantic search
// works without a heavyweight XML parser. Zero-dep.
import type { FileProcessor, ProcessorInput, ExtractResult } from './types.js';
import { metadataBlock } from './types.js';

const EXTS = new Set(['xml', 'svg', 'rss', 'atom', 'xsd', 'xsl', 'xslt', 'plist', 'kml', 'gml']);

export const xmlProcessor: FileProcessor = {
  id: 'xml',
  match({ mime, ext, magic }) {
    if (EXTS.has(ext)) return 0.92;
    if (mime === 'text/xml' || mime === 'application/xml' || mime.endsWith('+xml') || mime === 'image/svg+xml') return 0.7;
    // sniff a leading "<?xml" or "<svg"
    const head = magic.slice(0, 64).toString('utf8').trimStart().toLowerCase();
    if (head.startsWith('<?xml') || head.startsWith('<svg')) return 0.5;
    return 0;
  },
  async extract(input: ProcessorInput): Promise<ExtractResult> {
    const meta = metadataBlock(input);
    let raw: string;
    try {
      raw = input.buffer.toString('utf8');
    } catch {
      return { blocks: [meta], meta: {}, degraded: true };
    }
    const textNodes = stripTags(raw);
    const attrs = extractAttrText(raw); // titles, labels, alt, desc — meaningful in SVG/RSS
    const blocks = [meta, { text: raw, kind: 'markup' as const }];
    const projection = [textNodes, attrs].filter(Boolean).join('\n');
    if (projection.trim()) blocks.push({ text: projection, kind: 'text' as any });
    return {
      blocks,
      meta: { format: input.ext === 'svg' ? 'svg' : 'xml', rootTag: rootTag(raw) },
      preview: (projection || raw).slice(0, 400),
    };
  },
};

function stripTags(xml: string): string {
  return xml
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, ' $1 ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function extractAttrText(xml: string): string {
  const wanted = /\b(title|label|alt|desc|name|aria-label|content)\s*=\s*"([^"]*)"/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = wanted.exec(xml)) && guard++ < 5000) if (m[2]?.trim()) out.push(m[2].trim());
  return out.join(' ');
}
function rootTag(xml: string): string {
  const m = xml.match(/<\s*([a-zA-Z_][\w:.-]*)/);
  return m?.[1] || '';
}
