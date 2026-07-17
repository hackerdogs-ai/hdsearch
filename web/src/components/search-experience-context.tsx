'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SearchDepth } from '@/lib/search-depth';

export const SEARCH_DEPTH_PREF_KEY = 'hds_search_depth';
export const SEARCH_TEMPORARY_KEY = 'hds_search_temporary';
export const SEARCH_ENGINE_KEY = 'hds_search_engine';
export const EXPERIENCE_SIDEBAR_KEY = 'hds_experience_sidebar_open';

export type SearchEngineInfo = {
  id: string;
  label: string;
  available: boolean;
  requiresKeys?: string[];
  accessType?: string;
};

type SearchExperienceContextValue = {
  searchDepth: SearchDepth;
  setSearchDepth: (d: SearchDepth) => void;
  engineOverride: string;
  setEngineOverride: (id: string) => void;
  engines: SearchEngineInfo[];
  enginesReady: boolean;
  temporary: boolean;
  setTemporary: (v: boolean) => void;
  signedIn: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
};

const SearchExperienceContext = createContext<SearchExperienceContextValue | null>(null);

export function SearchExperienceProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: SearchExperienceContextValue;
}) {
  return <SearchExperienceContext.Provider value={value}>{children}</SearchExperienceContext.Provider>;
}

export function useSearchExperience(): SearchExperienceContextValue {
  const ctx = useContext(SearchExperienceContext);
  if (!ctx) throw new Error('useSearchExperience must be used within SearchExperienceProvider');
  return ctx;
}

export function useSearchExperienceOptional(): SearchExperienceContextValue | null {
  return useContext(SearchExperienceContext);
}
