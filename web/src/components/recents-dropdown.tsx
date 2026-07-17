'use client';

import { useEffect, useState } from 'react';
import { HistoryDeleteButton } from '@/components/history-delete-button';
import { SearchModalityIcon } from '@/components/search-modality-icon';
import { getRecents, removeRecent, clearRecents, type Recent } from '@/lib/recents';

// Recent-searches dropdown (browser tier). Shows the most recent local searches
// under the search bar; picking one re-runs it. Updates live via the 'hd-recents'
// event so it reflects changes from any bar on the page.
export function RecentsDropdown({ show, onPick }: { show: boolean; onPick: (q: string, modality: string) => void }) {
  const [recents, setRecents] = useState<Recent[]>([]);
  useEffect(() => {
    const sync = () => setRecents(getRecents());
    sync();
    window.addEventListener('hd-recents', sync);
    return () => window.removeEventListener('hd-recents', sync);
  }, []);

  if (!show || recents.length === 0) return null;

  return (
    <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop">
      <div className="flex items-center justify-between px-3 py-1.5 text-sm uppercase tracking-wide text-ink-400">
        <span>Recent searches</span>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => clearRecents()}
          className="text-ink-400 hover:text-red-600"
        >
          Clear all
        </button>
      </div>
      <ul className="max-h-72 overflow-auto pb-1">
        {recents.slice(0, 8).map((r) => (
          <li key={`${r.modality}:${r.q}:${r.ts}`} className="group flex items-center">
            <button
              type="button"
              // onMouseDown (before input blur) so the pick registers
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(r.q, r.modality);
              }}
              className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-ink-50"
            >
              <span className="min-w-0 flex-1 truncate text-ink-800">{r.q}</span>
              <SearchModalityIcon modality={r.modality} className="ml-auto" />
            </button>
            <HistoryDeleteButton
              onMouseDown={(e) => {
                e.preventDefault();
                removeRecent(r.q, r.modality);
              }}
              onClick={() => {}}
              className="opacity-0 group-hover:opacity-100"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
