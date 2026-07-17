import { describe, it, expect } from 'vitest';
import { runExtraction, pickProcessor, PROCESSORS } from '../src/files/processors/index.js';
import type { ProcessorInput } from '../src/files/processors/types.js';
import { chunkBlocks } from '../src/files/chunk.js';

const caps = { ocr: false, vision: false, maxPages: 100, maxChars: 1_000_000 };

function input(name: string, mime: string, body: Buffer | string): ProcessorInput {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const dot = name.lastIndexOf('.');
  return {
    buffer,
    name,
    ext: dot >= 0 ? name.slice(dot + 1).toLowerCase() : '',
    mime,
    magic: buffer.subarray(0, 64),
    caps,
  };
}

describe('processor registry — totality (crash-proof)', () => {
  const samples: Array<[string, string, Buffer | string]> = [
    ['notes.md', 'text/markdown', '# Title\nhello world'],
    ['data.json', 'application/json', '{"a":1,"b":[2,3]}'],
    ['bad.json', 'application/json', '{ not valid json '],
    ['icon.svg', 'image/svg+xml', '<svg><title>Logo</title><text>Hi</text></svg>'],
    ['feed.xml', 'application/xml', '<?xml version="1.0"?><rss><item><title>News</title></item></rss>'],
    ['blob.dwg', 'application/acad', Buffer.from([0x41, 0x43, 0x31, 0x30, 0x00, 0xff, 0x00, 0x10])],
    ['unknown.bin', 'application/octet-stream', Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])],
    ['photo.png', 'image/png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40)])],
    ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from('PK\x03\x04rest')],
    ['doc.pdf', 'application/pdf', Buffer.from('%PDF-1.4 not really a pdf')],
    ['clip.mp4', 'video/mp4', Buffer.concat([Buffer.from('ftypmp42'), Buffer.alloc(64)])],
    ['voice.mp3', 'audio/mpeg', Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00])],
  ];

  for (const [name, mime, body] of samples) {
    it(`always yields >= 1 block and never throws: ${name}`, async () => {
      const { result, processorId } = await runExtraction(input(name, mime, body), 5000);
      expect(processorId).toBeTruthy();
      expect(Array.isArray(result.blocks)).toBe(true);
      expect(result.blocks.length).toBeGreaterThanOrEqual(1);
      // the first block is always the metadata document
      expect(result.blocks[0]!.text).toContain('File:');
    });
  }

  it('generic fallback always matches something', () => {
    const proc = pickProcessor({ mime: 'application/x-weird', ext: 'zzz', magic: Buffer.from([9, 9, 9]) });
    expect(proc.id).toBeTruthy();
    expect(PROCESSORS.length).toBeGreaterThan(3);
  });
});

describe('structured-format preservation', () => {
  it('keeps JSON as pretty JSON', async () => {
    const { result } = await runExtraction(input('x.json', 'application/json', '{"z":9,"a":1}'), 5000);
    const joined = result.blocks.map((b) => b.text).join('\n');
    expect(joined).toContain('"z": 9');
  });

  it('keeps XML markup verbatim AND projects text nodes', async () => {
    const { result } = await runExtraction(input('x.xml', 'application/xml', '<root><name>Alice</name></root>'), 5000);
    const kinds = result.blocks.map((b) => b.kind);
    expect(kinds).toContain('markup');
    const joined = result.blocks.map((b) => b.text).join('\n');
    expect(joined).toContain('<root>'); // markup preserved
    expect(joined).toContain('Alice'); // text projection
  });
});

describe('malformed office/zip inputs never crash', () => {
  // Regression guard: a corrupt OOXML file (bad deflate data) once crashed the
  // process via an async zlib 'error' event from a streaming unzip. Office
  // extraction is now synchronous (fflate) so errors are catchable. These feed
  // corrupt PK/zip bytes as office files and assert no throw + a metadata block.
  const corrupt: Array<[string, string, Buffer]> = [
    ['garbage.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 131) % 256))])],
    ['garbage.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(200, 0)])],
    ['garbage.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from('PK\x03\x04 not really a spreadsheet at all')],
    ['empty.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.alloc(0)],
  ];
  for (const [name, mime, body] of corrupt) {
    it(`degrades, never throws: ${name}`, async () => {
      const { result } = await runExtraction(input(name, mime, body), 10000);
      expect(result.blocks.length).toBeGreaterThanOrEqual(1);
      expect(result.blocks[0]!.text).toContain('File:');
    });
  }
});

describe('audio/video routing', () => {
  it('routes to the av processor and degrades to metadata when transcription is off', async () => {
    const { result, processorId } = await runExtraction(input('talk.mp3', 'audio/mpeg', Buffer.from('ID3 fake audio')), 5000);
    expect(processorId).toBe('av');
    expect(result.degraded).toBe(true);
    expect(result.blocks[0]!.text).toContain('File:');
  });
  it('routes video by extension', async () => {
    const { processorId } = await runExtraction(input('demo.mov', 'application/octet-stream', Buffer.alloc(32)), 5000);
    expect(processorId).toBe('av');
  });
});

describe('chunker', () => {
  it('keeps small blocks whole', () => {
    const chunks = chunkBlocks([{ text: 'short text', kind: 'text' }]);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.text).toBe('short text');
  });

  it('splits long text into multiple overlapping chunks preserving loc', () => {
    const big = Array.from({ length: 400 }, (_, i) => `paragraph number ${i} with some filler words here.`).join('\n\n');
    const chunks = chunkBlocks([{ text: big, kind: 'text', loc: { page: 7 } }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.loc?.page === 7)).toBe(true);
    // monotonic indices
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });
});
