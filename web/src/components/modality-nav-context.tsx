'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { SearchModality } from '@/components/search-modality-nav';

const MIN_LOADING_MS = 400;

type ModalityNavContextValue = {
  targetModality: SearchModality | null;
  navigateModality: (modality: SearchModality, run: () => void) => void;
  modalityNavBusy: boolean;
};

const ModalityNavContext = createContext<ModalityNavContextValue | null>(null);

export function ModalityNavProvider({
  activeModality,
  navPending,
  onNavigate,
  children,
}: {
  activeModality: string;
  navPending: boolean;
  onNavigate: (run: () => void) => void;
  children: ReactNode;
}) {
  const [targetModality, setTargetModality] = useState<SearchModality | null>(null);
  const loadingSinceRef = useRef<number | null>(null);

  const navigateModality = useCallback(
    (modality: SearchModality, run: () => void) => {
      loadingSinceRef.current = Date.now();
      setTargetModality(modality);
      onNavigate(run);
    },
    [onNavigate],
  );

  useEffect(() => {
    if (!targetModality || navPending) return;
    if (activeModality !== targetModality) return;

    const elapsed = loadingSinceRef.current ? Date.now() - loadingSinceRef.current : MIN_LOADING_MS;
    const delay = Math.max(0, MIN_LOADING_MS - elapsed);
    const t = window.setTimeout(() => {
      setTargetModality(null);
      loadingSinceRef.current = null;
    }, delay);
    return () => window.clearTimeout(t);
  }, [activeModality, targetModality, navPending]);

  return (
    <ModalityNavContext.Provider
      value={{
        targetModality,
        navigateModality,
        modalityNavBusy: targetModality != null,
      }}
    >
      {children}
    </ModalityNavContext.Provider>
  );
}

export function useModalityNavOptional(): ModalityNavContextValue | null {
  return useContext(ModalityNavContext);
}
