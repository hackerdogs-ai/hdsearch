'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useThreadListItemRuntime,
} from '@assistant-ui/react';
import { HistoryDeleteButton } from '@/components/history-delete-button';
import { SearchModalityIcon } from '@/components/search-modality-icon';
import { useModalityNavOptional } from '@/components/modality-nav-context';
import { getRecents, removeRecent, type Recent } from '@/lib/recents';
import { aiSearchHref, isAiModality } from '@/lib/ai-routes';
import { searchHref } from '@/lib/search-routes';
import { SEARCH_MODALITIES, type SearchModality } from '@/components/search-modality-nav';
import {
  fetchChatFolders,
  createFolder,
  deleteFolder as deleteFolderApi,
  assignThreadFolder,
  type Folder,
} from '@/lib/folders';
import { resetForNewChat } from '@/components/ai/attachments-store';

const SEARCH_SECTION_KEY = 'hds_sidebar_search_open';
const CHAT_SECTION_KEY = 'hds_sidebar_chat_open';
const PAGE_SIZE = 10; // "Only show top 10" — grow on scroll (infinite scroll).

/** Lifted sidebar search query — filters BOTH the Search and AI Search lists. */
const SidebarQueryContext = createContext<string>('');
const useSidebarQuery = () => useContext(SidebarQueryContext);

/** Chat folders: identities + per-thread assignment + the active filter. */
interface FolderCtxValue {
  folders: Folder[];
  assignments: Record<string, string>;
  activeFolderId: string | null;
  move: (threadId: string, folderId: string | null) => void;
  /** Create a folder (optionally moving a thread into it). Entry point for the first folder. */
  create: (threadId?: string) => void;
}
const FolderContext = createContext<FolderCtxValue | null>(null);
const useFolders = () => useContext(FolderContext);

function asSearchModality(modality: string): SearchModality {
  return (SEARCH_MODALITIES as readonly string[]).includes(modality)
    ? (modality as SearchModality)
    : 'web';
}

function closeMobileSidebar() {
  if (window.matchMedia('(max-width: 767px)').matches) {
    window.dispatchEvent(new CustomEvent('hds-close-sidebar'));
  }
}

function readSectionOpen(key: string, fallback = true): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = localStorage.getItem(key);
    if (v != null) return v !== '0';
  } catch {
    /* ignore */
  }
  return fallback;
}

/** Bottom sentinel that calls onHit when scrolled into view (infinite scroll). */
function InfiniteSentinel({ onHit, enabled }: { onHit: () => void; enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onHit();
      },
      { root: null, rootMargin: '120px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [onHit, enabled]);
  return <div ref={ref} aria-hidden className="h-1 w-full shrink-0" />;
}

function CollapsibleSection({
  title,
  icon,
  open,
  onToggle,
  flex = 'none',
  className = '',
  children,
}: {
  title: string;
  icon: string;
  open: boolean;
  onToggle: () => void;
  flex?: 'none' | 'fill' | 'share-sm' | 'share-lg';
  className?: string;
  children: React.ReactNode;
}) {
  const flexClass = !open
    ? 'shrink-0'
    : flex === 'fill'
      ? 'flex min-h-0 flex-1 flex-col'
      : flex === 'share-sm'
        ? 'flex max-h-[min(44vh,16rem)] min-h-0 shrink-0 flex-col md:max-h-none md:min-h-[8rem] md:flex-[3] md:shrink'
        : flex === 'share-lg'
          ? 'flex min-h-0 flex-1 flex-col md:min-h-[8rem] md:flex-[2]'
          : 'shrink-0';

  return (
    <div className={`${flexClass} ${className}`.trim()}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2 py-2 text-left hover:bg-white/60"
        aria-expanded={open}
      >
        <span className="material-symbols-outlined text-lg text-ink-500">{icon}</span>
        <span className="min-w-0 flex-1 text-sm font-semibold text-ink-600">{title}</span>
        <span className="material-symbols-outlined text-lg text-ink-400">
          {open ? 'expand_more' : 'chevron_right'}
        </span>
      </button>
      {open ? children : null}
    </div>
  );
}

function ThreadListItem() {
  const router = useRouter();
  const modalityNav = useModalityNavOptional();
  const query = useSidebarQuery();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const runtime = useThreadListItemRuntime();
  const title = runtime.getState().title || '';
  const folderCtx = useFolders();
  const remoteId = (runtime.getState() as { remoteId?: string }).remoteId;
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commitRename = useCallback(() => {
    const val = inputRef.current?.value.trim();
    if (val) void runtime.rename(val).catch(() => {});
    setEditing(false);
  }, [runtime]);

  const openChat = useCallback(() => {
    const run = () => router.push(aiSearchHref());
    if (modalityNav) modalityNav.navigateModality('ai', run);
    else run();
    closeMobileSidebar();
  }, [router, modalityNav]);

  // Client-side filter: when a query is active, hide non-matching chats. "New chat"
  // (empty title) stays visible so an in-progress thread isn't hidden mid-compose.
  if (query && title && !title.toLowerCase().includes(query)) return null;
  // Folder filter: when a folder is selected, hide chats not assigned to it.
  if (folderCtx?.activeFolderId && folderCtx.assignments[remoteId ?? ''] !== folderCtx.activeFolderId) return null;

  if (editing) {
    return (
      <ThreadListItemPrimitive.Root className="group mb-0.5 rounded-lg bg-white">
        <form
          className="flex items-center gap-1 px-1.5 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            commitRename();
          }}
        >
          <input
            ref={inputRef}
            defaultValue={title}
            className="min-w-0 flex-1 rounded border border-brand-300 bg-white px-2 py-1 text-sm text-ink-700 outline-none"
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        </form>
      </ThreadListItemPrimitive.Root>
    );
  }

  return (
    <ThreadListItemPrimitive.Root className="group mb-0.5 flex items-center rounded-lg hover:bg-white data-[active]:bg-white">
      <ThreadListItemPrimitive.Trigger
        onClick={openChat}
        className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm leading-5 text-ink-700 group-data-[active]:font-medium group-data-[active]:text-brand-700"
      >
        <ThreadListItemPrimitive.Title fallback="New chat" />
      </ThreadListItemPrimitive.Trigger>
      <div className={`relative mr-1 shrink-0 items-center gap-0.5 ${menuOpen ? 'flex' : 'hidden group-hover:flex group-data-[active]:flex'}`}>
        {folderCtx && remoteId ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="rounded p-0.5 text-ink-400 hover:text-ink-600"
            title="Move to folder"
            aria-label="Move to folder"
          >
            <span className="material-symbols-outlined text-base leading-none">folder</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
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
        {menuOpen && folderCtx && remoteId ? (
          <>
            <button
              type="button"
              aria-hidden
              className="fixed inset-0 z-10 cursor-default"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
              }}
            />
            <div className="absolute right-0 top-7 z-20 w-44 rounded-lg border border-ink-200 bg-white py-1 shadow-lg">
              <p className="px-2 py-1 text-xs font-medium text-ink-400">Move to folder</p>
              {folderCtx.folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    folderCtx.move(remoteId, f.id);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm text-ink-700 hover:bg-ink-50"
                >
                  <span className="material-symbols-outlined text-base">folder</span>
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  {folderCtx.assignments[remoteId] === f.id ? (
                    <span className="material-symbols-outlined text-sm text-brand-600">check</span>
                  ) : null}
                </button>
              ))}
              {folderCtx.folders.length > 0 ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    folderCtx.move(remoteId, null);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 border-t border-ink-100 px-2 py-1 text-left text-sm text-ink-500 hover:bg-ink-50"
                >
                  <span className="material-symbols-outlined text-base">folder_off</span>
                  <span>No folder</span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  folderCtx.create(remoteId);
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 border-t border-ink-100 px-2 py-1 text-left text-sm text-brand-700 hover:bg-ink-50"
              >
                <span className="material-symbols-outlined text-base">create_new_folder</span>
                <span>New folder…</span>
              </button>
            </div>
          </>
        ) : null}
      </div>
    </ThreadListItemPrimitive.Root>
  );
}

function SearchesList({
  activeQ,
  activeModality,
  signedIn,
}: {
  activeQ: string;
  activeModality: string;
  signedIn: boolean;
}) {
  const router = useRouter();
  const modalityNav = useModalityNavOptional();
  const query = useSidebarQuery();
  const [recents, setRecents] = useState<Recent[]>([]);
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => {
    if (!signedIn) {
      setRecents([]);
      return;
    }
    const sync = () => setRecents(getRecents().filter((r) => !isAiModality(r.modality)));
    sync();
    window.addEventListener('hd-recents', sync);
    return () => window.removeEventListener('hd-recents', sync);
  }, [signedIn]);

  const filtered = useMemo(() => {
    if (!query) return recents;
    return recents.filter((r) => r.q.toLowerCase().includes(query));
  }, [recents, query]);

  // Reset the reveal window when the query changes so filtering starts from the top.
  useEffect(() => setVisible(PAGE_SIZE), [query]);

  const openRecent = useCallback(
    (r: Recent) => {
      const mod = asSearchModality(r.modality);
      const href = searchHref({ q: r.q, modality: r.modality });
      const run = () => router.push(href);
      if (modalityNav) modalityNav.navigateModality(mod, run);
      else run();
      closeMobileSidebar();
    },
    [router, modalityNav],
  );

  if (!signedIn) {
    return <p className="px-3 pb-1 text-sm text-ink-400">Sign in to save and view search history.</p>;
  }
  if (filtered.length === 0) {
    return <p className="px-3 pb-1 text-sm text-ink-400">{query ? 'No matching searches.' : 'No recent searches.'}</p>;
  }

  const shown = filtered.slice(0, visible);
  const hasMore = filtered.length > shown.length;

  return (
    <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1 pb-1">
      {shown.map((r) => {
        const on = r.q === activeQ && r.modality === activeModality;
        return (
          <li key={`${r.modality}:${r.q}:${r.ts}`} className="group flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => openRecent(r)}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink-700 hover:bg-white ${on ? 'bg-white font-medium text-brand-700' : ''}`}
            >
              <span className="min-w-0 flex-1 truncate">{r.q}</span>
              <SearchModalityIcon modality={r.modality} className="ml-auto" />
            </button>
            <HistoryDeleteButton
              onClick={() => removeRecent(r.q, r.modality)}
              className="hidden group-hover:inline-flex"
            />
          </li>
        );
      })}
      {hasMore ? <InfiniteSentinel enabled onHit={() => setVisible((v) => v + PAGE_SIZE)} /> : null}
    </ul>
  );
}

/**
 * AI Search chat list — same "top 10 + infinite scroll" behavior as the Search list,
 * for consistency. assistant-ui's ThreadListPrimitive.Items owns rendering (so thread
 * activation/rename/delete keep working); we cap the *visible* count by hiding items
 * beyond `visible` with a scoped nth-child rule, and grow on scroll via the same
 * sentinel the Search list uses. Query/folder filters remove items from the DOM
 * (return null), so the cap always applies to the filtered set.
 */
function AiThreadList({ signedIn }: { signedIn: boolean }) {
  const query = useSidebarQuery();
  const folderCtx = useFolders();
  const [visible, setVisible] = useState(PAGE_SIZE);
  const listId = 'ail-' + useId().replace(/[^a-zA-Z0-9]/g, '');

  // Reset the reveal window whenever the filter changes (start from the top).
  useEffect(() => setVisible(PAGE_SIZE), [query, folderCtx?.activeFolderId]);

  if (!signedIn) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="px-1 pb-2 text-sm text-ink-400">Sign in to save and view chat history.</p>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <style>{`[data-hds-ai-list="${listId}"] > *:nth-child(n+${visible + 1}){display:none !important}`}</style>
      <div data-hds-ai-list={listId}>
        <ThreadListPrimitive.Items>{() => <ThreadListItem />}</ThreadListPrimitive.Items>
      </div>
      <InfiniteSentinel enabled onHit={() => setVisible((v) => v + PAGE_SIZE)} />
    </div>
  );
}

export function ExperienceLeftSidebar({
  activeQ,
  activeModality,
  signedIn,
  onClose,
}: {
  activeQ: string;
  activeModality: string;
  signedIn: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const modalityNav = useModalityNavOptional();
  const [searchOpen, setSearchOpen] = useState(() => readSectionOpen(SEARCH_SECTION_KEY));
  const [chatOpen, setChatOpen] = useState(() => readSectionOpen(CHAT_SECTION_KEY));
  const [rawQuery, setRawQuery] = useState('');
  const [query, setQuery] = useState(''); // debounced, lower-cased

  // Debounce the query so typing doesn't thrash the two filtered lists.
  useEffect(() => {
    const t = setTimeout(() => setQuery(rawQuery.trim().toLowerCase()), 140);
    return () => clearTimeout(t);
  }, [rawQuery]);

  // ---- chat folders ----
  const [folders, setFolders] = useState<Folder[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setFolders([]);
      setAssignments({});
      return;
    }
    let alive = true;
    void fetchChatFolders().then((s) => {
      if (alive) {
        setFolders(s.folders);
        setAssignments(s.assignments);
      }
    });
    return () => {
      alive = false;
    };
  }, [signedIn]);

  const moveThread = useCallback((threadId: string, folderId: string | null) => {
    setAssignments((m) => {
      const next = { ...m };
      if (folderId) next[threadId] = folderId;
      else delete next[threadId];
      return next;
    });
    void assignThreadFolder(threadId, folderId);
  }, []);

  const handleCreateFolder = useCallback(
    async (threadId?: string) => {
      const name = typeof window !== 'undefined' ? window.prompt('New folder name')?.trim() : '';
      if (!name) return;
      const f = await createFolder(name);
      if (!f) return;
      setFolders((prev) => [...prev, f]);
      if (threadId) moveThread(threadId, f.id);
    },
    [moveThread],
  );

  const handleDeleteFolder = useCallback(async (id: string) => {
    await deleteFolderApi(id);
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setAssignments((m) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) if (v !== id) next[k] = v;
      return next;
    });
    setActiveFolderId((cur) => (cur === id ? null : cur));
  }, []);

  const folderCtxValue = useMemo<FolderCtxValue>(
    () => ({ folders, assignments, activeFolderId, move: moveThread, create: handleCreateFolder }),
    [folders, assignments, activeFolderId, moveThread, handleCreateFolder],
  );

  const toggleSearch = useCallback(() => {
    setSearchOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(SEARCH_SECTION_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleChat = useCallback(() => {
    setChatOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(CHAT_SECTION_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const newSearch = useCallback(() => {
    const mod = asSearchModality(isAiModality(activeModality) ? 'web' : activeModality);
    const href = searchHref({ modality: mod });
    const run = () => router.push(href);
    if (modalityNav) modalityNav.navigateModality(mod, run);
    else run();
    closeMobileSidebar();
  }, [router, activeModality, modalityNav]);

  const newChat = useCallback(() => {
    resetForNewChat(); // wipe the compose tray so uploads never leak into a new chat
    const run = () => router.replace(aiSearchHref());
    if (modalityNav) modalityNav.navigateModality('ai', run);
    else run();
    closeMobileSidebar();
  }, [router, modalityNav]);

  // While searching, force both sections open so matches from either are visible.
  const searchActive = query.length > 0;
  const effSearchOpen = searchActive || searchOpen;
  const effChatOpen = searchActive || chatOpen;
  const searchFlex = !effSearchOpen ? 'none' : effChatOpen ? 'share-sm' : 'fill';
  const chatFlex = !effChatOpen ? 'none' : effSearchOpen ? 'share-lg' : 'fill';

  return (
    <SidebarQueryContext.Provider value={query}>
     <FolderContext.Provider value={folderCtxValue}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Collapse row: unified search input on the same line, BEFORE the '<' hide button. */}
        <div className="flex items-center gap-1.5 border-b border-ink-100 px-2 py-1.5 shrink-0">
          <div className="relative min-w-0 flex-1">
            <span className="material-symbols-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-base text-ink-400">
              search
            </span>
            <input
              type="search"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              placeholder="Search chats…"
              aria-label="Search chats"
              className="w-full rounded-lg border border-ink-200 bg-white py-1.5 pl-8 pr-7 text-sm text-ink-700 outline-none placeholder:text-ink-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
            {rawQuery ? (
              <button
                type="button"
                onClick={() => setRawQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-400 hover:text-ink-600"
                title="Clear search"
                aria-label="Clear search"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="hidden shrink-0 rounded p-1 text-ink-400 hover:bg-white hover:text-ink-600 md:inline-flex"
            title="Hide sidebar"
            aria-label="Hide sidebar"
          >
            <span className="material-symbols-outlined text-xl">chevron_left</span>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <CollapsibleSection title="Search" icon="search_activity" open={effSearchOpen} onToggle={toggleSearch} flex={searchFlex}>
            {!searchActive ? (
              <button
                type="button"
                onClick={newSearch}
                className="mx-2 mb-1.5 w-[calc(100%-1rem)] shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:border-brand-300"
              >
                + New search
              </button>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <SearchesList activeQ={activeQ} activeModality={activeModality} signedIn={signedIn} />
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="AI Search"
            icon="mark_chat_read"
            open={effChatOpen}
            onToggle={toggleChat}
            flex={chatFlex}
            className="border-t border-ink-100"
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <ThreadListPrimitive.Root className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2">
                {!searchActive ? (
                  <ThreadListPrimitive.New
                    onClick={newChat}
                    className="mb-2 w-full shrink-0 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 hover:border-brand-300"
                  >
                    + New chat
                  </ThreadListPrimitive.New>
                ) : null}
                {/* Folder chips only appear once the user has folders — so by default the
                    AI Search list is identical to the Search list (no "All", no deviation).
                    Toggling the active folder off shows all chats. Create via a chat's menu. */}
                {signedIn && !searchActive && folders.length > 0 ? (
                  <div className="mb-2 flex flex-wrap items-center gap-1">
                    {folders.map((f) => (
                      <span key={f.id} className="inline-flex items-center">
                        <button
                          type="button"
                          onClick={() => setActiveFolderId((cur) => (cur === f.id ? null : f.id))}
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${activeFolderId === f.id ? 'bg-brand-100 text-brand-700' : 'bg-ink-50 text-ink-500 hover:bg-ink-100'}`}
                          title={f.name}
                        >
                          <span className="material-symbols-outlined text-sm leading-none">folder</span>
                          <span className="max-w-[7rem] truncate">{f.name}</span>
                        </button>
                        {activeFolderId === f.id ? (
                          <button
                            type="button"
                            onClick={() => void handleDeleteFolder(f.id)}
                            className="ml-0.5 rounded p-0.5 text-ink-400 hover:text-red-500"
                            title="Delete folder"
                            aria-label={`Delete folder ${f.name}`}
                          >
                            <span className="material-symbols-outlined text-sm leading-none">delete</span>
                          </button>
                        ) : null}
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() => void handleCreateFolder()}
                      className="inline-flex items-center gap-0.5 rounded-full bg-ink-50 px-2 py-0.5 text-xs font-medium text-ink-500 hover:bg-ink-100"
                      title="New folder"
                    >
                      <span className="material-symbols-outlined text-sm leading-none">create_new_folder</span>
                    </button>
                  </div>
                ) : null}
                <AiThreadList signedIn={signedIn} />
              </ThreadListPrimitive.Root>
            </div>
          </CollapsibleSection>
        </div>
      </div>
     </FolderContext.Provider>
    </SidebarQueryContext.Provider>
  );
}
