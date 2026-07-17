'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  COMPOSER_CHEVRON_BG,
  composerControlClass,
} from '@/lib/composer-control-styles';
import type { SearchEngineInfo } from './search-experience-context';

const ACCOUNT_KEYS_HREF = '/dashboard/account?keys=search';

function engineNeedsKey(e: SearchEngineInfo): boolean {
  return Boolean(e.requiresKeys?.length) && !e.available;
}

function engineSuffix(e: SearchEngineInfo): string {
  if (e.available) {
    return e.accessType === 'self-hosted' || e.accessType === 'free' ? ' · free' : '';
  }
  return engineNeedsKey(e) ? ' · needs key' : ' · unavailable';
}

export function SearchEnginePicker({
  engines,
  value,
  onChange,
}: {
  engines: SearchEngineInfo[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const selected = engines.find((e) => e.id === value);
  const selectedLabel = selected?.label ?? (value ? value : 'Auto');

  const updateAnchor = () => {
    const el = rootRef.current;
    if (el) setAnchorRect(el.getBoundingClientRect());
  };

  useLayoutEffect(() => {
    if (open) updateAnchor();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) updateAnchor();
            return next;
          });
        }}
        className={`${composerControlClass} max-w-[11rem] bg-[length:0.65rem] bg-[right_0.55rem_center] bg-no-repeat pl-2.5 pr-7 sm:max-w-[13rem]`}
        style={{ backgroundImage: COMPOSER_CHEVRON_BG }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Search engine: ${selectedLabel}`}
      >
        <span className="min-w-0 truncate">{selectedLabel}</span>
      </button>

      {open && anchorRect &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            style={{
              position: 'fixed',
              left: anchorRect.left,
              bottom: window.innerHeight - anchorRect.top + 6,
              width: Math.max(anchorRect.width, 288),
              maxHeight: Math.min(288, anchorRect.top - 16),
            }}
            className="z-[200] overflow-y-auto rounded-lg border border-ink-200 bg-white py-1 text-xs shadow-xl"
          >
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-ink-50 ${!value ? 'bg-brand-50 text-brand-700' : 'text-ink-800'}`}
            >
              Auto
            </button>
            {engines.map((e) => {
              const needsKey = engineNeedsKey(e);
              const suffix = engineSuffix(e);
              const isSelected = e.id === value;

              if (needsKey) {
                return (
                  <Link
                    key={e.id}
                    href={ACCOUNT_KEYS_HREF}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50"
                  >
                    <span className="truncate opacity-80">
                      {e.label}
                      {suffix}
                    </span>
                    <span className="shrink-0 font-medium underline">Add key</span>
                  </Link>
                );
              }

              if (!e.available) {
                return (
                  <div
                    key={e.id}
                    className="flex cursor-not-allowed items-center justify-between gap-2 px-3 py-1.5 text-xs text-ink-400"
                    aria-disabled
                  >
                    <span className="truncate">
                      {e.label}
                      {suffix}
                    </span>
                  </div>
                );
              }

              return (
                <button
                  key={e.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(e.id);
                    setOpen(false);
                  }}
                  className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-ink-50 ${
                    isSelected ? 'bg-brand-50 text-brand-700' : 'text-ink-800'
                  }`}
                >
                  {e.label}
                  {suffix}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
