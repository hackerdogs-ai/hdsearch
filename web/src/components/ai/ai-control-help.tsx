'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** Compact help popover for AI Search toolbar controls. */
export function AiControlHelp({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0 align-middle">
      <button
        type="button"
        aria-label={`Help: ${label}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-[11px] w-[11px] items-center justify-center rounded-full border border-ink-300/90 bg-white/80 p-0 text-sm font-semibold leading-none text-ink-400 transition hover:border-ink-400 hover:text-ink-600"
      >
        ?
      </button>
      {open && (
        <div
          id={panelId}
          role="tooltip"
          className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-lg border border-ink-200 bg-white p-3 text-left text-sm leading-snug text-ink-600 shadow-lg"
        >
          {children}
        </div>
      )}
    </span>
  );
}

export function HelpSection({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-0.5">
      <div className="font-medium text-ink-800">{title}</div>
      <div className="text-ink-500">{body}</div>
    </div>
  );
}
