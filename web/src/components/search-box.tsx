'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { pushRecent } from '@/lib/recents';
import { aiSearchHref } from '@/lib/ai-routes';
import { searchHref } from '@/lib/search-routes';
import { RecentsDropdown } from './recents-dropdown';

const MODALITIES = [
  'web', 'news', 'images', 'videos', 'maps', 'scholar', 'code', 'social', 'archive', 'darkweb', 'ai',
];

// The default home search box + the results-page search bar. Navigates to `/`
// with the query so results render as a server component (SSR + shareable URLs).
export function SearchBox({ size = 'lg', defaultModality = 'web' }: { size?: 'lg' | 'sm'; defaultModality?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [modality, setModality] = useState(params.get('modality') || defaultModality);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function run(query: string, mod: string) {
    if (!query.trim()) return;
    pushRecent(query.trim(), mod);
    if (mod === 'ai') {
      router.push(aiSearchHref(query.trim()));
      return;
    }
    router.push(searchHref({ q: query.trim(), modality: mod }));
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(q, modality);
  }

  return (
    <form onSubmit={submit} className="relative w-full">
      <div
        className={`flex items-center gap-2 rounded-2xl bg-white ring-1 ring-ink-200 shadow-pop ${
          size === 'lg' ? 'px-4 py-3' : 'px-3 py-2'
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-ink-400" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3-3" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          autoFocus={size === 'lg'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search the web, news, images, maps, scholar, darkweb…"
          className="flex-1 bg-transparent text-base leading-6 outline-none"
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ('');
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            title="Clear"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <select
          value={modality}
          onChange={(e) => setModality(e.target.value)}
          className="select rounded-lg border border-ink-200 bg-ink-50 px-2 py-1 capitalize"
          aria-label="Content type"
        >
          {MODALITIES.map((m) => (
            <option key={m} value={m}>
              {m === 'ai' ? 'AI Search' : m}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-primary">
          Search
        </button>
      </div>
      <RecentsDropdown show={focused && !q} onPick={(rq, rm) => { setModality(rm); run(rq, rm); }} />
    </form>
  );
}
