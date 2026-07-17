// HD-Search MCP server (spec §8: "the product will also have an MCP server").
// Exposes the aggregator as MCP tools so any MCP client (Claude, IDEs, agents)
// can search/crawl/vector-search. It is a thin client over the HTTP API and
// authenticates with an sk-hds- API key (HDSEARCH_API_KEY), so all quota, rate
// limiting and per-user provider keys apply exactly as for HTTP callers.
//
// Transport: stdio (the standard for local MCP clients).
//   HDSEARCH_API_URL   default http://127.0.0.1:8791
//   HDSEARCH_API_KEY   required (sk-hds-...)
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const API_URL = (process.env.HDSEARCH_API_URL || 'http://127.0.0.1:8791').replace(/\/$/, '');
const API_KEY = process.env.HDSEARCH_API_KEY || '';

async function api(path: string, body?: unknown, method = 'POST'): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    method: body ? method : 'GET',
    headers: {
      authorization: `Bearer ${API_KEY}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`hd-search API ${res.status}: ${text.slice(0, 400)}`);
  return json;
}

const TOOLS = [
  {
    name: 'hd_search',
    description:
      'Search the internet across aggregated engines (web/news/images/videos/scholar/places/shopping/code/social/archive/darkweb). Priority-ordered fallback or aggregate fan-out with dedup.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'search query' },
        modality: { type: 'string', enum: ['web', 'news', 'images', 'videos', 'scholar', 'places', 'shopping', 'code', 'social', 'archive', 'darkweb'], default: 'web' },
        engine: { type: 'string', description: 'force a specific engine id (e.g. brave, serpapi, ahmia)' },
        mode: { type: 'string', enum: ['fallback', 'aggregate'], default: 'fallback' },
        limit: { type: 'integer', default: 10 },
        facets: { type: 'boolean', default: false },
      },
      required: ['q'],
    },
  },
  {
    name: 'hd_crawl',
    description: 'Crawl a URL and return normalized markdown/text/links/images. Uses self-hosted crawlers first, commercial fallback.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        formats: { type: 'array', items: { type: 'string', enum: ['markdown', 'text', 'html', 'links', 'images'] } },
        render: { type: 'boolean', description: 'render JS via headless browser if available' },
      },
      required: ['url'],
    },
  },
  {
    name: 'hd_vector_search',
    description: 'Semantic (vector) KNN search over a previously indexed namespace. Optionally ground with live web results first.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string' },
        namespace: { type: 'string', default: 'default' },
        k: { type: 'integer', default: 10 },
        groundWithWeb: { type: 'boolean', default: false },
      },
      required: ['q'],
    },
  },
  {
    name: 'hd_vector_index',
    description: 'Embed and index documents into a namespace with a TTL (default 24h) for later vector search.',
    inputSchema: {
      type: 'object',
      properties: {
        documents: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, url: { type: 'string' }, title: { type: 'string' } }, required: ['text'] } },
        namespace: { type: 'string', default: 'default' },
        ttl: { type: 'integer' },
      },
      required: ['documents'],
    },
  },
  {
    name: 'hd_list_engines',
    description: 'List the available search/crawl engines, their modalities, access type and whether they are available to you.',
    inputSchema: { type: 'object', properties: { category: { type: 'string', enum: ['search', 'crawl', 'darkweb'] }, modality: { type: 'string' } } },
  },
];

const server = new Server({ name: 'hd-search', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    let result: unknown;
    switch (name) {
      case 'hd_search':
        result = await api('/v1/search', args);
        break;
      case 'hd_crawl':
        result = await api('/v1/crawl', args);
        break;
      case 'hd_vector_search':
        result = await api('/v1/search/vector', args);
        break;
      case 'hd_vector_index':
        result = await api('/v1/search/vector/index', args);
        break;
      case 'hd_list_engines': {
        const qs = new URLSearchParams();
        if ((args as any).category) qs.set('category', (args as any).category);
        if ((args as any).modality) qs.set('modality', (args as any).modality);
        result = await api(`/v1/engines${qs.toString() ? `?${qs}` : ''}`);
        break;
      }
      default:
        throw new Error(`unknown tool: ${name}`);
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true };
  }
});

async function main() {
  if (!API_KEY) {
    process.stderr.write('hd-search MCP: HDSEARCH_API_KEY is required (sk-hds-...)\n');
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`hd-search MCP server ready (api=${API_URL})\n`);
}

main().catch((e) => {
  process.stderr.write(`hd-search MCP fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
