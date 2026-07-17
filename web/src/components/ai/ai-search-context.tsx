'use client';

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import type { GroupedModels, ModelInfo } from './types';

export const AUTO_SELECT_ENABLED = false;
export const MODEL_PREF_KEY = 'hds_ai_model';
export const SHOW_STEPS_KEY = 'hds_ai_show_steps';
export const SOURCE_DETAILS_PREF_KEY = 'hds_ai_source_details';
/** Per-tab preference: does a new chat start in Temporary mode by default? */
export const TEMPORARY_DEFAULT_KEY = 'hds_ai_temporary_default';

/** How much source text is passed to the model after a search (RAG depth). */
export type AiSourceDetails = 'low' | 'medium' | 'high';

export type AiSearchLayout = 'embedded' | 'fullscreen';

export type AiSearchContextValue = {
  layout: AiSearchLayout;
  models: ModelInfo[];
  groupedModels: GroupedModels;
  modelsReady: boolean;
  modelOverride: string;
  setModelOverride: (id: string) => void;
  showSteps: boolean;
  setShowSteps: (v: boolean) => void;
  sourceDetails: AiSourceDetails;
  setSourceDetails: (d: AiSourceDetails) => void;
  temporary: boolean;
  setTemporary: (v: boolean) => void;
  signedIn: boolean;
  signInRequiredForAi: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  modelOverrideRef: React.MutableRefObject<string>;
  showStepsRef: React.MutableRefObject<boolean>;
  sourceDetailsRef: React.MutableRefObject<AiSourceDetails>;
  temporaryRef: React.MutableRefObject<boolean>;
};

const AiSearchContext = createContext<AiSearchContextValue | null>(null);

export function AiSearchProvider({
  children,
  layout = 'embedded',
  models,
  groupedModels,
  modelsReady,
  modelOverride,
  setModelOverride,
  showSteps,
  setShowSteps,
  sourceDetails,
  setSourceDetails,
  temporary,
  setTemporary,
  signedIn,
  signInRequiredForAi,
  sidebarOpen,
  setSidebarOpen,
}: {
  children: ReactNode;
  layout?: AiSearchLayout;
  models: ModelInfo[];
  groupedModels: GroupedModels;
  modelsReady: boolean;
  modelOverride: string;
  setModelOverride: (id: string) => void;
  showSteps: boolean;
  setShowSteps: (v: boolean) => void;
  sourceDetails: AiSourceDetails;
  setSourceDetails: (d: AiSourceDetails) => void;
  temporary: boolean;
  setTemporary: (v: boolean) => void;
  signedIn: boolean;
  signInRequiredForAi: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
}) {
  const modelOverrideRef = useRef(modelOverride);
  modelOverrideRef.current = modelOverride;
  const showStepsRef = useRef(showSteps);
  showStepsRef.current = showSteps;
  const sourceDetailsRef = useRef(sourceDetails);
  sourceDetailsRef.current = sourceDetails;
  const temporaryRef = useRef(temporary);
  temporaryRef.current = temporary;

  const value = useMemo(
    () => ({
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
      temporary,
      setTemporary,
      signedIn,
      signInRequiredForAi,
      sidebarOpen,
      setSidebarOpen,
      modelOverrideRef,
      showStepsRef,
      sourceDetailsRef,
      temporaryRef,
    }),
    [
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
      temporary,
      setTemporary,
      signedIn,
      signInRequiredForAi,
      sidebarOpen,
      setSidebarOpen,
    ],
  );

  return <AiSearchContext.Provider value={value}>{children}</AiSearchContext.Provider>;
}

export function useAiSearch() {
  const ctx = useContext(AiSearchContext);
  if (!ctx) throw new Error('useAiSearch must be used within AiSearchProvider');
  return ctx;
}

export function pickDefaultModel(list: ModelInfo[], preferredId?: string): string {
  if (AUTO_SELECT_ENABLED) return '';
  const saved = typeof window !== 'undefined' ? window.localStorage.getItem(MODEL_PREF_KEY) : null;
  const candidates = [saved, preferredId].filter(Boolean) as string[];
  for (const id of candidates) {
    const hit = list.find((m) => m.id === id && m.available);
    if (hit) return hit.id;
  }
  return list.find((m) => m.available)?.id || '';
}

export function usePersistModelOverride() {
  const persist = useCallback((id: string) => {
    try {
      if (id) window.localStorage.setItem(MODEL_PREF_KEY, id);
      else window.localStorage.removeItem(MODEL_PREF_KEY);
    } catch {
      /* ignore */
    }
  }, []);
  return persist;
}
