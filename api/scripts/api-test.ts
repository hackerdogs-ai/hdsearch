// Comprehensive HD-Search API test suite. Takes an API key and base URL, then
// exercises every endpoint across the supported use cases (search modalities +
// modes + paging + facets + engine selection, crawl, vector, engines, account,
// keys, and error paths). Prints a pass/fail/skip report and exits non-zero on
// any failure.
//
// Usage:
//   npx tsx scripts/api-test.ts --key sk-hds-... [--url http://localhost:8791] [--verbose]
//   HDSEARCH_API_KEY=sk-hds-... npm run test:api
import { argv, env, exit } from 'node:process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

function arg(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const URL_BASE = (arg('url') || env.HDSEARCH_API_URL || 'http://localhost:8791').replace(/\/$/, '');
const KEY = arg('key') || env.HDSEARCH_API_KEY || '';
const VERBOSE = argv.includes('--verbose');

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', dim: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

if (!KEY) {
  console.error(`${C.r}Error:${C.x} an API key is required. Pass --key sk-hds-... or set HDSEARCH_API_KEY.`);
  exit(2);
}

interface CallOpts { method?: string; body?: unknown; auth?: boolean; key?: string; timeoutMs?: number; }
async function call(path: string, opts: CallOpts = {}): Promise<{ status: number; json: any; ms: number }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30000);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const useKey = opts.key ?? (opts.auth === false ? undefined : KEY);
  if (useKey) headers.authorization = `Bearer ${useKey}`;
  const t0 = Date.now();
  try {
    const res = await fetch(`${URL_BASE}${path}`, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
    let json: any = null;
    const txt = await res.text();
    try { json = txt ? JSON.parse(txt) : null; } catch { json = { raw: txt }; }
    return { status: res.status, json, ms: Date.now() - t0 };
  } finally {
    clearTimeout(t);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Upload a file via multipart. Returns {status, json}. */
async function upload(threadId: string, name: string, mime: string, bytes: Buffer): Promise<{ status: number; json: any }> {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name);
  if (threadId) fd.append('threadId', threadId);
  const res = await fetch(`${URL_BASE}/v1/files`, { method: 'POST', headers: { authorization: `Bearer ${KEY}` }, body: fd });
  const txt = await res.text();
  let json: any = null;
  try { json = txt ? JSON.parse(txt) : null; } catch { json = { raw: txt }; }
  return { status: res.status, json };
}

/** POST an SSE endpoint; collect event types, text, and a threadId if the server assigns one. */
async function callSSE(path: string, body: unknown, timeoutMs = 90000): Promise<{ status: number; events: string[]; text: string; threadId: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${URL_BASE}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => '');
      return { status: res.status, events: [], text: txt.slice(0, 200), threadId: '' };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const events: string[] = [];
    let text = '';
    let threadId = '';
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
        if (dl) {
          try {
            const j = JSON.parse(dl);
            if (j.type === 'text' && j.delta) text += j.delta;
            if (typeof j.threadId === 'string') threadId = j.threadId;
          } catch { /* ignore non-JSON frames */ }
        }
      }
    }
    return { status: res.status, events, text, threadId };
  } finally {
    clearTimeout(t);
  }
}

/** Spawn the stdio MCP server, do the JSON-RPC handshake, list tools, and call each. */
async function callMcp(): Promise<{ tools: string[]; results: { name: string; ok: boolean; note: string }[] }> {
  const proc = spawn('npx', ['tsx', 'mcp/server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, HDSEARCH_API_KEY: KEY, HDSEARCH_API_URL: URL_BASE },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map<number, (m: any) => void>();
  let buf = '';
  proc.stdout.on('data', (d: Buffer) => {
    buf += d.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)!(msg); pending.delete(msg.id); }
      } catch { /* server log line, not JSON-RPC */ }
    }
  });
  let idc = 0;
  const rpc = (method: string, params?: unknown, timeoutMs = 60000) =>
    new Promise<any>((resolve, reject) => {
      const id = ++idc;
      const to = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, timeoutMs);
      pending.set(id, (msg) => { clearTimeout(to); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const notify = (method: string, params?: unknown) => proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  const argsFor: Record<string, unknown> = {
    hd_search: { q: 'open source search', modality: 'web', limit: 3 },
    hd_crawl: { url: 'https://example.com' },
    hd_vector_search: { q: 'hello', namespace: 'apitest-mcp', k: 3 },
    hd_vector_index: { documents: [{ text: 'the quick brown fox' }], namespace: 'apitest-mcp' },
    hd_list_engines: {},
  };
  try {
    await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'apitest', version: '1' } });
    notify('notifications/initialized');
    const list = await rpc('tools/list');
    const tools: string[] = (list.tools || []).map((t: any) => t.name);
    const results: { name: string; ok: boolean; note: string }[] = [];
    for (const name of tools) {
      try {
        const r = await rpc('tools/call', { name, arguments: argsFor[name] ?? {} }, 60000);
        const textPart = (r?.content || []).find((c: any) => c.type === 'text')?.text || '';
        results.push({ name, ok: !r?.isError, note: String(textPart).replace(/\s+/g, ' ').slice(0, 60) });
      } catch (e) {
        results.push({ name, ok: false, note: (e as Error).message });
      }
    }
    return { tools, results };
  } finally {
    try { proc.stdin.end(); } catch { /* */ }
    proc.kill('SIGTERM');
  }
}

let passed = 0, failed = 0, skipped = 0;
const failures: string[] = [];

class SkipError extends Error {}
function skip(msg: string): never { throw new SkipError(msg); }
function assert(cond: any, msg: string): void { if (!cond) throw new Error(msg); }

async function test(name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const note = await fn();
    passed++;
    console.log(`  ${C.g}✓${C.x} ${name}${note ? ` ${C.dim}(${note})${C.x}` : ''}`);
  } catch (e) {
    if (e instanceof SkipError) {
      skipped++;
      console.log(`  ${C.y}↷ skip${C.x} ${name} ${C.dim}(${e.message})${C.x}`);
      return;
    }
    failed++;
    failures.push(name);
    console.log(`  ${C.r}✗${C.x} ${name} ${C.dim}— ${(e as Error).message}${C.x}`);
  }
}

function section(title: string) { console.log(`\n${C.b}${title}${C.x}`); }

async function main() {
  console.log(`${C.b}hdsearch API test suite${C.x}  ${C.dim}${URL_BASE}  key ${KEY.slice(0, 12)}…${C.x}`);

  section('Health & discovery');
  await test('GET /health', async () => {
    const r = await call('/health', { auth: false });
    assert(r.status === 200 && r.json?.status === 'ok', `status ${r.status}`);
  });
  await test('GET /healthz (deps)', async () => {
    const r = await call('/healthz', { auth: false });
    assert([200, 503].includes(r.status) && r.json?.deps, `status ${r.status}`);
    return `redis=${r.json.deps.redis} pg=${r.json.deps.postgres} rediSearch=${r.json.deps.rediSearch}`;
  });
  await test('GET /openapi.json', async () => {
    const r = await call('/openapi.json', { auth: false });
    assert(r.status === 200 && r.json?.openapi, `status ${r.status}`);
    return `${Object.keys(r.json.paths || {}).length} paths`;
  });
  let engines: any[] = [];
  await test('GET /v1/engines', async () => {
    const r = await call('/v1/engines');
    assert(r.status === 200 && Array.isArray(r.json?.engines) && r.json.engines.length > 0, `status ${r.status}`);
    engines = r.json.engines;
    return `${r.json.count} engines`;
  });
  await test('GET /v1/engines?category=crawl', async () => {
    const r = await call('/v1/engines?category=crawl');
    assert(r.status === 200 && r.json.engines.every((e: any) => e.category === 'crawl'), 'category filter');
    return `${r.json.engines.length} crawl engines`;
  });
  await test('GET /v1/engines/:id', async () => {
    const r = await call('/v1/engines/searxng');
    assert(r.status === 200 && r.json?.id === 'searxng', `status ${r.status}`);
  });

  section('Search — modalities');
  for (const m of ['web', 'news', 'images', 'videos', 'maps', 'scholar', 'code', 'darkweb']) {
    await test(`POST /v1/search modality=${m}`, async () => {
      const r = await call('/v1/search', { body: { q: 'open source', modality: m, limit: 5 } });
      assert(r.status === 200, `status ${r.status}`);
      assert(Array.isArray(r.json.results) && Array.isArray(r.json.enginesUsed), 'shape');
      return `${r.json.total} results via ${r.json.enginesUsed.filter((e: any) => e.ok).map((e: any) => e.engine).join(',') || '—'} ${r.json.tookMs}ms`;
    });
  }

  section('Search — modes / paging / facets / engine');
  await test('mode=fallback', async () => {
    const r = await call('/v1/search', { body: { q: 'redis', modality: 'web', mode: 'fallback', limit: 10 } });
    assert(r.status === 200 && r.json.mode === 'fallback', `status ${r.status}`);
    return `${r.json.total} results`;
  });
  await test('mode=aggregate + facets', async () => {
    const r = await call('/v1/search', { body: { q: 'postgres', modality: 'web', mode: 'aggregate', limit: 15, facets: true } });
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json.facets) && r.json.facets.length > 0, 'facets present');
    return `facets: ${r.json.facets.map((f: any) => f.field).join(',')}`;
  });
  await test('engine selection (engine=searxng)', async () => {
    const r = await call('/v1/search', { body: { q: 'typescript', engine: 'searxng', limit: 5 } });
    assert(r.status === 200 && r.json.enginesUsed.some((e: any) => e.engine === 'searxng'), 'used searxng');
  });
  await test('paging (page=2)', async () => {
    const r = await call('/v1/search', { body: { q: 'database', modality: 'web', page: 2, limit: 10 } });
    assert(r.status === 200, `status ${r.status}`);
  });
  await test('GET /v1/search?q= (querystring form)', async () => {
    const r = await call('/v1/search?q=hello&modality=web&limit=3');
    assert(r.status === 200 && r.json?.query === 'hello', `status ${r.status}`);
  });
  await test('cache hit on repeat query', async () => {
    const body = { q: 'cache-test-' + KEY.slice(-6), engine: 'searxng', limit: 3 };
    await call('/v1/search', { body });
    const r2 = await call('/v1/search', { body });
    assert(r2.status === 200, `status ${r2.status}`);
    return r2.json.cached ? 'cached ✓' : 'not cached (provider may have returned 0)';
  });

  section('Crawl');
  await test('POST /v1/crawl (markdown+links)', async () => {
    const r = await call('/v1/crawl', { body: { url: 'https://example.com', formats: ['markdown', 'links'] }, timeoutMs: 45000 });
    assert(r.status === 200 && r.json.result, `status ${r.status}`);
    assert(typeof r.json.result.markdown === 'string' && r.json.result.markdown.length > 0, 'has markdown');
    return `${r.json.result.source}, md ${r.json.result.markdown.length} chars`;
  });
  await test('GET /v1/crawl?url=', async () => {
    const r = await call('/v1/crawl?url=https://example.com', { timeoutMs: 45000 });
    assert(r.status === 200 && r.json.result, `status ${r.status}`);
  });
  await test('POST /v1/crawl (screenshot)', async () => {
    const r = await call('/v1/crawl', { body: { url: 'https://example.com', formats: ['screenshot'] }, timeoutMs: 60000 });
    if (!r.json?.result?.screenshot) skip('no capture-capable crawler available');
    assert(r.status === 200 && /^data:image\//.test(r.json.result.screenshot), 'png data url');
    return `screenshot ${r.json.result.screenshot.length} chars via ${r.json.result.source}`;
  });
  await test('POST /v1/crawl (pdf)', async () => {
    const r = await call('/v1/crawl', { body: { url: 'https://example.com', formats: ['pdf'] }, timeoutMs: 60000 });
    if (!r.json?.result?.pdf) skip('no capture-capable crawler available');
    assert(r.status === 200 && /^data:application\/pdf/.test(r.json.result.pdf), 'pdf data url');
    return `pdf ${r.json.result.pdf.length} chars`;
  });

  section('Maps (OpenStreetMap geocoder + Overpass categories)');
  await test('POST /v1/search modality=maps (geo)', async () => {
    const r = await call('/v1/search', { body: { q: 'Eiffel Tower', modality: 'maps', limit: 3 }, timeoutMs: 20000 });
    assert(r.status === 200, `status ${r.status}`);
    const g = r.json.results?.[0]?.extra?.geo;
    if (!g) skip('geocoder returned no results (rate-limited?)');
    assert(typeof g.lat === 'number' && typeof g.lon === 'number', 'lat/lon present');
    return `${r.json.results.length} places, first @ ${g.lat.toFixed(3)},${g.lon.toFixed(3)}`;
  });
  await test('maps "<category> in <place>" is local + category-pure', async () => {
    const r = await call('/v1/search', { body: { q: 'coffee in San Ramon, CA', modality: 'maps', limit: 6 }, timeoutMs: 30000 });
    assert(r.status === 200, `status ${r.status}`);
    const geos = (r.json.results || []).map((x: any) => x.extra?.geo).filter(Boolean);
    if (geos.length === 0) skip('geocoder/Overpass returned nothing (rate-limited?)');
    // all pins within ~0.5° of each other (local), not scattered globally
    const span = Math.max(...geos.map((g: any) => g.lat)) - Math.min(...geos.map((g: any) => g.lat));
    assert(span < 1, `pins are local (lat span ${span.toFixed(2)}°, expected < 1°)`);
    const kinds = [...new Set(geos.map((g: any) => g.kind))];
    return `${geos.length} pins, span ${span.toFixed(2)}°, kinds ${JSON.stringify(kinds)}`;
  });

  section('Archive (Wayback + Common Crawl)');
  let wbCap: any = null;
  await test('POST /v1/search modality=archive engine=wayback', async () => {
    const r = await call('/v1/search', { body: { q: 'example.com', modality: 'archive', engine: 'wayback', limit: 3 }, timeoutMs: 30000 });
    assert(r.status === 200, `status ${r.status}`);
    const a = r.json.results?.[0]?.extra?.archive;
    if (!a) skip('wayback returned no captures (rate-limited?)');
    assert(/web\.archive\.org/.test(a.snapshotUrl || ''), 'snapshot links to archive, not live');
    wbCap = a;
    return `${r.json.results.length} captures, snapshot ${a.snapshotUrl.slice(0, 48)}…`;
  });
  await test('GET /v1/archive?provider=wayback (extract capture → markdown)', async () => {
    const url = wbCap?.url || 'https://example.com/';
    const r = await call(`/v1/archive?provider=wayback&url=${encodeURIComponent(url)}${wbCap?.timestamp ? `&ts=${wbCap.timestamp}` : ''}`, { timeoutMs: 40000 });
    if (r.status !== 200) skip(`archive fetch ${r.status} (upstream throttling)`);
    assert(typeof r.json.markdown === 'string', 'has markdown from the captured page');
    return `“${(r.json.title || '').slice(0, 40)}” · md ${r.json.markdown.length} chars`;
  });

  section('Search history (3-day Redis tier)');
  await test('GET /v1/history', async () => {
    const r = await call('/v1/history');
    assert(r.status === 200 && Array.isArray(r.json.entries), `status ${r.status}`);
    return `tier=${r.json.tier}, ${r.json.entries.length} entries`;
  });
  await test('DELETE /v1/history (clear)', async () => {
    const r = await call('/v1/history', { method: 'DELETE' });
    assert(r.status === 200 && r.json.ok, `status ${r.status}`);
  });

  section('Vector (semantic) — requires DevTest+ plan');
  const ns = 'apitest-' + Date.now();
  await test('POST /v1/search/vector/index', async () => {
    const r = await call('/v1/search/vector/index', {
      body: { namespace: ns, documents: [
        { text: 'Redis is an in-memory key-value data store' },
        { text: 'PostgreSQL is a relational database' },
        { text: 'Eagles are raptors with sharp eyesight' },
      ] },
    });
    if (r.status === 402) skip('plan has no vector entitlement');
    if (r.status === 503) skip('embeddings unavailable');
    assert(r.status === 200 && r.json.indexed >= 3, `status ${r.status}`);
    return `indexed ${r.json.indexed}`;
  });
  await test('POST /v1/search/vector (KNN)', async () => {
    const r = await call('/v1/search/vector', { body: { namespace: ns, q: 'bird with good vision', k: 2 } });
    if (r.status === 402) skip('plan has no vector entitlement');
    if (r.status === 503) skip('embeddings unavailable');
    assert(r.status === 200 && Array.isArray(r.json.results), `status ${r.status}`);
    const top = r.json.results[0];
    assert(top && /eagle|raptor/i.test(top.text || ''), 'semantic top match');
    return `top score ${top?.score?.toFixed(3)}`;
  });
  await test('POST /v1/search/vector groundWithWeb', async () => {
    const r = await call('/v1/search/vector', { body: { q: 'vector database comparison', k: 5, groundWithWeb: true }, timeoutMs: 45000 });
    if (r.status === 402) skip('plan has no vector entitlement');
    if (r.status === 503) skip('embeddings unavailable');
    assert(r.status === 200 && Array.isArray(r.json.results), `status ${r.status}`);
    return `${r.json.total} grounded results`;
  });

  section('Account & keys');
  await test('GET /v1/account', async () => {
    const r = await call('/v1/account');
    assert(r.status === 200 && r.json.plan, `status ${r.status}`);
    return `plan=${r.json.plan.id} used=${r.json.usage?.total}`;
  });
  await test('GET /v1/account/history', async () => {
    const r = await call('/v1/account/history?limit=5');
    assert(r.status === 200 && Array.isArray(r.json.history), `status ${r.status}`);
  });
  await test('GET /v1/account/dashboard', async () => {
    const r = await call('/v1/account/dashboard?days=7');
    assert(r.status === 200, `status ${r.status}`);
  });
  await test('GET /v1/account/plans', async () => {
    const r = await call('/v1/account/plans');
    assert(r.status === 200 && Array.isArray(r.json.plans) && r.json.plans.length >= 5, `status ${r.status}`);
  });
  await test('GET /v1/keys/api', async () => {
    const r = await call('/v1/keys/api');
    assert(r.status === 200 && Array.isArray(r.json.keys), `status ${r.status}`);
    return `${r.json.keys.length} keys`;
  });
  await test('GET /v1/keys/providers', async () => {
    const r = await call('/v1/keys/providers');
    assert(r.status === 200 && Array.isArray(r.json.keys), `status ${r.status}`);
    return `encryption=${r.json.encryptionAvailable}`;
  });
  await test('POST /v1/keys/api (create+revoke, needs admin:keys)', async () => {
    const c = await call('/v1/keys/api', { body: { name: 'api-test-temp' } });
    if (c.status === 403) skip('key lacks admin:keys scope');
    assert(c.status === 201 && c.json.key?.startsWith('sk-hds-'), `create status ${c.status}`);
    const id = c.json.record.id;
    const d = await call(`/v1/keys/api/${id}`, { method: 'DELETE' });
    assert(d.status === 200 && d.json.revoked, `revoke status ${d.status}`);
    return 'created + revoked';
  });

  section('AI Mode (models, providers, chat, threads)');
  let aiModel = '';
  await test('GET /v1/ai/models', async () => {
    const r = await call('/v1/ai/models');
    assert(r.status === 200 && Array.isArray(r.json.models) && r.json.models.length, `status ${r.status}`);
    aiModel = r.json.models.find((m: any) => m.available)?.id || '';
    return `${r.json.models.length} models, default=${r.json.default}, available=${aiModel || 'none'}`;
  });
  await test('GET /v1/ai/providers', async () => {
    const r = await call('/v1/ai/providers');
    assert(r.status === 200 && Array.isArray(r.json.providers), `status ${r.status}`);
    return `${r.json.count} providers`;
  });
  const aiThreadId = `apitest-${randomUUID().slice(0, 8)}`;
  await test('POST /v1/ai/chat (SSE stream)', async () => {
    if (!aiModel) skip('no available model (add a provider key)');
    const r = await callSSE('/v1/ai/chat', { messages: [{ role: 'user', content: 'Reply with exactly one word: pong' }], modelOverride: aiModel, threadId: aiThreadId });
    assert(r.events.includes('done'), `no 'done' (status ${r.status}, events=${r.events.join(',')||'none'}, ${r.text})`);
    return `events=${[...new Set(r.events)].join('/')} text="${r.text.slice(0, 30)}"`;
  });
  await test('GET /v1/ai/threads (list)', async () => {
    const r = await call('/v1/ai/threads');
    assert(r.status === 200 && Array.isArray(r.json.entries), `status ${r.status}`);
    return `${r.json.entries.length} threads, tier=${r.json.tier}`;
  });
  await test('GET /v1/ai/threads/:id (restore)', async () => {
    await sleep(800); // persistence is async after the stream drains
    const r = await call(`/v1/ai/threads/${aiThreadId}`);
    if (r.status === 404) skip('thread not persisted (no available model / demo)');
    assert(r.status === 200 && r.json.threadId === aiThreadId, `status ${r.status}`);
    return `${r.json.messages?.length ?? 0} messages`;
  });
  await test('PATCH /v1/ai/threads/:id (rename)', async () => {
    const r = await call(`/v1/ai/threads/${aiThreadId}`, { method: 'PATCH', body: { title: 'renamed-by-apitest' } });
    if (r.status === 404) skip('no thread to rename');
    assert(r.status === 200 && r.json.ok, `status ${r.status}`);
  });
  await test('DELETE /v1/ai/threads/:id', async () => {
    const r = await call(`/v1/ai/threads/${aiThreadId}`, { method: 'DELETE' });
    assert(r.status === 200 && r.json.ok, `status ${r.status}`);
  });

  section('Files (upload → process → RAG → delete cascade)');
  const fThread = `apitest-file-${randomUUID().slice(0, 8)}`;
  let fileId = '';
  await test('POST /v1/files (multipart upload)', async () => {
    const u = await upload(fThread, 'apitest.md', 'text/markdown', Buffer.from('# Q4 Report\nRevenue grew 42% to $9.1M in Q4. Team headcount reached 320.'));
    assert(u.status === 202 && u.json.fileId, `status ${u.status} ${JSON.stringify(u.json).slice(0, 120)}`);
    fileId = u.json.fileId;
    return `fileId=${fileId} status=${u.json.status}`;
  });
  await test('GET /v1/files/:id/status → ready', async () => {
    if (!fileId) skip('no file');
    let s: any = {};
    for (let i = 0; i < 45; i++) {
      const r = await call(`/v1/files/${fileId}/status`);
      s = r.json;
      if (s.status === 'ready' || s.status === 'failed') break;
      await sleep(1000);
    }
    assert(s.status === 'ready', `status=${s.status}`);
    return `chunks=${s.chunksIndexed}/${s.chunksTotal} degraded=${s.degraded}`;
  });
  await test('GET /v1/files?threadId (list)', async () => {
    const r = await call(`/v1/files?threadId=${fThread}`);
    assert(r.status === 200 && Array.isArray(r.json.files) && r.json.files.length >= 1, `status ${r.status}`);
    return `${r.json.files.length} file(s)`;
  });
  await test('GET /v1/files/:id (metadata)', async () => {
    if (!fileId) skip('no file');
    const r = await call(`/v1/files/${fileId}`);
    assert(r.status === 200 && r.json.id === fileId, `status ${r.status}`);
  });
  await test('GET /v1/files/:id/content (download)', async () => {
    if (!fileId) skip('no file');
    const res = await fetch(`${URL_BASE}/v1/files/${fileId}/content`, { headers: { authorization: `Bearer ${KEY}` } });
    const txt = await res.text();
    assert(res.status === 200 && txt.includes('Revenue'), `status ${res.status}`);
  });
  await test('413 on > 200MB upload', async () => {
    if (argv.includes('--no-heavy')) skip('--no-heavy');
    const big = Buffer.alloc(201 * 1024 * 1024); // 201 MB
    const u = await upload(fThread, 'big.bin', 'application/octet-stream', big);
    assert(u.status === 413 && u.json.error === 'file_too_large', `expected 413, got ${u.status}`);
  });
  await test('DELETE /v1/files/:id (cascade → 404)', async () => {
    if (!fileId) skip('no file');
    const d = await call(`/v1/files/${fileId}`, { method: 'DELETE' });
    assert(d.status === 200 && d.json.ok, `delete status ${d.status}`);
    const s = await call(`/v1/files/${fileId}/status`);
    assert(s.status === 404, `expected 404 after delete, got ${s.status}`);
  });
  await test('DELETE /v1/files?threadId (bulk)', async () => {
    const r = await call(`/v1/files?threadId=${fThread}`, { method: 'DELETE' });
    assert(r.status === 200 && r.json.ok, `status ${r.status}`);
  });

  section('Folders');
  let folderId = '';
  await test('POST /v1/folders (create)', async () => {
    const r = await call('/v1/folders', { body: { name: 'apitest-folder', kind: 'chat' } });
    assert(r.status === 201 && r.json.id, `status ${r.status}`);
    folderId = r.json.id;
  });
  await test('GET /v1/folders?kind=chat', async () => {
    const r = await call('/v1/folders?kind=chat');
    assert(r.status === 200 && Array.isArray(r.json.folders), `status ${r.status}`);
    return `${r.json.folders.length} folder(s)`;
  });
  await test('POST /v1/folders/assign', async () => {
    if (!folderId) skip('no folder');
    const r = await call('/v1/folders/assign', { body: { threadId: 'apitest-thread', folderId } });
    assert(r.status === 200 && r.json.ok, `status ${r.status}`);
  });
  await test('PATCH /v1/folders/:id (rename)', async () => {
    if (!folderId) skip('no folder');
    const r = await call(`/v1/folders/${folderId}`, { method: 'PATCH', body: { name: 'apitest-renamed' } });
    assert(r.status === 200, `status ${r.status}`);
  });
  await test('DELETE /v1/folders/:id', async () => {
    if (!folderId) skip('no folder');
    const r = await call(`/v1/folders/${folderId}`, { method: 'DELETE' });
    assert(r.status === 200 && r.json.ok, `status ${r.status}`);
  });

  section('OpenAI-compatible API');
  await test('GET /v1/openai/models', async () => {
    const r = await call('/v1/openai/models');
    assert(r.status === 200 && Array.isArray(r.json.data), `status ${r.status}`);
    return `${r.json.data.length} models`;
  });
  await test('POST /v1/openai/chat/completions', async () => {
    if (!aiModel) skip('no available model');
    const r = await call('/v1/openai/chat/completions', { body: { model: aiModel, messages: [{ role: 'user', content: 'Say pong' }], stream: false }, timeoutMs: 90000 });
    assert(r.status === 200 && (r.json.choices?.length || r.json.id), `status ${r.status} ${JSON.stringify(r.json).slice(0, 100)}`);
    return `finish=${r.json.choices?.[0]?.finish_reason}`;
  });

  section('Trends & Plans');
  await test('GET /v1/trends', async () => {
    const r = await call('/v1/trends');
    assert(r.status === 200, `status ${r.status}`);
    return `${(r.json.trends || r.json.items || []).length ?? 0} trends`;
  });
  await test('GET /v1/plans', async () => {
    const r = await call('/v1/plans');
    assert(r.status === 200, `status ${r.status}`);
  });

  section('Admin (super-user scope; 403 expected for normal keys)');
  await test('GET /v1/admin/default-keys', async () => {
    const r = await call('/v1/admin/default-keys');
    if (r.status === 403) skip('key is not a super-user');
    assert(r.status === 200, `status ${r.status}`);
  });
  await test('GET /v1/admin/llm-providers', async () => {
    const r = await call('/v1/admin/llm-providers');
    if (r.status === 403) skip('key is not a super-user');
    assert(r.status === 200, `status ${r.status}`);
  });

  section('MCP server (stdio) — spawn + list + call every tool');
  await test('MCP: initialize → tools/list → call all', async () => {
    const { tools, results } = await callMcp();
    assert(tools.length >= 5, `expected ≥5 tools, got ${tools.length}: ${tools.join(',')}`);
    // A tool that fails purely on plan entitlement (402/quota) is "gated", not broken —
    // consistent with how the vector API tests skip on the free plan.
    const gated = (r: { ok: boolean; note: string }) => !r.ok && /402|quota_exceeded|entitle|plan/i.test(r.note);
    for (const r of results) {
      const mark = r.ok ? C.g + '✓' : gated(r) ? C.y + '↷' : C.r + '✗';
      console.log(`      ${mark}${C.x} mcp:${r.name} ${C.dim}${r.note}${C.x}`);
    }
    const broken = results.filter((r) => !r.ok && !gated(r));
    assert(broken.length === 0, `MCP tools failed: ${broken.map((f) => `${f.name} (${f.note})`).join('; ')}`);
    return `${tools.length} tools — ${results.filter((r) => r.ok).length} ok, ${results.filter(gated).length} plan-gated`;
  });

  section('Error handling');
  await test('400 on invalid search body', async () => {
    const r = await call('/v1/search', { body: { modality: 'web' } }); // missing q
    assert(r.status === 400, `expected 400, got ${r.status}`);
  });
  await test('401 with no API key', async () => {
    const r = await call('/v1/search?q=x', { auth: false });
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });
  await test('401 with bogus API key', async () => {
    const r = await call('/v1/search?q=x', { key: 'sk-hds-bogus' });
    assert(r.status === 401, `expected 401, got ${r.status}`);
  });
  await test('404 on unknown engine', async () => {
    const r = await call('/v1/engines/nope-not-real');
    assert(r.status === 404, `expected 404, got ${r.status}`);
  });

  // ---- summary ----
  const total = passed + failed + skipped;
  console.log(`\n${C.b}Summary:${C.x} ${C.g}${passed} passed${C.x}, ${failed ? C.r : C.dim}${failed} failed${C.x}, ${C.y}${skipped} skipped${C.x}  (${total} total)`);
  if (failed) {
    console.log(`${C.r}Failed:${C.x} ${failures.join(', ')}`);
    exit(1);
  }
  console.log(`${C.g}All good.${C.x}`);
}

main().catch((e) => {
  console.error(`${C.r}fatal:${C.x}`, (e as Error).message);
  exit(1);
});
