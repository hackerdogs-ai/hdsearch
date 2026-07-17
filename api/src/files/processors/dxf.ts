// AutoCAD DXF (ASCII drawing interchange). DXF is a flat list of (group-code, value)
// line pairs. Text lives in TEXT/MTEXT entities under group code 1 (and 3 for long
// MTEXT). We extract all drawing text plus an entity-type histogram — no CAD lib
// needed. Binary DXF and DWG are not ASCII → they fall through to the generic
// processor (metadata only). Never throws.
import type { FileProcessor, ProcessorInput, ExtractResult, ExtractBlock } from './types.js';
import { metadataBlock } from './types.js';

export const dxfProcessor: FileProcessor = {
  id: 'dxf',
  match({ ext, magic }) {
    if (ext === 'dxf') {
      // ASCII DXF starts with "  0\nSECTION"; binary DXF starts with "AutoCAD Binary DXF".
      const head = magic.slice(0, 22).toString('latin1');
      if (head.startsWith('AutoCAD Binary')) return 0; // let generic handle binary DXF
      return 0.9;
    }
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
    try {
      const lines = raw.split(/\r?\n/);
      const texts: string[] = [];
      const entityCounts: Record<string, number> = {};
      let inEntities = false;
      // Walk (code,value) pairs: even index = code, odd = value.
      for (let i = 0; i + 1 < lines.length; i += 2) {
        const code = lines[i]!.trim();
        const value = lines[i + 1] ?? '';
        if (code === '2' && (value === 'ENTITIES' || value === 'BLOCKS')) inEntities = true;
        if (code === '2' && value === 'OBJECTS') inEntities = false;
        if (code === '0') {
          const v = value.trim();
          if (v && v !== 'SECTION' && v !== 'ENDSEC') entityCounts[v] = (entityCounts[v] || 0) + 1;
        }
        // Text payloads: group code 1 (primary text), 3 (additional MTEXT chunks).
        if ((code === '1' || code === '3') && value.trim()) {
          const cleaned = cleanMText(value);
          if (cleaned && !looksLikeHandle(cleaned)) texts.push(cleaned);
        }
      }
      const blocks: ExtractBlock[] = [meta];
      const entitySummary = Object.entries(entityCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 40)
        .map(([k, n]) => `${k}: ${n}`)
        .join(', ');
      if (entitySummary) blocks.push({ text: `Drawing entities — ${entitySummary}`, kind: 'metadata' });
      const drawingText = dedupe(texts).join('\n');
      if (drawingText.trim()) blocks.push({ text: drawingText, kind: 'text' });
      void inEntities;
      return {
        blocks,
        meta: { entities: Object.values(entityCounts).reduce((a, b) => a + b, 0), textCount: texts.length },
        degraded: !drawingText.trim(),
        preview: (drawingText || entitySummary).slice(0, 400),
      };
    } catch (e) {
      return { blocks: [meta], meta: { error: (e as Error).message }, degraded: true };
    }
  },
};

/** Strip common MTEXT formatting codes (\A1;, \P newlines, {\f...} font blocks, etc). */
function cleanMText(s: string): string {
  return s
    .replace(/\\P/g, '\n')
    .replace(/\\[A-Za-z]+[^;\\]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\[\\{}]/g, '')
    .trim();
}
function looksLikeHandle(s: string): boolean {
  return /^[0-9A-Fa-f]{1,8}$/.test(s) && s.length <= 3; // tiny hex tokens are usually handles, not text
}
function dedupe(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}
