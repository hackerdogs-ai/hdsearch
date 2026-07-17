'use client';

import type { MouseEvent } from 'react';

/** Standard trash delete control for sidebar / history lists. */
export function HistoryDeleteButton({
  onClick,
  onMouseDown,
  label = 'Delete',
  className = '',
}: {
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  onMouseDown?: (e: MouseEvent<HTMLButtonElement>) => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={onMouseDown}
      className={`hds-delete-btn ${className}`.trim()}
      title={label}
      aria-label={label}
    >
      <span className="material-symbols-outlined" aria-hidden>
        delete
      </span>
    </button>
  );
}
