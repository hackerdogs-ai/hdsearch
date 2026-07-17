'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { pushRecent } from '@/lib/recents';
import { aiSearchHref } from '@/lib/ai-routes';
import { searchHref } from '@/lib/search-routes';
import { SearchModalityNav } from './search-modality-nav';
import { RecentsDropdown } from './recents-dropdown';

// Combined search input + modality tabs for the results page.

export function SearchControls({ q, modality, mode }: { q: string; modality: string; mode?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(q);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // record the search the page landed on (form submit, tab, shared link) into the
  // browser-tier history; server tiers are recorded API-side for signed-in users.
  useEffect(() => {
    if (q.trim()) pushRecent(q.trim(), modality);
  }, [q, modality]);

  function navigate(nextQ: string, nextModality: string) {
    if (nextModality === 'ai') {
      if (nextQ.trim()) pushRecent(nextQ.trim(), 'ai');
      startTransition(() => router.push(aiSearchHref(nextQ)));
      return;
    }
    if (nextQ.trim()) pushRecent(nextQ.trim(), nextModality);
    const sp = new URLSearchParams({ q: nextQ, modality: nextModality });
    if (mode) sp.set('mode', mode);
    startTransition(() => router.push(searchHref(sp)));
  }

  return (
    <div className="relative">
      {/* top progress bar */}
      {pending && (
        <div className="absolute inset-x-0 -top-px z-10 h-0.5 overflow-hidden">
          <div className="hd-progress h-full w-full bg-brand-500" />
        </div>
      )}

      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) navigate(text.trim(), modality);
        }}
      >
        <div className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-card ring-1 ring-ink-200">
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-ink-400" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3-3" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search the web, news, images, maps, scholar, darkweb…"
            className="flex-1 bg-transparent text-base leading-6 outline-none"
          />
          {text && (
            <button
              type="button"
              onClick={() => {
                setText('');
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
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? 'Searching…' : 'Search'}
          </button>
        </div>
        <RecentsDropdown show={focused && !text} onPick={(rq, rm) => navigate(rq, rm)} />
      </form>

      {/* modality tabs */}
      <SearchModalityNav
        activeModality={modality}
        query={text.trim() || q}
        pending={pending}
        onNavigate={(run) => startTransition(run)}
        className="mt-3"
      />
    </div>
  );
}
