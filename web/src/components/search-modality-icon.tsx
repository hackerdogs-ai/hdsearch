'use client';

import '@/styles/material-symbols.css';
import type { SearchModality } from '@/components/search-modality-nav';
import { modalityTitle, MODALITY_META } from '@/lib/search-modality-meta';

/** Tiny category icon for search history rows (matches header modality tabs). */
export function SearchModalityIcon({
  modality,
  className = '',
}: {
  modality: string;
  className?: string;
}) {
  const meta = MODALITY_META[modality as SearchModality];
  const icon = meta?.icon ?? 'search';
  const title = modalityTitle(modality);

  return (
    <span
      className={`material-symbols-outlined hds-history-modality-icon shrink-0 text-ink-400 ${className}`}
      title={title}
      aria-label={title}
    >
      {icon}
    </span>
  );
}
