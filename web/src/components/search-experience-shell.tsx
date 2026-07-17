'use client';

import '@/styles/material-symbols.css';
import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import { isAiModality } from '@/lib/ai-routes';
import { parseSearchDepth, type SearchDepth } from '@/lib/search-depth';
import { ModalityNavProvider } from '@/components/modality-nav-context';
import { AiSearchPanel } from '@/components/ai/ai-search-panel';
import { AiSearchThread } from '@/components/ai/ai-search-thread';
import { ExperienceHeader } from '@/components/experience-header';
import { ExperienceLeftSidebar } from '@/components/experience-left-sidebar';
import { ResizableExperienceSidebar } from '@/components/resizable-experience-sidebar';
import { SearchComposer } from '@/components/search-composer';
import {
  EXPERIENCE_SIDEBAR_KEY,
  SEARCH_DEPTH_PREF_KEY,
  SEARCH_ENGINE_KEY,
  SEARCH_TEMPORARY_KEY,
  SearchExperienceProvider,
  type SearchEngineInfo,
} from '@/components/search-experience-context';

function readSidebarDefault(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const saved = localStorage.getItem(EXPERIENCE_SIDEBAR_KEY);
    if (saved != null) return saved !== '0';
  } catch {
    /* ignore */
  }
  return !window.matchMedia('(max-width: 767px)').matches;
}

export function SearchExperienceShell({
  modality,
  q,
  depth: depthParam,
  engine: engineParam,
  temporary: temporaryParam,
  signedIn,
  signInRequiredForAi = true,
  user,
  initialQuery,
  children,
}: {
  modality: string;
  q: string;
  depth?: string;
  engine?: string;
  temporary?: boolean;
  signedIn: boolean;
  signInRequiredForAi?: boolean;
  user?: { name?: string | null; email?: string | null; picture?: string | null };
  initialQuery?: string;
  children: ReactNode;
}) {
  const isAi = isAiModality(modality);
  const [navPending, startTransition] = useTransition();
  const [sidebarOpen, setSidebarOpenState] = useState(readSidebarDefault);
  const [searchDepth, setSearchDepthState] = useState<SearchDepth>(() => parseSearchDepth(depthParam));
  const [engineOverride, setEngineOverrideState] = useState(engineParam || '');
  const [temporary, setTemporaryState] = useState(() =>
    temporaryParam != null ? temporaryParam : false,
  );
  const [engines, setEngines] = useState<SearchEngineInfo[]>([]);
  const [enginesReady, setEnginesReady] = useState(false);

  const setSidebarOpen = useCallback((v: boolean) => {
    setSidebarOpenState(v);
    try {
      localStorage.setItem(EXPERIENCE_SIDEBAR_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const close = () => setSidebarOpen(false);
    window.addEventListener('hds-close-sidebar', close);
    return () => window.removeEventListener('hds-close-sidebar', close);
  }, [setSidebarOpen]);

  useEffect(() => {
    setSearchDepthState(parseSearchDepth(depthParam));
    setEngineOverrideState(engineParam || '');
    if (temporaryParam != null) setTemporaryState(temporaryParam);
  }, [depthParam, engineParam, temporaryParam, modality, q]);

  useEffect(() => {
    try {
      const savedDepth = localStorage.getItem(SEARCH_DEPTH_PREF_KEY) as SearchDepth | null;
      if (savedDepth === 'low' || savedDepth === 'medium' || savedDepth === 'high') {
        setSearchDepthState(savedDepth);
      }
      const savedEngine = localStorage.getItem(SEARCH_ENGINE_KEY);
      if (savedEngine && !engineParam) setEngineOverrideState(savedEngine);
      if (signedIn) {
        const savedTemporary = localStorage.getItem(SEARCH_TEMPORARY_KEY);
        if (temporaryParam == null) {
          if (savedTemporary === '1') {
            setTemporaryState(true);
          } else {
            setTemporaryState(false);
            if (savedTemporary == null) {
              localStorage.setItem(SEARCH_TEMPORARY_KEY, '0');
            }
          }
        }
      } else {
        setTemporaryState(true);
      }
    } catch {
      /* ignore */
    }
  }, [signedIn, engineParam, temporaryParam]);

  useEffect(() => {
    if (isAi) return;
    setEnginesReady(false);
    fetch(`/api/engines?modality=${encodeURIComponent(modality)}`)
      .then((r) => r.json())
      .then((j) => {
        setEngines(j.engines || []);
        setEnginesReady(true);
      })
      .catch(() => setEnginesReady(true));
  }, [modality, isAi]);

  const setSearchDepth = useCallback((d: SearchDepth) => {
    setSearchDepthState(d);
    try {
      localStorage.setItem(SEARCH_DEPTH_PREF_KEY, d);
    } catch {
      /* ignore */
    }
  }, []);

  const setEngineOverride = useCallback((id: string) => {
    const e = engines.find((x) => x.id === id);
    if (e && !e.available) return;
    setEngineOverrideState(id);
    try {
      if (id) localStorage.setItem(SEARCH_ENGINE_KEY, id);
      else localStorage.removeItem(SEARCH_ENGINE_KEY);
    } catch {
      /* ignore */
    }
  }, [engines]);

  const setTemporary = useCallback(
    (v: boolean) => {
      if (!signedIn) return;
      setTemporaryState(v);
      try {
        localStorage.setItem(SEARCH_TEMPORARY_KEY, v ? '1' : '0');
      } catch {
        /* ignore */
      }
    },
    [signedIn],
  );

  const effectiveTemporary = signedIn ? temporary : true;

  const searchCtx = useMemo(
    () => ({
      searchDepth,
      setSearchDepth,
      engineOverride,
      setEngineOverride,
      engines,
      enginesReady,
      temporary: effectiveTemporary,
      setTemporary,
      signedIn,
      sidebarOpen,
      setSidebarOpen,
    }),
    [
      searchDepth,
      setSearchDepth,
      engineOverride,
      setEngineOverride,
      engines,
      enginesReady,
      effectiveTemporary,
      setTemporary,
      signedIn,
      sidebarOpen,
      setSidebarOpen,
    ],
  );

  const shellBody = (
    <ModalityNavProvider
      activeModality={modality}
      navPending={navPending}
      onNavigate={(run) => startTransition(run)}
    >
      <SearchExperienceProvider value={searchCtx}>
        <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-white">
        <ExperienceHeader
          modality={modality}
          query={q || initialQuery}
          signedIn={signedIn}
          user={user}
          pending={navPending}
          onNavigate={(run) => startTransition(run)}
        />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {!sidebarOpen && (
            <div className="hidden shrink-0 flex-col border-r border-ink-100 bg-ink-50/80 py-2 pr-1 md:flex">
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="rounded-lg p-2 text-ink-500 hover:bg-white hover:text-ink-700"
                title="Show sidebar"
                aria-label="Show sidebar"
              >
                <span className="material-symbols-outlined text-xl">chevron_right</span>
              </button>
            </div>
          )}

          {sidebarOpen && (
            <ResizableExperienceSidebar onClose={() => setSidebarOpen(false)}>
              <ExperienceLeftSidebar
                activeQ={q}
                activeModality={modality}
                signedIn={signedIn}
                onClose={() => setSidebarOpen(false)}
              />
            </ResizableExperienceSidebar>
          )}

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {isAi ? (
              <AiSearchThread initialQuery={initialQuery ?? q} centeredEmpty />
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {q ? (
                    <div className="mx-auto w-full max-w-6xl px-4 py-6">{children}</div>
                  ) : (
                    <div className="flex min-h-full flex-1 flex-col">
                      <SearchComposer
                        modality={modality}
                        centered
                        pending={navPending}
                        onNavigate={(run) => startTransition(run)}
                      />
                    </div>
                  )}
                </div>
                {q ? (
                  <SearchComposer
                    modality={modality}
                    q={q}
                    pending={navPending}
                    onNavigate={(run) => startTransition(run)}
                  />
                ) : null}
              </>
            )}
          </main>
        </div>
      </div>
      </SearchExperienceProvider>
    </ModalityNavProvider>
  );

  return (
    <AiSearchPanel
      signedIn={signedIn}
      signInRequiredForAi={signInRequiredForAi}
      layout="fullscreen"
      initialQuery={initialQuery ?? q}
    >
      {shellBody}
    </AiSearchPanel>
  );
}
