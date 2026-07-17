'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  useRemoteThreadListRuntime,
  WebSpeechSynthesisAdapter,
  WebSpeechDictationAdapter,
} from '@assistant-ui/react';
import { createHdSearchSseAdapter } from './hd-search-sse-adapter';
import { useHdThreadListAdapter } from './hd-thread-list-adapter';
import { useAiSearch } from './ai-search-context';
import { setActiveThread, chatThreadIdOverride, readyFileIds } from './attachments-store';

/**
 * Hybrid runtime for AI Search.
 *
 * - Signed-in + not temporary → useRemoteThreadListRuntime with the HD thread-list
 *   adapter (server-synced sidebar, cross-device restore via the history adapter).
 * - Anonymous or temporary → the same runtime, but the adapter short-circuits
 *   every network call so the thread is held only in this tab's runtime memory.
 *
 * The active thread id is threaded into the SSE adapter via a ref that the
 * history adapter refreshes on each thread mount. That id rides POST /api/ai/chat
 * so the server binds every turn to the same thread row, and it also rides back
 * in the `done` event as a fallback for the very first turn (when the client
 * hasn't seen a threadId yet).
 */
function AiSearchRuntimeInner({ children, initialThreadId }: { children: ReactNode; initialThreadId?: string }) {
  const { modelOverrideRef, sourceDetailsRef, temporaryRef, signedIn } = useAiSearch();

  // Deep-link support: dashboard "AI conversations" links land at ?thread=<id>. We
  // hand that value to useRemoteThreadListRuntime once on mount; further switches
  // are driven by the sidebar (which owns the runtime's own thread state).
  const [threadId, setThreadId] = useState<string | undefined>(initialThreadId);
  useEffect(() => {
    // Clear the initial-link steer after the first mount so subsequent thread
    // switches from the sidebar aren't overridden every render.
    if (threadId) setThreadId(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ref updated by the HD adapter's history.load(): current visible thread id.
  const currentThreadIdRef = useRef<string | undefined>(undefined);
  // Ref updated by the SSE adapter when it parses `done`; fallback source of truth
  // for the very first turn of a fresh thread.
  const seenThreadIdRef = useRef<string | undefined>(undefined);

  const sseAdapter = useMemo(
    () =>
      createHdSearchSseAdapter({
        getModelOverride: () => modelOverrideRef.current,
        getSourceDetails: () => sourceDetailsRef.current,
        getTemporary: () => temporaryRef.current,
        // For a brand-new chat with pending file attachments, fall back to the draft
        // threadId the attachment store minted so uploads + this turn share a namespace.
        getThreadId: () => currentThreadIdRef.current ?? seenThreadIdRef.current ?? chatThreadIdOverride(),
        getFileIds: () => readyFileIds(),
        onThreadIdReceived: (id) => {
          seenThreadIdRef.current = id;
        },
      }),
    [modelOverrideRef, sourceDetailsRef, temporaryRef],
  );

  // Stable across renders — otherwise the adapter useMemo below busts every render
  // and useRemoteThreadListRuntime treats the list as fresh each time (extra fetches
  // to /api/ai/threads, wasted renders).
  const onCurrentThreadChange = useCallback((id: string | undefined, localId: string | undefined) => {
    currentThreadIdRef.current = id;
    // Reset the fallback on thread switch so a stale done-event id doesn't leak
    // into the next thread's first turn.
    seenThreadIdRef.current = undefined;
    // Keep the attachment store's conversation identity in sync so uploads bind to the
    // right thread and the compose tray clears when the conversation changes.
    setActiveThread(localId, id);
  }, []);

  const hdAdapter = useHdThreadListAdapter({
    signedIn,
    onCurrentThreadChange,
  });

  // Browser-native speech: dictation (voice → composer text) + synthesis (read-aloud).
  // Constructed client-side only; dictation is gated on Web Speech API availability so
  // the mic button can hide where unsupported. See ai-search-thread.tsx composer.
  const speechAdapters = useMemo(() => {
    if (typeof window === 'undefined') return {} as Record<string, unknown>;
    const a: Record<string, unknown> = {};
    try {
      a.speech = new WebSpeechSynthesisAdapter();
    } catch {
      /* TTS unavailable */
    }
    try {
      if (window.SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition) {
        a.dictation = new WebSpeechDictationAdapter();
      }
    } catch {
      /* dictation unavailable */
    }
    return a;
  }, []);

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () => useLocalRuntime(sseAdapter, { adapters: speechAdapters as never }),
    adapter: hdAdapter,
    threadId,
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

/** assistant-ui remote-thread-list runtime + custom SSE adapter (LLM keys stay server-side). */
export function AiSearchRuntime({ children, initialThreadId }: { children: ReactNode; initialThreadId?: string }) {
  return <AiSearchRuntimeInner initialThreadId={initialThreadId}>{children}</AiSearchRuntimeInner>;
}
