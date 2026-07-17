// RemoteThreadListAdapter backed by /api/ai/threads. Signed-in users get server-
// synced thread metadata (sidebar list) + full-history restore via the history
// adapter supplied by unstable_Provider. Anonymous or temporary chats short-
// circuit every network call — the runtime holds them in memory for the tab only.
import { useMemo, type ReactNode } from 'react';
import { RuntimeAdapterProvider, useAssistantApi, ExportedMessageRepository } from '@assistant-ui/react';
import type { RemoteThreadListAdapter, ThreadHistoryAdapter } from '@assistant-ui/react';
import type { ThreadMessage, ThreadMessageLike } from '@assistant-ui/core';
import { createAssistantStream } from 'assistant-stream';
import { extractSessionNameFromContent } from '@/lib/extract-session-name';

interface AiContentPartText { type: 'text'; text: string }
interface AiContentPartReasoning { type: 'reasoning'; text: string }
interface AiContentPartToolCall {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args?: unknown;
  result?: { ui?: unknown; citations?: unknown; error?: string } | { truncated: true } | unknown;
  isError?: boolean;
}
type AiContentPart = AiContentPartText | AiContentPartReasoning | AiContentPartToolCall;

interface AiMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  content: AiContentPart[];
  createdAt: number;
  model?: string;
}

interface AiThreadBlob {
  threadId: string;
  title: string;
  updatedAt: number;
  messages: AiMessageRecord[];
}

interface AiThreadIndexEntry {
  threadId: string;
  title: string;
  ts: number;
  messageCount: number;
  model?: string;
}

type MutablePart = Extract<ThreadMessageLike['content'], readonly unknown[]>[number];

function blobMessageToLike(m: AiMessageRecord): ThreadMessageLike {
  const content: MutablePart[] = [];
  for (const part of m.content) {
    if (part.type === 'text') {
      content.push({ type: 'text', text: part.text });
    } else if (part.type === 'reasoning') {
      content.push({ type: 'reasoning', text: part.text });
    } else if (part.type === 'tool-call') {
      // Round-trip through JSON so the stored args satisfy the ReadonlyJSONObject
      // constraint — we don't statically know the tool's arg shape.
      const argsJson = JSON.parse(JSON.stringify(part.args ?? {}));
      content.push({
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: argsJson,
        argsText: JSON.stringify(argsJson),
        result: part.result,
        isError: !!part.isError,
      });
    }
  }
  return {
    id: m.id,
    role: m.role,
    content,
    createdAt: new Date(m.createdAt),
  };
}

export interface CreateHdThreadListAdapterOptions {
  signedIn: boolean;
  /** Fires on Provider mount with the thread that is now active. Used to feed the SSE
   *  adapter's threadId and the attachment store's conversation identity. */
  onCurrentThreadChange?: (remoteId: string | undefined, localId: string | undefined) => void;
}

export function useHdThreadListAdapter({ signedIn, onCurrentThreadChange }: CreateHdThreadListAdapterOptions): RemoteThreadListAdapter {
  return useMemo<RemoteThreadListAdapter>(() => {
    const adapter: RemoteThreadListAdapter = {
      async list() {
        if (!signedIn) return { threads: [] };
        try {
          const r = await fetch('/api/ai/threads');
          if (!r.ok) return { threads: [] };
          const j = (await r.json()) as { entries?: AiThreadIndexEntry[] };
          return {
            threads: (j.entries ?? []).map((e) => ({
              remoteId: e.threadId,
              status: 'regular' as const,
              title: e.title,
            })),
          };
        } catch {
          return { threads: [] };
        }
      },
      async initialize(threadId) {
        // Server rows are created lazily on the first chat POST; we just adopt the
        // client-generated threadId as the remoteId so the SSE call binds to it.
        return { remoteId: threadId, externalId: undefined };
      },
      async rename(remoteId, newTitle) {
        if (!signedIn) return;
        try {
          await fetch(`/api/ai/threads/${encodeURIComponent(remoteId)}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: newTitle }),
          });
        } catch {
          /* best-effort */
        }
      },
      async archive() {
        // P1: no archive UX yet.
      },
      async unarchive() {
        // P1: no archive UX yet.
      },
      async delete(remoteId) {
        if (!signedIn) return;
        try {
          await fetch(`/api/ai/threads/${encodeURIComponent(remoteId)}`, { method: 'DELETE' });
        } catch {
          /* best-effort */
        }
      },
      async fetch(threadId) {
        if (!signedIn) return { remoteId: threadId, status: 'regular' };
        try {
          const r = await fetch(`/api/ai/threads/${encodeURIComponent(threadId)}`);
          if (!r.ok) return { remoteId: threadId, status: 'regular' };
          const blob = (await r.json()) as AiThreadBlob;
          return { remoteId: threadId, status: 'regular', title: blob.title };
        } catch {
          return { remoteId: threadId, status: 'regular' };
        }
      },
      async generateTitle(_remoteId: string, messages: readonly ThreadMessage[]) {
        // Native assistant-ui title path (fires on the first turn's runEnd). Stream the
        // name derived from the FIRST user message so the sidebar label sticks WITHOUT a
        // page refresh. Previously this returned an empty stream, which (a) left the title
        // unset until a refetch and (b) could clear the optimistic rename set at send time
        // by ai-auto-thread-title.tsx. Returning the same derived name reinforces it.
        let text = '';
        for (const m of messages) {
          if (m.role !== 'user') continue;
          for (const p of m.content) {
            if (p.type === 'text' && p.text.trim()) {
              text = p.text.trim();
              break;
            }
          }
          if (text) break;
        }
        const title = extractSessionNameFromContent(text);
        return createAssistantStream((controller) => {
          if (title && title !== 'Unnamed Session') controller.appendText(title);
        });
      },
      unstable_Provider: ({ children }: { children?: ReactNode }) => (
        <HdThreadProvider signedIn={signedIn} onCurrentThreadChange={onCurrentThreadChange}>
          {children}
        </HdThreadProvider>
      ),
    };
    return adapter;
  }, [signedIn, onCurrentThreadChange]);
}

function HdThreadProvider({
  children,
  signedIn,
  onCurrentThreadChange,
}: {
  children?: ReactNode;
  signedIn: boolean;
  onCurrentThreadChange?: (remoteId: string | undefined, localId: string | undefined) => void;
}) {
  const aui = useAssistantApi();
  const history = useMemo<ThreadHistoryAdapter>(() => {
    return {
      async load() {
        const st = aui.threadListItem().getState();
        const remoteId = st.remoteId;
        onCurrentThreadChange?.(remoteId, st.id);
        if (!signedIn || !remoteId) return { messages: [] };
        try {
          const r = await fetch(`/api/ai/threads/${encodeURIComponent(remoteId)}`);
          if (!r.ok) return { messages: [] };
          const blob = (await r.json()) as AiThreadBlob;
          const likes = (blob.messages ?? []).map(blobMessageToLike);
          if (!likes.length) return { messages: [] };
          return ExportedMessageRepository.fromArray(likes);
        } catch {
          return { messages: [] };
        }
      },
      async append() {
        // Server writes on `done` in /v1/ai/chat — nothing to persist here.
      },
    };
  }, [aui, signedIn, onCurrentThreadChange]);

  return <RuntimeAdapterProvider adapters={{ history }}>{children}</RuntimeAdapterProvider>;
}
