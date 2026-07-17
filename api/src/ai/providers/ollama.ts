// Ollama provider for AI Mode — self-hosted/local LLMs (no key, $0 provider cost).
// Speaks Ollama's /api/chat (NDJSON streaming, OpenAI-style function tools). Models are
// discovered dynamically from /api/tags so whatever the user has pulled shows up in the
// picker. See docs/AI_MODE_SPEC.md §6 (multi-provider).
import { env } from '../../env.js';
import { log } from '../../logger.js';
import type { LlmModel } from '../models.js';
import type { LlmProvider, TurnArgs, TurnResult, StreamDelta, NeutralMsg, ToolCall } from './types.js';

const base = () => env.ollamaUrl.replace(/\/+$/, '');

// ---- reachability (short cache so availability checks stay cheap) ----
let reachCache: { ok: boolean; at: number } | null = null;
export async function ollamaReachable(): Promise<boolean> {
  if (reachCache && Date.now() - reachCache.at < 15_000) return reachCache.ok;
  let ok = false;
  try {
    const r = await fetch(`${base()}/api/version`, { signal: AbortSignal.timeout(2500) });
    ok = r.ok;
  } catch {
    ok = false;
  }
  reachCache = { ok, at: Date.now() };
  return ok;
}

/** Build an LlmModel record for a pulled Ollama tag. Self-hosted → $0, no key. */
function mkModel(tag: string, details: any, rank: number): LlmModel {
  const ctx = Number(details?.context_length) || 32_768;
  const isCloud = /:cloud$/i.test(tag);
  return {
    id: tag,
    provider: 'ollama',
    label: `${prettyName(tag)} (Ollama${isCloud ? ' Cloud' : ' local'})`,
    contextTokens: ctx,
    maxOutputTokens: 8_192,
    inputPer1M: 0,
    outputPer1M: 0,
    cachedInputPer1M: 0,
    // Tools assumed on; Ollama returns an error if a given model can't, which we
    // surface gracefully. Vision/thinking left off (unknown per arbitrary tag).
    capabilities: { tools: true, vision: false, thinking: false, streaming: true },
    accessType: 'self-hosted',
    requiresKeys: [],
    defaultRank: 50 + rank, // after the commercial flagships
    enabled: true,
  };
}

function prettyName(tag: string): string {
  const name = tag.replace(/:latest$/i, '');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Discover models the user has pulled. Returns [] if Ollama is unreachable. */
export async function listOllamaModels(): Promise<LlmModel[]> {
  if (!(await ollamaReachable())) return [];
  try {
    const r = await fetch(`${base()}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    const j: any = await r.json();
    const tags: any[] = j.models || [];
    return tags.map((t, i) => mkModel(t.name, t.details, i));
  } catch (e) {
    log.warn('ollama tag discovery failed', { err: (e as Error).message });
    return [];
  }
}

// ---- chat ----
function toOllama(messages: NeutralMsg[], system: string): any[] {
  const out: any[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const msg: any = { role: 'assistant', content: m.content || '' };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.input } }));
      }
      out.push(msg);
    } else {
      // tool result. tool_name lets newer Ollama match the call; content is the body.
      out.push({ role: 'tool', tool_name: m.name, content: m.content });
    }
  }
  return out;
}

export const ollamaProvider: LlmProvider = {
  id: 'ollama',

  async available(_model: LlmModel): Promise<boolean> {
    return ollamaReachable();
  },

  async *streamTurn(args: TurnArgs): AsyncGenerator<StreamDelta, TurnResult, void> {
    const body = {
      model: args.model.id,
      messages: toOllama(args.messages, args.system),
      tools: args.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
      stream: true,
      options: { num_predict: Math.min(args.model.maxOutputTokens, args.maxOutputTokens) },
    };
    const res = await fetch(`${base()}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        const cloud = /:cloud$/i.test(args.model.id);
        throw new Error(
          cloud
            ? `“${args.model.label}” is an Ollama Cloud model and needs authentication. Sign in on the machine running Ollama (\`ollama signin\`) or set an Ollama API key, then retry — or pick a local model (no sign-in needed).`
            : `Ollama rejected the request (${res.status}). This model may require sign-in: run \`ollama signin\` on the Ollama host, or choose a local model.`,
        );
      }
      throw new Error(`ollama ${res.status}: ${t.slice(0, 200)}`);
    }

    const toolCalls: ToolCall[] = [];
    let usage = { inputTokens: 0, outputTokens: 0 };
    let stopReason = 'end_turn';
    let nTool = 0;

    // Some local models (e.g. qwen3-coder) sometimes emit a tool call as PLAIN TEXT
    // (`<function=…>` / `<tool_call>…`) instead of Ollama's structured tool_calls. We
    // stream visible text but hold back anything from such a marker onward, then parse
    // those text-format calls after the turn so the tool still fires and the junk never
    // reaches the user. `raw` = all content; `emitted` = chars surfaced as visible text.
    let raw = '';
    let emitted = 0;
    let suppressed = false;

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let j: any;
        try {
          j = JSON.parse(line);
        } catch {
          continue;
        }
        if (j.error) throw new Error(`ollama: ${j.error}`);
        const msg = j.message || {};
        if (msg.content) {
          raw += msg.content;
          if (!suppressed) {
            const { idx, marker } = safeBoundary(raw);
            if (idx > emitted) {
              yield { type: 'text', delta: raw.slice(emitted, idx) };
              emitted = idx;
            }
            if (marker) suppressed = true;
          }
        }
        if (msg.thinking) yield { type: 'thinking', delta: msg.thinking };
        if (Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls) {
            const fn = tc.function || {};
            let input = fn.arguments;
            if (typeof input === 'string') {
              try {
                input = JSON.parse(input);
              } catch {
                input = {};
              }
            }
            toolCalls.push({ id: tc.id || `call_${nTool++}_${fn.name || 'tool'}`, name: fn.name, input: input || {} });
          }
        }
        if (j.done) {
          usage.inputTokens = j.prompt_eval_count || 0;
          usage.outputTokens = j.eval_count || 0;
        }
      }
    }

    // Fallback: no structured tool_calls but the text carried a tool-call block → parse it.
    if (!toolCalls.length) {
      const parsed = parseTextToolCalls(raw);
      for (const p of parsed) toolCalls.push({ id: `call_${nTool++}_${p.name}`, name: p.name, input: p.input });
    } else if (!suppressed && emitted < raw.length) {
      // structured call but we withheld a partial-marker tail that turned out benign
      yield { type: 'text', delta: raw.slice(emitted) };
      emitted = raw.length;
    }

    stopReason = toolCalls.length ? 'tool_use' : 'end_turn';
    const text = toolCalls.length ? raw.slice(0, firstMarker(raw) ?? emitted).trim() : raw;
    return { text, toolCalls, usage, stopReason };
  },
};

// ---- text-format tool-call fallback (for models that don't use structured tool_calls) ----
const TC_MARKERS = ['<function=', '<function ', '<tool_call>', '<tools>', '<|tool_call|>'];

/** Index of the first tool-call marker in `s`, or null if none. */
function firstMarker(s: string): number | null {
  let best: number | null = null;
  for (const mk of TC_MARKERS) {
    const i = s.indexOf(mk);
    if (i !== -1) best = best === null ? i : Math.min(best, i);
  }
  return best;
}

/**
 * How far it's safe to emit as visible text: up to a full marker (then suppress), or —
 * if none yet — short of any trailing substring that could be the start of a marker.
 */
function safeBoundary(s: string): { idx: number; marker: boolean } {
  const m = firstMarker(s);
  if (m !== null) return { idx: m, marker: true };
  let hold = 0;
  for (const mk of TC_MARKERS) {
    for (let k = Math.min(mk.length - 1, s.length); k > 0; k--) {
      if (s.endsWith(mk.slice(0, k))) {
        hold = Math.max(hold, k);
        break;
      }
    }
  }
  return { idx: s.length - hold, marker: false };
}

/** Parse `<function=NAME><parameter=K>V</parameter></function>` and `<tool_call>{json}</tool_call>`. */
function parseTextToolCalls(s: string): { name: string; input: any }[] {
  const calls: { name: string; input: any }[] = [];
  const fre = /<function=([^>\s]+)\s*>([\s\S]*?)<\/function>/g;
  let m: RegExpExecArray | null;
  while ((m = fre.exec(s))) {
    const input: Record<string, string> = {};
    const pre = /<parameter=([^>\s]+)\s*>([\s\S]*?)<\/parameter>/g;
    let p: RegExpExecArray | null;
    while ((p = pre.exec(m[2]!))) input[p[1]!] = p[2]!.trim();
    calls.push({ name: m[1]!, input });
  }
  if (calls.length) return calls;
  const tre = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  while ((m = tre.exec(s))) {
    try {
      const j = JSON.parse(m[1]!);
      if (j.name) calls.push({ name: j.name, input: j.arguments || j.parameters || {} });
    } catch {
      /* not JSON → ignore */
    }
  }
  return calls;
}
