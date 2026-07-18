// Provider abstraction for AI Mode. The orchestrator keeps a single neutral
// transcript and one set of tool specs; each LLM provider (Anthropic, Ollama, …)
// translates that neutral form into its own wire format, streams one turn, and
// returns a normalized TurnResult. This is what lets one agent loop drive many
// providers. See docs/AI_MODE_SPEC.md §6, §11.1.
import type { LlmModel } from '../models.js';
import type { TokenUsage } from '../../tokens.js';

/** One tool call the model wants to make. */
export interface ToolCall {
  id: string;
  name: string;
  input: any;
}

/** An image attached to a user turn (base64), for vision-capable models. */
export interface MsgImage {
  mediaType: string; // image/png | image/jpeg | image/gif | image/webp
  dataBase64: string;
}

/** Provider-neutral conversation turn. The orchestrator owns a list of these. */
export type NeutralMsg =
  | { role: 'user'; content: string; images?: MsgImage[] }
  // `raw` carries the provider-native assistant content (e.g. Anthropic content
  // blocks incl. thinking) so we can replay it verbatim on the next turn of the
  // SAME provider without losing fidelity. Optional — providers that don't need
  // it (Ollama) just rebuild from text + toolCalls.
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; raw?: any }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

/** A tool the model may call (built-in or MCP), in JSON-Schema form. */
export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** A streamed token chunk yielded mid-turn. */
export interface StreamDelta {
  type: 'text' | 'thinking';
  delta: string;
}

/** The result of one completed provider turn. */
export interface TurnResult {
  text: string; // visible assistant text produced this turn
  toolCalls: ToolCall[]; // tool calls the model requested (empty → final turn)
  usage: TokenUsage; // tokens consumed this turn
  stopReason: string; // 'end_turn' | 'tool_use' | 'max_tokens' | …
  raw?: any; // provider-native assistant content to stash on the NeutralMsg
}

export interface TurnArgs {
  model: LlmModel;
  system: string;
  messages: NeutralMsg[];
  tools: ToolSpec[];
  userId?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxOutputTokens: number;
}

export interface LlmProvider {
  id: string; // 'anthropic' | 'ollama' | …
  /** Can this provider serve a request right now (key present / endpoint reachable)? */
  available(model: LlmModel, userId?: string): Promise<boolean>;
  /** Stream one turn: yields deltas, returns the completed TurnResult. */
  streamTurn(args: TurnArgs): AsyncGenerator<StreamDelta, TurnResult, void>;
}
