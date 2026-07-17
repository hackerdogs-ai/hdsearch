// MCP server configuration for AI Mode. Servers are declared via the HDSEARCH_MCP_SERVERS
// env var (a JSON array). Three transports are supported, matching the MCP spec:
//   stdio:  { "id":"time", "transport":"stdio", "command":"node", "args":["server.js"], "env":{...} }
//   http:   { "id":"github", "transport":"http", "url":"https://…/mcp", "headers":{"Authorization":"Bearer …"} }
//   sse:    { "id":"x", "transport":"sse", "url":"https://…/sse", "headers":{…} }
// See docs/AI_MODE_SPEC.md §8.
import { log } from '../../logger.js';

export type McpTransport = 'stdio' | 'http' | 'sse';

export interface McpServerConfig {
  id: string;
  transport: McpTransport;
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  // http / sse
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

/** Parse the configured MCP servers. Invalid/malformed entries are skipped (logged). */
export function mcpServers(): McpServerConfig[] {
  const raw = process.env.HDSEARCH_MCP_SERVERS;
  if (!raw || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    log.warn('HDSEARCH_MCP_SERVERS is not valid JSON', { err: (e as Error).message });
    return [];
  }
  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const out: McpServerConfig[] = [];
  for (const s of arr as McpServerConfig[]) {
    if (!s || s.enabled === false) continue;
    if (!s.id || !s.transport) {
      log.warn('skipping MCP server (missing id/transport)', { server: s });
      continue;
    }
    if (s.transport === 'stdio' && !s.command) {
      log.warn('skipping stdio MCP server (missing command)', { id: s.id });
      continue;
    }
    if ((s.transport === 'http' || s.transport === 'sse') && !s.url) {
      log.warn('skipping http/sse MCP server (missing url)', { id: s.id });
      continue;
    }
    out.push(s);
  }
  return out;
}
