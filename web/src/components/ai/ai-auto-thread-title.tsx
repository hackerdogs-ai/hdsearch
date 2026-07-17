'use client';

import { useAssistantRuntime, useThread, useThreadList } from '@assistant-ui/react';
import { useEffect, useRef } from 'react';
import { extractSessionNameFromContent } from '@/lib/extract-session-name';

/**
 * Auto-name the sidebar thread from the FIRST user message, the instant the first
 * turn starts — not after the response completes.
 *
 * The user message lands in the thread state synchronously on send, so we rename
 * `runtime.threads.mainItem` (which always points at the active thread and exists
 * immediately) as soon as that text appears. We deliberately do NOT gate on
 * `mainThreadId`: for a fresh chat the server-assigned id isn't known until the
 * first turn's `done` event, and gating on it was what delayed the title until the
 * response finished.
 */
export function AiAutoThreadTitle() {
  const runtime = useAssistantRuntime();
  // Current thread item's title (empty/undefined for a fresh chat → we should name it).
  const itemTitle = useThreadList((s) => {
    const id = s.mainThreadId;
    return id ? s.threadItems[id]?.title : undefined;
  });
  const firstUserText = useThread((s) => {
    for (const m of s.messages) {
      if (m.role !== 'user') continue;
      for (const p of m.content) {
        if (p.type === 'text' && p.text.trim()) return p.text.trim();
      }
    }
    return '';
  });
  // One rename per compose cycle; reset when we're back to an empty thread (new chat).
  const renamedRef = useRef(false);

  useEffect(() => {
    if (!firstUserText) {
      renamedRef.current = false;
    }
  }, [firstUserText]);

  useEffect(() => {
    if (!firstUserText || renamedRef.current) return;
    // Already named (existing thread, or a previous rename landed) → nothing to do.
    if ((itemTitle ?? '').trim()) {
      renamedRef.current = true;
      return;
    }
    const name = extractSessionNameFromContent(firstUserText);
    if (!name || name === 'Unnamed Session') return;
    renamedRef.current = true;
    // Rename the active thread's item directly — available immediately at turn start,
    // so the sidebar label updates the moment the first message is sent.
    void runtime.threads.mainItem.rename(name).catch(() => {
      renamedRef.current = false;
    });
  }, [itemTitle, firstUserText, runtime]);

  return null;
}
