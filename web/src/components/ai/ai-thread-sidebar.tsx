'use client';

import { useCallback, useRef, useEffect, useState } from 'react';
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useThreadListItemRuntime,
} from '@assistant-ui/react';
import { HistoryDeleteButton } from '@/components/history-delete-button';
import { useAiSearch } from './ai-search-context';
import { resetForNewChat } from './attachments-store';

function ThreadListItem() {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const runtime = useThreadListItemRuntime();
  const { layout, setSidebarOpen } = useAiSearch();

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commitRename = useCallback(() => {
    const val = inputRef.current?.value.trim();
    if (val) void runtime.rename(val).catch(() => {});
    setEditing(false);
  }, [runtime]);

  const onSelectThread = useCallback(() => {
    if (layout === 'fullscreen' && window.matchMedia('(max-width: 767px)').matches) {
      setSidebarOpen(false);
    }
  }, [layout, setSidebarOpen]);

  if (editing) {
    return (
      <ThreadListItemPrimitive.Root className="group mb-0.5 rounded-lg bg-white">
        <form
          className="flex items-center gap-1 px-1.5 py-1"
          onSubmit={(e) => { e.preventDefault(); commitRename(); }}
        >
          <input
            ref={inputRef}
            defaultValue={runtime.getState().title || ''}
            className="min-w-0 flex-1 rounded border border-brand-300 bg-white px-2 py-1 text-sm text-ink-700 outline-none"
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
          />
        </form>
      </ThreadListItemPrimitive.Root>
    );
  }

  return (
    <ThreadListItemPrimitive.Root className="group mb-0.5 flex items-center rounded-lg hover:bg-white data-[active]:bg-white">
      <ThreadListItemPrimitive.Trigger
        onClick={onSelectThread}
        className="min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left text-sm leading-5 text-ink-700 group-data-[active]:font-medium group-data-[active]:text-brand-700"
      >
        <ThreadListItemPrimitive.Title fallback="New chat" />
      </ThreadListItemPrimitive.Trigger>
      <div className="mr-1 hidden shrink-0 items-center gap-0.5 group-hover:flex group-data-[active]:flex">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          className="rounded p-0.5 text-ink-400 hover:text-ink-600"
          title="Rename chat"
          aria-label="Rename chat"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M11.5 1.5l3 3L5 14H2v-3z" />
          </svg>
        </button>
        <ThreadListItemPrimitive.Delete asChild>
          <HistoryDeleteButton
            onClick={(e) => e.stopPropagation()}
            label="Delete chat"
            className="hidden group-hover:inline-flex group-data-[active]:inline-flex"
          />
        </ThreadListItemPrimitive.Delete>
      </div>
    </ThreadListItemPrimitive.Root>
  );
}

function SidebarPanel({ onClose }: { onClose?: () => void }) {
  return (
    <>
      <div className="flex items-center justify-between gap-1 border-b border-ink-100 px-2 py-2.5">
        <span className="text-sm font-semibold text-ink-500">Chats</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-ink-400 hover:bg-white hover:text-ink-600"
          title="Hide sidebar"
          aria-label="Hide sidebar"
        >
          <span className="material-symbols-outlined text-xl">chevron_left</span>
        </button>
      </div>
      <ThreadListPrimitive.Root className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
        <ThreadListPrimitive.New
          onClick={resetForNewChat}
          className="mb-2 w-full rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:border-brand-300"
        >
          + New chat
        </ThreadListPrimitive.New>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ThreadListPrimitive.Items>
            {() => <ThreadListItem />}
          </ThreadListPrimitive.Items>
        </div>
      </ThreadListPrimitive.Root>
    </>
  );
}

export function AiThreadSidebar() {
  const { layout, sidebarOpen, setSidebarOpen } = useAiSearch();
  const isDrawer = layout === 'fullscreen';

  if (!sidebarOpen) {
    if (isDrawer) {
      return (
        <div className="hidden shrink-0 flex-col border-r border-ink-100 bg-ink-50/80 py-2 pr-1 md:flex">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-ink-500 hover:bg-white hover:text-ink-700"
            title="Show conversations"
            aria-label="Show conversations"
          >
            <span className="material-symbols-outlined text-xl">chevron_right</span>
          </button>
        </div>
      );
    }

    return (
      <div className="flex shrink-0 flex-col border-r border-ink-100 bg-ink-50/80 py-2 pr-1">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="rounded-lg p-2 text-ink-500 hover:bg-white hover:text-ink-700"
          title="Show conversations"
          aria-label="Show conversations"
        >
          <span className="material-symbols-outlined text-lg">chevron_right</span>
        </button>
      </div>
    );
  }

  if (isDrawer) {
    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-ink-900/30 md:hidden"
          aria-hidden
          onClick={() => setSidebarOpen(false)}
        />
        <aside className="fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r border-ink-100 bg-ink-50/95 shadow-xl backdrop-blur md:static md:z-auto md:w-56 md:shrink-0 md:shadow-none">
          <SidebarPanel onClose={() => setSidebarOpen(false)} />
        </aside>
      </>
    );
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-ink-100 bg-ink-50/80">
      <SidebarPanel onClose={() => setSidebarOpen(false)} />
    </aside>
  );
}
