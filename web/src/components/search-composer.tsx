'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { pushRecent } from '@/lib/recents';
import { COMPOSER_MODALITIES, MODALITY_META, modalityTitle } from '@/lib/search-modality-meta';
import { searchHref } from '@/lib/search-routes';
import { CenteredComposerShell } from './centered-composer-shell';
import { useSearchExperience } from './search-experience-context';
import { SearchEnginePicker } from './search-engine-picker';
import { ComposerSelect } from './composer-select';
import { SearchComposerDisclaimer } from './search-composer-disclaimer';
import { SearchComposerSettings } from './search-composer-settings';

/** Match AI chat composer width (`AiSearchComposer`). */
const COMPOSER_WIDTH = 'max-w-3xl';

export function SearchComposer({
  modality,
  q = '',
  centered = false,
  pending: pendingProp,
  onNavigate,
}: {
  modality: string;
  q?: string;
  centered?: boolean;
  pending?: boolean;
  onNavigate?: (run: () => void) => void;
}) {
  const router = useRouter();
  const [navPending, startTransition] = useTransition();
  const pending = pendingProp ?? navPending;
  const [text, setText] = useState(q);
  const [selectedModality, setSelectedModality] = useState(modality);
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    searchDepth,
    engineOverride,
    setEngineOverride,
    engines,
    temporary,
    signedIn,
  } = useSearchExperience();

  useEffect(() => {
    setText(q);
  }, [q]);

  useEffect(() => {
    setSelectedModality(modality);
  }, [modality]);

  function go(run: () => void) {
    if (onNavigate) onNavigate(run);
    else startTransition(run);
  }

  function submit() {
    const nextQ = text.trim();
    if (!nextQ) return;
    const mod = selectedModality;
    if (signedIn && !temporary && mod !== 'ai') pushRecent(nextQ, mod);
    if (signedIn && !temporary && mod === 'ai') pushRecent(nextQ, 'ai');
    const sp = new URLSearchParams({ q: nextQ, modality: mod });
    if (mod !== 'ai' && searchDepth !== 'low') sp.set('depth', searchDepth);
    if (mod !== 'ai' && engineOverride) sp.set('engine', engineOverride);
    if (temporary && signedIn) sp.set('temporary', '1');
    go(() => router.push(searchHref(sp)));
  }

  const isAiModality = selectedModality === 'ai';

  const box = (
    <div className="relative w-full overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm ring-1 ring-ink-100 focus-within:border-brand-400 focus-within:ring-brand-200">
      {pending && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-0.5 overflow-hidden">
          <div className="hd-progress h-full w-full bg-brand-500" />
        </div>
      )}
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={centered ? '' : isAiModality ? 'Ask Anything' : 'Search anything'}
        className="min-h-[52px] w-full bg-transparent px-4 py-3.5 text-base leading-6 outline-none"
      />
      <div className="flex items-center justify-between gap-2 border-t border-ink-100 px-2 py-2 sm:px-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          {!isAiModality && (
            <>
              <SearchEnginePicker engines={engines} value={engineOverride} onChange={setEngineOverride} />
              <SearchComposerSettings />
            </>
          )}
          <ComposerSelect
            value={selectedModality}
            onChange={setSelectedModality}
            title={modalityTitle(selectedModality)}
            ariaLabel="Search category"
            className="max-w-[8.5rem] sm:max-w-[10rem]"
          >
            {COMPOSER_MODALITIES.map((m) => (
              <option key={m} value={m}>
                {MODALITY_META[m].label}
              </option>
            ))}
          </ComposerSelect>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !text.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          title={isAiModality ? 'Send message' : 'Search'}
          aria-label={isAiModality ? 'Send message' : 'Search'}
        >
          {isAiModality ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M8 12V4" />
              <path d="M4 7l4-4 4 4" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3-3" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );

  if (centered) {
    return (
      <CenteredComposerShell title="Search anything">
        {box}
        <SearchComposerDisclaimer className="mt-3" />
      </CenteredComposerShell>
    );
  }

  return (
    <div
      className={`mx-auto w-full ${COMPOSER_WIDTH} px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2`}
    >
      {box}
      <SearchComposerDisclaimer className="mt-3" />
    </div>
  );
}
