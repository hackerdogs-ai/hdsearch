// Tiny self-contained MCP server (stdio) used to verify AI Mode's MCP wiring end-to-end.
// Exposes two trivial, deterministic tools so a test needs no network or credentials:
//   - get_current_time(timezone?)  → ISO timestamp
//   - calc(expression)             → evaluates simple arithmetic (+ - * / and parentheses)
// Configure it via HDSEARCH_MCP_SERVERS, e.g.:
//   [{"id":"demo","transport":"stdio","command":"node","args":["mcp/examples/demo-server.mjs"]}]
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const TOOLS = [
  {
    name: 'get_current_time',
    description: 'Return the current date and time as an ISO-8601 string. Optionally for a given IANA timezone.',
    inputSchema: {
      type: 'object',
      properties: { timezone: { type: 'string', description: 'IANA tz, e.g. America/Los_Angeles' } },
    },
  },
  {
    name: 'calc',
    description: 'Evaluate a simple arithmetic expression with + - * / and parentheses. Returns the numeric result.',
    inputSchema: {
      type: 'object',
      properties: { expression: { type: 'string', description: 'e.g. (2 + 3) * 4' } },
      required: ['expression'],
    },
  },
];

function nowIso(timezone) {
  try {
    if (timezone) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(new Date()) + ` (${timezone})`;
    }
  } catch {
    /* fall through to UTC */
  }
  return new Date().toISOString();
}

function calc(expr) {
  if (!/^[\d\s+\-*/().]+$/.test(String(expr))) throw new Error('only numbers and + - * / ( ) are allowed');
  // eslint-disable-next-line no-new-func
  const v = Function(`"use strict"; return (${expr});`)();
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('not a finite number');
  return v;
}

const server = new Server({ name: 'hd-demo-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    if (name === 'get_current_time') return { content: [{ type: 'text', text: nowIso(args.timezone) }] };
    if (name === 'calc') return { content: [{ type: 'text', text: String(calc(args.expression)) }] };
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
