// Functional document I/O tests: known content in → expected answer out.
// Unlike api-test smoke checks (status codes / SSE event names), each case here
// asserts the model answer contains a fact that exists ONLY in the uploaded file.
//
// Usage:
//   HDSEARCH_API_KEY=sk-hds-... npx tsx scripts/doc-functional-test.ts [--url http://localhost:8791]
//   Prefer model: qwen3-coder:latest (override with --model)
import { argv, env, exit } from 'node:process';
import { randomUUID } from 'node:crypto';

function arg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

const URL_BASE = (arg('url') || env.HDSEARCH_API_URL || 'http://localhost:8791').replace(/\/$/, '');
const KEY = arg('key') || env.HDSEARCH_API_KEY || '';
const PREFER_MODEL = arg('model') || 'qwen3-coder:latest';

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', dim: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
if (!KEY) {
  console.error(`${C.r}Error:${C.x} pass --key or HDSEARCH_API_KEY`);
  exit(2);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(path: string, opts: { method?: string; body?: unknown; timeoutMs?: number } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60000);
  try {
    const res = await fetch(`${URL_BASE}${path}`, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    const txt = await res.text();
    let json: any = null;
    try {
      json = txt ? JSON.parse(txt) : null;
    } catch {
      json = { raw: txt };
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

async function upload(threadId: string, name: string, mime: string, bytes: Buffer) {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name);
  fd.append('threadId', threadId);
  const res = await fetch(`${URL_BASE}/v1/files`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}` },
    body: fd,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function waitReady(fileId: string, timeoutSec = 90) {
  let last: any = {};
  for (let i = 0; i < timeoutSec; i++) {
    const r = await call(`/v1/files/${fileId}/status`);
    last = r.json;
    if (last.status === 'ready' || last.status === 'failed') return last;
    await sleep(1000);
  }
  return last;
}

async function chat(opts: {
  model: string;
  threadId: string;
  fileIds: string[];
  question: string;
}): Promise<{ status: number; text: string; events: string[]; citations: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 180000);
  try {
    const res = await fetch(`${URL_BASE}/v1/ai/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: opts.question }],
        modelOverride: opts.model,
        autoSelect: false,
        threadId: opts.threadId,
        fileIds: opts.fileIds,
        temporary: true,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      return { status: res.status, text: (await res.text()).slice(0, 300), events: [], citations: 0 };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const events: string[] = [];
    let text = '';
    let citations = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const frames = buf.split('\n\n');
      buf = frames.pop() || '';
      for (const f of frames) {
        const ev = f.split('\n').find((l) => l.startsWith('event:'))?.slice(6).trim();
        const dl = f.split('\n').find((l) => l.startsWith('data:'))?.slice(5).trim();
        if (ev) events.push(ev);
        if (!dl) continue;
        try {
          const j = JSON.parse(dl);
          if (j.type === 'text' && j.delta) text += j.delta;
          if (Array.isArray(j.citations)) citations = Math.max(citations, j.citations.length);
        } catch {
          /* ignore */
        }
      }
    }
    return { status: res.status, text, events, citations };
  } finally {
    clearTimeout(t);
  }
}

function minimalPdf(text: string): Buffer {
  const safe = text.replace(/[()\\]/g, '');
  const stream = `BT /F1 12 Tf 50 700 Td (${safe}) Tj ET`;
  const objs = [
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n',
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n',
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const o of objs) {
    offsets.push(Buffer.byteLength(body, 'utf8'));
    body += o;
  }
  const xrefStart = Buffer.byteLength(body, 'utf8');
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  body += `trailer<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body);
}

async function zipOoxml(files: Record<string, string>): Promise<Buffer> {
  const fflate: any = await import('fflate');
  const enc: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) enc[k] = fflate.strToU8(v);
  return Buffer.from(fflate.zipSync(enc));
}

async function minimalDocx(text: string): Promise<Buffer> {
  return zipOoxml({
    '[Content_Types].xml':
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    '_rels/.rels':
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml':
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  });
}

async function minimalPptx(text: string): Promise<Buffer> {
  return zipOoxml({
    '[Content_Types].xml':
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>` +
      `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`,
    '_rels/.rels':
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    'ppt/presentation.xml':
      `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels':
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`,
    'ppt/slides/slide1.xml':
      `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
      `<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  });
}

async function minimalXlsx(code: string, amount: string): Promise<Buffer> {
  const XLSX: any = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['project_code', 'budget_usd'],
    [code, amount],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Budget');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

type Case = {
  kind: string;
  name: string;
  mime: string;
  body: Buffer;
  /** Must appear in extracted preview (proves parse I→O). */
  extractMustContain: string;
  question: string;
  /** Must appear in model answer (proves RAG chat I→O). */
  answerMustContain: string | RegExp;
};

async function buildCases(): Promise<Case[]> {
  return [
    {
      kind: 'txt',
      name: 'policy.txt',
      mime: 'text/plain',
      body: Buffer.from(
        'Internal policy memo.\nThe emergency rollback passphrase is SILVERBIRCH-4419.\nDo not share outside the on-call team.',
      ),
      extractMustContain: 'SILVERBIRCH-4419',
      question:
        'From the attached document only: what is the emergency rollback passphrase? Reply with just the passphrase.',
      answerMustContain: /SILVERBIRCH-4419/i,
    },
    {
      kind: 'md',
      name: 'runbook.md',
      mime: 'text/markdown',
      body: Buffer.from('# Runbook\n\nPrimary datacenter region code: **AZURE-WESTUS3-FX9**.\n'),
      extractMustContain: 'AZURE-WESTUS3-FX9',
      question: 'From the attached markdown only: what is the primary datacenter region code? Reply with just the code.',
      answerMustContain: /AZURE-WESTUS3-FX9/i,
    },
    {
      kind: 'html',
      name: 'incident.html',
      mime: 'text/html',
      body: Buffer.from(
        '<!doctype html><html><body><h1>Incident</h1><p>Root cause ticket: <b>INC-928471</b>.</p></body></html>',
      ),
      extractMustContain: 'INC-928471',
      question: 'From the attached HTML only: what is the root cause ticket id? Reply with just the id.',
      answerMustContain: /INC-928471/i,
    },
    {
      kind: 'csv',
      name: 'sales.csv',
      mime: 'text/csv',
      body: Buffer.from('sku,units\nWIDGET-QZ77,1337\nOTHER,1\n'),
      extractMustContain: 'WIDGET-QZ77',
      question: 'From the attached CSV only: how many units did SKU WIDGET-QZ77 sell? Reply with just the number.',
      answerMustContain: /1337/,
    },
    {
      kind: 'json',
      name: 'cfg.json',
      mime: 'application/json',
      body: Buffer.from(JSON.stringify({ cluster: { secretName: 'vault/prod/ORION-KEY-88' } }, null, 2)),
      extractMustContain: 'ORION-KEY-88',
      question: 'From the attached JSON only: what is the cluster secretName? Reply with just the value.',
      answerMustContain: /ORION-KEY-88|vault\/prod\/ORION-KEY-88/i,
    },
    {
      kind: 'xml',
      name: 'feed.xml',
      mime: 'application/xml',
      body: Buffer.from('<cfg><releaseChannel>CANARY-MANGO-12</releaseChannel></cfg>'),
      extractMustContain: 'CANARY-MANGO-12',
      question: 'From the attached XML only: what is the releaseChannel? Reply with just the value.',
      answerMustContain: /CANARY-MANGO-12/i,
    },
    {
      kind: 'pdf',
      name: 'notice.pdf',
      mime: 'application/pdf',
      body: minimalPdf('Audit code GAMMA-PLUM-55'),
      extractMustContain: 'GAMMA-PLUM-55',
      question: 'From the attached PDF only: what is the audit code? Reply with just the code.',
      answerMustContain: /GAMMA-PLUM-55/i,
    },
    {
      kind: 'docx',
      name: 'brief.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      body: await minimalDocx('Vendor approval token is DOCX-TOKEN-9191.'),
      extractMustContain: 'DOCX-TOKEN-9191',
      question: 'From the attached Word document only: what is the vendor approval token? Reply with just the token.',
      answerMustContain: /DOCX-TOKEN-9191/i,
    },
    {
      kind: 'pptx',
      name: 'slides.pptx',
      mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      body: await minimalPptx('Launch window code PPTX-WINDOW-3030'),
      extractMustContain: 'PPTX-WINDOW-3030',
      question: 'From the attached PowerPoint only: what is the launch window code? Reply with just the code.',
      answerMustContain: /PPTX-WINDOW-3030/i,
    },
    {
      kind: 'xlsx',
      name: 'budget.xlsx',
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: await minimalXlsx('XLSX-PROJ-6060', '250000'),
      extractMustContain: 'XLSX-PROJ-6060',
      question:
        'From the attached spreadsheet only: what is the project_code? Reply with just the project code.',
      answerMustContain: /XLSX-PROJ-6060/i,
    },
  ];
}

function match(hay: string, needle: string | RegExp): boolean {
  return typeof needle === 'string' ? hay.includes(needle) : needle.test(hay);
}

async function pickModel(): Promise<string> {
  const r = await call('/v1/ai/models');
  const avail = (r.json.models || []).filter((m: any) => m.available);
  const hit = avail.find((m: any) => m.id === PREFER_MODEL) || avail.find((m: any) => m.provider !== 'ollama') || avail[0];
  if (!hit) throw new Error('no available model');
  return hit.id as string;
}

async function main() {
  console.log(`${C.b}Document functional I/O tests${C.x}  ${C.dim}${URL_BASE}${C.x}`);
  const model = await pickModel();
  console.log(`${C.dim}model=${model}${C.x}\n`);

  const cases = await buildCases();
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const c of cases) {
    const threadId = `functest-${c.kind}-${randomUUID().slice(0, 8)}`;
    const label = `${c.kind} (${c.name})`;
    try {
      // --- INPUT ---
      const up = await upload(threadId, c.name, c.mime, c.body);
      if (up.status !== 202 || !up.json.fileId) throw new Error(`upload ${up.status} ${JSON.stringify(up.json).slice(0, 120)}`);
      const fileId = up.json.fileId as string;
      const st = await waitReady(fileId);
      if (st.status !== 'ready') throw new Error(`not ready: ${st.status} ${st.error || ''}`);
      if (!(st.chunksIndexed > 0)) throw new Error(`0 chunks indexed (degraded=${st.degraded})`);

      const meta = await call(`/v1/files/${fileId}`);
      const preview = String(meta.json?.preview || '');
      if (!preview.includes(c.extractMustContain)) {
        throw new Error(`extract I→O failed: preview missing ${c.extractMustContain} (got ${JSON.stringify(preview).slice(0, 120)})`);
      }

      // --- OUTPUT (chat grounded on this file only) ---
      const out = await chat({
        model,
        threadId,
        fileIds: [fileId],
        question: c.question,
      });
      if (out.status !== 200) throw new Error(`chat status ${out.status}: ${out.text.slice(0, 160)}`);
      if (!out.events.includes('file_context')) {
        throw new Error(`no file_context SSE (events=${out.events.join(',') || 'none'}) — RAG did not inject`);
      }
      if (out.citations < 1) throw new Error('file_context had 0 citations');
      if (!match(out.text, c.answerMustContain)) {
        throw new Error(
          `answer I→O failed: expected ${c.answerMustContain} in model reply.\n` +
            `  got: ${JSON.stringify(out.text).slice(0, 280)}`,
        );
      }

      console.log(`  ${C.g}✓${C.x} ${label}  ${C.dim}extract+answer contain expected fact${C.x}`);
      passed++;
      await call(`/v1/files?threadId=${threadId}`, { method: 'DELETE' });
    } catch (e) {
      failed++;
      const msg = (e as Error).message || String(e);
      failures.push(`${label}: ${msg}`);
      console.log(`  ${C.r}✗${C.x} ${label}  ${C.dim}— ${msg.split('\n')[0]}${C.x}`);
      await call(`/v1/files?threadId=${threadId}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  console.log(`\n${C.b}Summary:${C.x} ${C.g}${passed} passed${C.x}, ${failed ? C.r : C.dim}${failed} failed${C.x}  (${cases.length} kinds)`);
  if (failures.length) {
    console.log(`${C.r}Failed:${C.x}`);
    for (const f of failures) console.log(`  - ${f}`);
    exit(1);
  }
  console.log(`${C.g}All functional document I/O checks passed.${C.x}`);
}

main().catch((e) => {
  console.error(e);
  exit(1);
});
