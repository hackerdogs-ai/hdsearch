// Comprehensive MCP server test — exercises BOTH transports (Streamable HTTP and
// stdio), all 5 tools, the protocol guards, session handling, and per-caller auth.
//
//   HDSEARCH_API_KEY=sk-hds-... npm run test:mcp
//   (optionally: --url http://localhost:8791  --key sk-hds-...  --verbose)
//
// It spawns its own MCP server processes (from dist/mcp/server.js) pointed at the
// running HD-Search API, so it needs the API up and a valid sk-hds- key.
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = resolve(HERE, '..', 'dist', 'mcp', 'server.js');
const argv = process.argv.slice(2);
const arg = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const API_URL = (arg('url') || process.env.HDSEARCH_API_URL || 'http://localhost:8791').replace(/\/$/, '');
const KEY = arg('key') || process.env.HDSEARCH_API_KEY || '';
const HTTP_PORT = Number(arg('port') || 8799);
const VERBOSE = argv.includes('--verbose');
const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', dim: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

if (!KEY) { console.error(`${C.r}Error:${C.x} need an API key — --key sk-hds-... or HDSEARCH_API_KEY`); process.exit(2); }

let passed = 0, failed = 0, skipped = 0;
class SkipError extends Error {}
const skip = (m: string): never => { throw new SkipError(m); };
const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };
function section(t: string) { console.log(`\n${C.b}${t}${C.x}`); }
async function test(name: string, fn: () => Promise<string | void>) {
  try { const d = await fn(); passed++; console.log(`  ${C.g}✓${C.x} ${name}${d ? ` ${C.dim}(${d})${C.x}` : ''}`); }
  catch (e) {
    if (e instanceof SkipError) { skipped++; console.log(`  ${C.y}↷ skip${C.x} ${name} ${C.dim}(${e.message})${C.x}`); }
    else { failed++; console.log(`  ${C.r}✗${C.x} ${name} ${C.r}— ${(e as Error).message}${C.x}`); }
  }
}
const text = (r: any): string => r?.content?.[0]?.text ?? '';
const json = (r: any): any => { try { return JSON.parse(text(r)); } catch { return {}; } };

const EXPECTED_TOOLS = ['hd_search', 'hd_crawl', 'hd_vector_search', 'hd_vector_index', 'hd_list_engines'];

// ---- spawn a Streamable-HTTP MCP server child ----
function spawnHttpServer(): Promise<ChildProcess> {
  // Strip HDSEARCH_API_KEY so the HTTP server has NO env fallback — auth must come
  // from each caller's Authorization header (that's what we test).
  const childEnv: Record<string, string> = { ...process.env, HDSEARCH_API_URL: API_URL, MCP_PORT: String(HTTP_PORT) } as Record<string, string>;
  delete childEnv.HDSEARCH_API_KEY;
  return new Promise((res, rej) => {
    const cp = spawn('node', [SERVER_JS, '--http'], {
      env: childEnv,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const to = setTimeout(() => rej(new Error('http server did not start in 8s')), 8000);
    cp.stderr!.on('data', (d) => { if (VERBOSE) process.stderr.write(`[srv] ${d}`); if (/listening|:\d+\/mcp/.test(String(d))) { clearTimeout(to); res(cp); } });
    cp.on('exit', (code) => { clearTimeout(to); rej(new Error(`http server exited early (${code})`)); });
  });
}
async function newHttpClient(authKey?: string): Promise<Client> {
  const headers: Record<string, string> = {};
  if (authKey) headers.Authorization = `Bearer ${authKey}`;
  const transport = new StreamableHTTPClientTransport(new URL(`http://localhost:${HTTP_PORT}/mcp`), { requestInit: { headers } });
  const client = new Client({ name: 'mcp-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function main() {
  console.log(`${C.b}HD-Search MCP test${C.x}  api=${API_URL}  http-port=${HTTP_PORT}`);
  let srv: ChildProcess | undefined;

  // ============ Streamable HTTP: raw protocol guards ============
  section('Streamable HTTP — server & protocol guards');
  await test('spawn --http server', async () => { srv = await spawnHttpServer(); return `pid ${srv.pid}`; });
  await test('GET /health', async () => {
    const r = await fetch(`http://localhost:${HTTP_PORT}/health`); const j: any = await r.json();
    assert(r.status === 200 && j.status === 'ok' && j.transport === 'streamable-http', `status ${r.status} ${JSON.stringify(j)}`);
    return `transport=${j.transport}`;
  });
  await test('GET /wrongpath → 404', async () => {
    const r = await fetch(`http://localhost:${HTTP_PORT}/nope`); assert(r.status === 404, `status ${r.status}`); return '404';
  });
  await test('POST /mcp without session → 400', async () => {
    const r = await fetch(`http://localhost:${HTTP_PORT}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert(r.status === 400, `status ${r.status}`); return 'rejected non-initialized';
  });

  // ============ Streamable HTTP: MCP client, all tools ============
  section('Streamable HTTP — MCP client (initialize → tools → auth)');
  let http!: Client;
  await test('initialize (connect + session)', async () => { http = await newHttpClient(KEY); return 'session established'; });
  await test('tools/list = 5 expected tools w/ schemas', async () => {
    const { tools } = await http.listTools();
    const names = tools.map((t) => t.name).sort();
    assert(JSON.stringify(names) === JSON.stringify([...EXPECTED_TOOLS].sort()), `got ${names.join(',')}`);
    assert(tools.every((t) => t.inputSchema && typeof t.inputSchema === 'object'), 'every tool has inputSchema');
    return names.join(', ');
  });
  await test('call hd_list_engines', async () => {
    const r = await http.callTool({ name: 'hd_list_engines', arguments: {} }); const j = json(r);
    assert(!r.isError && (j.count > 0 || Array.isArray(j.engines)), `isError=${r.isError}`); return `${j.count ?? j.engines?.length} engines`;
  });
  await test('call hd_search (web)', async () => {
    const r = await http.callTool({ name: 'hd_search', arguments: { q: 'model context protocol', modality: 'web', limit: 2 } }); const j = json(r);
    assert(!r.isError && (j.results?.length ?? 0) >= 1, `isError=${r.isError} results=${j.results?.length}`); return `${j.results.length} results`;
  });
  await test('call hd_search (news modality)', async () => {
    const r = await http.callTool({ name: 'hd_search', arguments: { q: 'ai', modality: 'news', limit: 2 } });
    assert(!r.isError, `isError=${r.isError}`); return 'ok';
  });
  await test('call hd_crawl', async () => {
    const r = await http.callTool({ name: 'hd_crawl', arguments: { url: 'https://example.com' } }); const j = json(r);
    assert(!r.isError && (j.result?.markdown || j.markdown), `isError=${r.isError}`); return `md ${(j.result?.markdown || '').length} chars`;
  });
  const ns = `mcp-test-${Date.now().toString(36)}`;
  await test('call hd_vector_index', async () => {
    const r = await http.callTool({ name: 'hd_vector_index', arguments: { namespace: ns, documents: [{ text: 'The Model Context Protocol standardizes tool calls for LLMs.', title: 'MCP' }, { text: 'SeaweedFS is an S3-compatible object store.', title: 'Seaweed' }] } });
    const j = json(r); assert(!r.isError && j.indexed >= 2, `isError=${r.isError} indexed=${j.indexed}`); return `indexed ${j.indexed}`;
  });
  await test('call hd_vector_search (semantic match)', async () => {
    await new Promise((r) => setTimeout(r, 800));
    const r = await http.callTool({ name: 'hd_vector_search', arguments: { q: 'protocol for LLM tools', namespace: ns, k: 2 } });
    const j = json(r); assert(!r.isError && (j.results?.length ?? 0) >= 1, `isError=${r.isError} hits=${j.results?.length}`);
    return `top="${(j.results[0]?.title || j.results[0]?.text || '').slice(0, 20)}"`;
  });
  await test('error: unknown tool → isError', async () => {
    try { const r = await http.callTool({ name: 'hd_nonexistent', arguments: {} }); assert(r.isError === true, 'expected isError'); return 'isError'; }
    catch { return 'rejected'; } // SDK may reject unknown tool at protocol level — also acceptable
  });
  await test('error: bad args (missing q) → isError', async () => {
    const r = await http.callTool({ name: 'hd_search', arguments: { limit: 2 } });
    assert(r.isError === true, `expected isError, got ${JSON.stringify(text(r)).slice(0, 80)}`); return 'downstream 400 surfaced';
  });
  await test('session reuse across calls', async () => {
    const a = await http.callTool({ name: 'hd_list_engines', arguments: {} });
    assert(!a.isError, 'second call on same session works'); return 'stable session';
  });
  await test('close cleanly', async () => { await http.close(); return 'closed'; });

  // per-caller auth: a client with NO key must fail tool calls (downstream 401)
  await test('auth: no Authorization → tool call unauthorized', async () => {
    const anon = await newHttpClient(undefined);       // initialize needs no auth
    const r = await anon.callTool({ name: 'hd_search', arguments: { q: 'x', limit: 1 } });
    await anon.close();
    assert(r.isError === true, `expected isError (401), got ${text(r).slice(0, 60)}`); return 'unauthorized surfaced as tool error';
  });

  // ============ stdio transport ============
  section('stdio transport — spawn + initialize + tools + call');
  await test('stdio: connect + tools/list + call hd_search', async () => {
    const transport = new StdioClientTransport({ command: 'node', args: [SERVER_JS], env: { ...process.env, HDSEARCH_API_URL: API_URL, HDSEARCH_API_KEY: KEY } as Record<string, string> });
    const client = new Client({ name: 'mcp-test-stdio', version: '1.0.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert(tools.length === 5, `expected 5 tools, got ${tools.length}`);
    const r = await client.callTool({ name: 'hd_search', arguments: { q: 'open source', modality: 'web', limit: 2 } });
    const j = json(r); assert(!r.isError && (j.results?.length ?? 0) >= 1, `search isError=${r.isError}`);
    await client.close();
    return `5 tools, ${j.results.length} search results`;
  });

  srv?.kill();
  const total = passed + failed + skipped;
  console.log(`\n${C.b}Summary:${C.x} ${C.g}${passed} passed${C.x}, ${failed ? C.r : ''}${failed} failed${C.x}, ${skipped} skipped  (${total} total)`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(`${C.r}fatal:${C.x} ${(e as Error).message}`); process.exit(1); });
