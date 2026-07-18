import type { ChatModelAdapter, ChatModelRunResult, TextMessagePart, ReasoningMessagePart } from '@assistant-ui/react';
import type { ThreadMessage } from '@assistant-ui/core';
import type { HdsToolResult } from './types';
import { getClientDatetimeContext } from '@/lib/client-datetime-context';

function threadMessagesToApi(messages: readonly ThreadMessage[]): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      const text = m.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
        .trim();
      if (text) out.push({ role: 'user', content: text });
    } else if (m.role === 'assistant') {
      const text = m.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
        .trim();
      if (text) out.push({ role: 'assistant', content: text });
    }
  }
  return out;
}

type ToolPart = {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  argsText: string;
  result?: HdsToolResult;
  isError?: boolean;
};

function buildContent(text: string, reasoning: string, tools: Map<string, ToolPart>) {
  const parts: (TextMessagePart | ReasoningMessagePart | ToolPart)[] = [];
  if (reasoning) parts.push({ type: 'reasoning', text: reasoning });
  if (text) parts.push({ type: 'text', text });
  for (const t of tools.values()) parts.push(t);
  return parts;
}

/** Fixed Anthropic thinking budget (effort UI removed — only affects direct Claude models). */
const DEFAULT_ANTHROPIC_EFFORT = 'high' as const;

export interface HdSearchSseAdapterOptions {
  getModelOverride: () => string;
  getSourceDetails?: () => string | undefined;
  /** Current assistant-ui thread id — sent to the server so turns bind to one row. */
  getThreadId?: () => string | undefined;
  /** When true, server skips Redis/S3/Postgres persistence for this turn. */
  getTemporary?: () => boolean;
  /** Optional title (client-computed via ai-auto-thread-title) sent on the first turn. */
  getTitle?: () => string | undefined;
  /** Ready file attachment ids to ground this turn on (RAG). */
  getFileIds?: () => string[] | undefined;
  /** Called with { threadId, temporary } from the SSE `done` event. */
  onThreadIdReceived?: (threadId: string, temporary: boolean) => void;
}

/** Custom ChatModelAdapter — streams hd-search `/api/ai/chat` SSE (no LLM keys in browser). */
export function createHdSearchSseAdapter(opts: HdSearchSseAdapterOptions): ChatModelAdapter {
  const { getModelOverride, getSourceDetails, getThreadId, getTemporary, getTitle, getFileIds, onThreadIdReceived } = opts;
  return {
    async *run({ messages, abortSignal }) {
      const modelOverride = getModelOverride();
      if (!modelOverride) {
        yield {
          content: [{ type: 'text', text: 'Pick a model before sending.' }],
          status: { type: 'complete', reason: 'stop' },
        };
        return;
      }

      const sourceDetails = getSourceDetails?.();
      const threadId = getThreadId?.();
      const temporary = getTemporary?.() ?? false;
      const title = getTitle?.();
      const fileIds = getFileIds?.();
      const clientTime = getClientDatetimeContext();
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: threadMessagesToApi(messages),
          autoSelect: false,
          modelOverride,
          effort: DEFAULT_ANTHROPIC_EFFORT,
          clientTime,
          ...(sourceDetails ? { sourceDetails } : {}),
          ...(threadId ? { threadId } : {}),
          ...(temporary ? { temporary: true } : {}),
          ...(title ? { title } : {}),
          ...(fileIds && fileIds.length ? { fileIds } : {}),
        }),
        signal: abortSignal,
      });

      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || j.error || `AI error ${res.status}`);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let text = '';
      let reasoning = '';
      const tools = new Map<string, ToolPart>();
      let customMeta: Record<string, unknown> = {};

      const emit = (): ChatModelRunResult => ({
        content: buildContent(text, reasoning, tools) as ChatModelRunResult['content'],
        metadata: { custom: { ...customMeta } },
      });

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() || '';

        for (const frame of frames) {
          const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(dataLine.slice(5).trim());
          } catch {
            continue;
          }

          switch (ev.type) {
            case 'meta':
              customMeta = {
                ...customMeta,
                model: ev.model,
                provider: ev.provider,
                reason: ev.reason,
              };
              break;
            case 'file_context':
              // RAG citations for attached files — surfaced in message metadata so the
              // UI can show which files grounded the answer.
              customMeta = { ...customMeta, fileCitations: ev.citations };
              yield emit();
              break;
            case 'attachment_notice':
              // The model can't process some attached media (e.g. image on a non-vision
              // model, or audio/video) — surfaced so the UI can show a professional note.
              customMeta = { ...customMeta, attachmentNotice: { unsupported: ev.unsupported, model: ev.model } };
              yield emit();
              break;
            case 'text':
              text += String(ev.delta || '');
              yield emit();
              break;
            case 'thinking':
              reasoning += String(ev.delta || '');
              yield emit();
              break;
            case 'tool_call': {
              const id = String(ev.id);
              const input = (ev.input ?? {}) as Record<string, unknown>;
              tools.set(id, {
                type: 'tool-call',
                toolCallId: id,
                toolName: String(ev.name),
                args: input,
                argsText: JSON.stringify(input),
              });
              yield emit();
              break;
            }
            case 'tool_result': {
              const id = String(ev.id);
              const existing = tools.get(id);
              if (existing) {
                const result: HdsToolResult = {
                  ui: ev.ui as HdsToolResult['ui'],
                  citations: ev.citations as HdsToolResult['citations'],
                  error: ev.error as string | undefined,
                };
                tools.set(id, {
                  ...existing,
                  result,
                  isError: !!ev.error,
                });
              }
              yield emit();
              break;
            }
            case 'usage':
              customMeta = { ...customMeta, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, totalTokens: ev.totalTokens };
              yield emit();
              break;
            case 'error':
              throw new Error(String(ev.message || 'AI stream error'));
            case 'done':
              if (typeof ev.threadId === 'string') {
                onThreadIdReceived?.(ev.threadId, !!ev.temporary);
                customMeta = { ...customMeta, threadId: ev.threadId, temporary: !!ev.temporary };
              }
              break;
          }
        }
      }

      yield {
        ...emit(),
        status: { type: 'complete', reason: 'stop' },
      };
    },
  };
}
