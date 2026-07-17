// Office documents: docx / pptx (+ odt/odp) via SYNCHRONOUS in-memory unzip
// (fflate) — deliberately NOT a streaming parser, because streaming unzip libs emit
// async zlib 'error' events on corrupt input that escape try/catch and crash the
// process. fflate.unzipSync throws a catchable error instead, keeping the pipeline
// crash-proof (verified against byte-flipped office files). Spreadsheets go through
// SheetJS (also synchronous). All parsers are optional deps; self-degrades to
// metadata if absent. Never throws.
import type { FileProcessor, ProcessorInput, ExtractResult, ExtractBlock } from './types.js';
import { metadataBlock } from './types.js';
import { optionalImport } from '../optional.js';

const DOC_EXTS = new Set(['docx', 'pptx', 'odt', 'odp']);
const SHEET_EXTS = new Set(['xlsx', 'xls', 'xlsm', 'ods']);

const MIME = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

export const officeProcessor: FileProcessor = {
  id: 'office',
  match({ mime, ext, magic }) {
    if (DOC_EXTS.has(ext) || SHEET_EXTS.has(ext)) return 0.95;
    if (MIME.has(mime)) return 0.8;
    if (magic.slice(0, 2).toString('latin1') === 'PK' && (DOC_EXTS.has(ext) || SHEET_EXTS.has(ext))) return 0.6;
    return 0;
  },
  async extract(input: ProcessorInput): Promise<ExtractResult> {
    const meta = metadataBlock(input);
    if (SHEET_EXTS.has(input.ext)) return extractSheet(input, meta);
    return extractDoc(input, meta);
  },
};

// ---- spreadsheets (SheetJS) -------------------------------------------------
async function extractSheet(input: ProcessorInput, meta: ExtractBlock): Promise<ExtractResult> {
  const XLSX: any = await optionalImport('xlsx');
  if (!XLSX?.read) return { blocks: [meta], meta: { note: 'xlsx (SheetJS) not installed' }, degraded: true };
  try {
    const wb = XLSX.read(input.buffer, { type: 'buffer', cellDates: true, cellText: true });
    const blocks: ExtractBlock[] = [meta];
    const names: string[] = wb.SheetNames || [];
    for (const name of names) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const csv: string = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
      if (csv.trim()) blocks.push({ text: `# Sheet: ${name}\n${csv}`, kind: 'table', loc: { sheet: name } });
    }
    return {
      blocks,
      meta: { sheets: names.length, sheetNames: names.slice(0, 50) },
      degraded: blocks.length === 1,
      preview: blocks.find((b) => b.kind === 'table')?.text.slice(0, 400),
    };
  } catch (e) {
    return { blocks: [meta], meta: { error: (e as Error).message }, degraded: true };
  }
}

// ---- word/presentation/opendocument (fflate unzip → XML text) ---------------
async function extractDoc(input: ProcessorInput, meta: ExtractBlock): Promise<ExtractResult> {
  const fflate: any = await optionalImport('fflate');
  if (!fflate?.unzipSync) return { blocks: [meta], meta: { note: 'fflate not installed' }, degraded: true };
  try {
    // Only inflate the XML parts we need — bounds work on huge decks.
    const wanted = /(word\/(document|header\d*|footer\d*)\.xml|ppt\/slides\/slide\d+\.xml|ppt\/notesSlides\/notesSlide\d+\.xml|content\.xml)$/;
    const entries: Record<string, Uint8Array> = fflate.unzipSync(new Uint8Array(input.buffer), {
      filter: (f: { name: string }) => wanted.test(f.name),
    });
    const dec = new TextDecoder('utf-8');
    const blocks: ExtractBlock[] = [meta];
    let slides = 0;

    const names = Object.keys(entries).sort(naturalSort);
    for (const name of names) {
      const xml = dec.decode(entries[name]!);
      if (/ppt\/slides\/slide\d+\.xml$/.test(name)) {
        slides++;
        const text = stripOoxml(xml, ['a:p']);
        if (text.trim()) blocks.push({ text, kind: 'text', loc: { slide: slides } });
      } else if (/word\/document\.xml$/.test(name)) {
        const text = stripOoxml(xml, ['w:p']);
        if (text.trim()) blocks.push({ text, kind: 'text' });
      } else {
        const text = stripOoxml(xml, ['w:p', 'a:p', 'text:p', 'text:h']);
        if (text.trim()) blocks.push({ text, kind: 'text' });
      }
    }
    const chars = blocks.reduce((a, b) => a + (b.kind === 'text' ? b.text.length : 0), 0);
    return {
      blocks,
      meta: { slides: slides || undefined, chars },
      degraded: chars === 0,
      preview: blocks.find((b) => b.kind === 'text')?.text.slice(0, 400),
    };
  } catch (e) {
    return { blocks: [meta], meta: { error: (e as Error).message }, degraded: true };
  }
}

/** Turn OOXML/ODF part XML into readable text: break on paragraph-close tags, drop the
 *  rest of the markup, decode entities. Robust to unknown tags. */
function stripOoxml(xml: string, paraTags: string[]): string {
  let s = xml;
  for (const p of paraTags) s = s.split(`</${p}>`).join('\n');
  s = s
    .replace(/<w:tab\/?>/g, '\t')
    .replace(/<(w|a):br\/?>/g, '\n')
    .replace(/<[^>]+>/g, '') // drop all remaining tags
    .replace(/&#(\d+);/g, (_, n) => safeChar(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

function safeChar(code: number): string {
  try {
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

/** slide2 before slide10. */
function naturalSort(a: string, b: string): number {
  const na = a.match(/(\d+)\.xml$/)?.[1];
  const nb = b.match(/(\d+)\.xml$/)?.[1];
  if (na && nb) return Number(na) - Number(nb);
  return a.localeCompare(b);
}
