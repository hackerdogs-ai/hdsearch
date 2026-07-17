// MCP client wrapper. Connects to a configured MCP server over the appropriate transport
// (stdio / Streamable HTTP / SSE) using the official @modelcontextprotocol/sdk, caches the
// connection, lists tools, and calls them. Connections are lazy and reused across requests;
// a failed connection is dropped so the next call reconnects. See docs/AI_MODE_SPEC.md §8.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { log, errFields } from '../../logger.js';
import type { McpServerConfig } from './config.js';

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface Conn {
  client: Client;
  tools: McpToolInfo[];
}

const CONNECT_TIMEOUT_MS = 8000;
const conns = new Map<string, Promise<Conn>>();

function makeTransport(cfg: McpServerConfig) {
  if (cfg.transport === 'stdio') {
    return new StdioClientTransport({
      command: cfg.command!,
      args: cfg.args || [],
      env: { ...process.env, ...(cfg.env || {}) } as Record<string, string>,
      cwd: cfg.cwd,
    });
  }
  const url = new URL(cfg.url!);
  const opts = cfg.headers ? { requestInit: { headers: cfg.headers } } : undefined;
  return cfg.transport === 'sse' ? new SSEClientTransport(url, opts) : new StreamableHTTPClientTransport(url, opts);
}

async function open(cfg: McpServerConfig): Promise<Conn> {
  const client = new Client({ name: 'hd-search-ai', version: '1.0.0' }, { capabilities: {} });
  const transport = makeTransport(cfg);
  const connectP = client.connect(transport);
  await withTimeout(connectP, CONNECT_TIMEOUT_MS, `connect ${cfg.id}`);
  const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, `listTools ${cfg.id}`);
  const tools: McpToolInfo[] = (listed.tools || []).map((t: any) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
  }));
  log.info('mcp connected', { server: cfg.id, transport: cfg.transport, tools: tools.length });
  return { client, tools };
}

/** Get (or establish) a cached connection to a server. Throws on failure. */
export async function connect(cfg: McpServerConfig): Promise<Conn> {
  let p = conns.get(cfg.id);
  if (!p) {
    p = open(cfg).catch((e) => {
      conns.delete(cfg.id); // allow retry next time
      log.warn('mcp connect failed', { server: cfg.id, ...errFields(e) });
      throw e;
    });
    conns.set(cfg.id, p);
  }
  return p;
}

/** Call a tool on a server and return its text content (concatenated). */
export async function callTool(cfg: McpServerConfig, name: string, args: any): Promise<{ text: string; raw: any; isError: boolean }> {
  const { client } = await connect(cfg);
  const res: any = await withTimeout(client.callTool({ name, arguments: args || {} }), 60_000, `callTool ${cfg.id}/${name}`);
  const parts: string[] = [];
  for (const block of res.content || []) {
    if (block.type === 'text') parts.push(block.text);
    else if (block.type === 'resource' && block.resource?.text) parts.push(block.resource.text);
    else parts.push(`[${block.type}]`);
  }
  return { text: parts.join('\n').trim(), raw: res, isError: !!res.isError };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`MCP timeout (${ms}ms): ${what}`)), ms)),
  ]);
}
