// MCP tool registry for AI Mode. Connects to configured MCP servers, lists their tools,
// and adapts each into an AgentTool the orchestrator can call alongside the built-ins.
// Tool names are namespaced (mcp__<server>__<tool>) to avoid clashes, and surfaced to the
// LLM with their original JSON Schema. See docs/AI_MODE_SPEC.md §8 (MCP providers).
import type { AgentTool, ToolResult, ToolRunContext } from '../tools.js';
import { mcpServers } from './config.js';
import { connect, callTool } from './client.js';
import { log } from '../../logger.js';

const NS = 'mcp__';

/** Namespace a server+tool into a single flat tool name the model can call. */
function toolName(serverId: string, tool: string): string {
  return `${NS}${serverId}__${tool}`;
}

/** Tools exposed by all connected MCP servers for this user. [] when none configured. */
export async function mcpTools(_userId?: string): Promise<AgentTool[]> {
  const servers = mcpServers();
  if (!servers.length) return [];

  const all: AgentTool[] = [];
  await Promise.all(
    servers.map(async (cfg) => {
      try {
        const { tools } = await connect(cfg);
        for (const t of tools) {
          all.push({
            source: 'mcp',
            server: cfg.id,
            def: {
              name: toolName(cfg.id, t.name),
              description: `[${cfg.id}] ${t.description || t.name}`,
              input_schema: t.inputSchema,
            },
            async run(input: any, _ctx?: ToolRunContext): Promise<ToolResult> {
              const { text, isError } = await callTool(cfg, t.name, input);
              return {
                content: text || (isError ? 'Tool returned an error.' : 'Tool returned no content.'),
                ui: { kind: 'mcp', data: { server: cfg.id, tool: t.name, input, output: text, isError } },
              };
            },
          });
        }
      } catch (e) {
        // a dead server must not break the whole agent — skip its tools
        log.warn('mcp server unavailable, skipping', { server: cfg.id, err: (e as Error).message });
      }
    }),
  );

  if (all.length) log.info('mcp tools loaded', { count: all.length, servers: servers.map((s) => s.id) });
  return all;
}
