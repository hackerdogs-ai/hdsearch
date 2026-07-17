'use client';

import '@/styles/material-symbols.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { llmProviderLabel } from '@/lib/llm-provider-labels';
import {
  AiSearchProvider,
  pickDefaultModel,
  SHOW_STEPS_KEY,
  SOURCE_DETAILS_PREF_KEY,
  TEMPORARY_DEFAULT_KEY,
  usePersistModelOverride,
  type AiSearchLayout,
  type AiSourceDetails,
} from './ai-search-context';
import { AiSearchRuntime } from './ai-search-runtime';
import { AiSearchThread } from './ai-search-thread';
import { AiThreadSidebar } from './ai-thread-sidebar';
import { AiPageHeader } from './ai-page-header';
import type { ModelInfo } from './types';

const SIDEBAR_KEY = 'hds_ai_sidebar_open';

const SOURCE_DETAILS_OPTIONS: { value: AiSourceDetails; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

function readSidebarDefault(layout: AiSearchLayout): boolean {
  if (typeof window === 'undefined') return layout !== 'fullscreen';
  try {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved != null) return saved !== '0';
  } catch {
    /* ignore */
  }
  if (layout === 'fullscreen' && window.matchMedia('(max-width: 767px)').matches) return false;
  return true;
}

export function AiSearchPanel({
  initialQuery = '',
  signedIn = false,
  signInRequiredForAi = true,
  layout = 'embedded',
  headerUser,
  children,
}: {
  initialQuery?: string;
  signedIn?: boolean;
  signInRequiredForAi?: boolean;
  layout?: AiSearchLayout;
  headerUser?: { name?: string | null; email?: string | null; picture?: string | null };
  /** When set, only provides AI context/runtime — shell supplies chrome. */
  children?: React.ReactNode;
}) {
  // Deep-link support for the dashboard "AI conversations" section — the link lands
  // at /search?modality=ai&thread=<id>. Only honored on first render; after that the
  // sidebar owns thread switching.
  const searchParamsHook = useSearchParams();
  const initialThreadId = searchParamsHook?.get('thread') || undefined;
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelOverride, setModelOverrideState] = useState('');
  const [modelsReady, setModelsReady] = useState(false);
  const [showSteps, setShowStepsState] = useState(true);
  const [sourceDetails, setSourceDetailsState] = useState<AiSourceDetails>('low');
  const [temporary, setTemporaryState] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => readSidebarDefault(layout));
  const persistModel = usePersistModelOverride();

  useEffect(() => {
    fetch('/api/ai/models')
      .then(async (r) => {
        if (!r.ok) throw new Error('models fetch failed');
        return r.json();
      })
      .then((j) => {
        const list: ModelInfo[] = j.models || [];
        setModels(list);
        const picked = pickDefaultModel(list, j.default);
        setModelOverrideState(picked);
        if (picked) persistModel(picked);
        setModelsReady(true);
      })
      .catch(() => setModelsReady(true));

    try {
      const savedSteps = window.localStorage.getItem(SHOW_STEPS_KEY);
      if (savedSteps != null) setShowStepsState(savedSteps === '1');
      const savedDetails = window.localStorage.getItem(SOURCE_DETAILS_PREF_KEY) as AiSourceDetails | null;
      if (savedDetails && SOURCE_DETAILS_OPTIONS.some((o) => o.value === savedDetails)) {
        setSourceDetailsState(savedDetails);
      }
      if (signedIn) {
        const savedTemporary = window.localStorage.getItem(TEMPORARY_DEFAULT_KEY);
        if (savedTemporary === '1') {
          setTemporaryState(true);
        } else {
          setTemporaryState(false);
          if (savedTemporary == null) {
            window.localStorage.setItem(TEMPORARY_DEFAULT_KEY, '0');
          }
        }
      } else {
        setTemporaryState(true);
      }
    } catch {
      /* ignore */
    }
  }, [persistModel, signedIn]);

  const setModelOverride = useCallback(
    (id: string) => {
      const m = models.find((x) => x.id === id);
      if (m && !m.available) return;
      setModelOverrideState(id);
      persistModel(id);
    },
    [models, persistModel],
  );

  const setShowSteps = useCallback((v: boolean) => {
    setShowStepsState(v);
    try {
      window.localStorage.setItem(SHOW_STEPS_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const setSourceDetails = useCallback((d: AiSourceDetails) => {
    setSourceDetailsState(d);
    try {
      window.localStorage.setItem(SOURCE_DETAILS_PREF_KEY, d);
    } catch {
      /* ignore */
    }
  }, []);

  const setTemporary = useCallback(
    (v: boolean) => {
      if (!signedIn) return;
      setTemporaryState(v);
      try {
        window.localStorage.setItem(TEMPORARY_DEFAULT_KEY, v ? '1' : '0');
      } catch {
        /* ignore */
      }
    },
    [signedIn],
  );

  const setSidebarOpenPersisted = useCallback((v: boolean) => {
    setSidebarOpen(v);
    try {
      localStorage.setItem(SIDEBAR_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const effectiveTemporary = signedIn ? temporary : true;

  const groupedModels = useMemo(() => {
    const by = new Map<string, ModelInfo[]>();
    for (const m of models) {
      if (!by.has(m.provider)) by.set(m.provider, []);
      by.get(m.provider)!.push(m);
    }
    return [...by.entries()].sort(([, a], [, b]) =>
      llmProviderLabel(a[0]!.provider, a[0]!.providerLabel).localeCompare(
        llmProviderLabel(b[0]!.provider, b[0]!.providerLabel),
      ),
    );
  }, [models]);

  const shellClass =
    layout === 'fullscreen'
      ? 'flex min-h-0 flex-1 overflow-hidden bg-white'
      : 'flex h-[72vh] min-h-[420px] overflow-hidden rounded-xl border border-ink-100 bg-white shadow-sm';

  const rootClass =
    layout === 'fullscreen'
      ? 'flex h-dvh min-h-0 flex-col overflow-hidden bg-white'
      : undefined;

  const providerValue = {
    layout,
    models,
    groupedModels,
    modelsReady,
    modelOverride,
    setModelOverride,
    showSteps,
    setShowSteps,
    sourceDetails,
    setSourceDetails,
    temporary: effectiveTemporary,
    setTemporary,
    signedIn,
    signInRequiredForAi,
    sidebarOpen,
    setSidebarOpen: setSidebarOpenPersisted,
  };

  if (children != null) {
    return (
      <AiSearchProvider {...providerValue}>
        <AiSearchRuntime initialThreadId={initialThreadId}>{children}</AiSearchRuntime>
      </AiSearchProvider>
    );
  }

  return (
    <AiSearchProvider {...providerValue}>
      {layout === 'fullscreen' ? (
        <div className={rootClass}>
          <AiPageHeader signedIn={signedIn} user={headerUser} initialQuery={initialQuery} />
          <AiSearchRuntime initialThreadId={initialThreadId}>
            <div className={shellClass}>
              <AiThreadSidebar />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex min-h-0 flex-1 flex-col px-2 sm:px-4">
                  <AiSearchThread initialQuery={initialQuery} />
                </div>
              </div>
            </div>
          </AiSearchRuntime>
        </div>
      ) : (
        <AiSearchRuntime initialThreadId={initialThreadId}>
          <div className={shellClass}>
            <AiThreadSidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex min-h-0 flex-1 flex-col px-4">
                <AiSearchThread initialQuery={initialQuery} />
              </div>
            </div>
          </div>
        </AiSearchRuntime>
      )}
    </AiSearchProvider>
  );
}
