'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { llmProviderLabel } from '@/lib/llm-provider-labels';
import { composerControlClass } from '@/lib/composer-control-styles';
import type { GroupedModels, ModelInfo } from './types';

const ACCOUNT_KEYS_HREF = '/dashboard/account?keys=llm';

function modelNeedsKey(m: ModelInfo): boolean {
  return Boolean(m.requiresKeys?.length) && !m.available;
}

function modelOptionSuffix(m: ModelInfo): string {
  if (m.available) {
    return m.accessType === 'self-hosted' ? ' · free' : '';
  }
  return modelNeedsKey(m) ? ' · needs key' : ' · unavailable';
}

function ModelPickerMenu({
  grouped,
  value,
  autoSelectEnabled,
  modelsReady,
  onChange,
  onClose,
  anchorRect,
  placement,
  menuRef,
}: {
  grouped: GroupedModels;
  value: string;
  autoSelectEnabled: boolean;
  modelsReady: boolean;
  onChange: (id: string) => void;
  onClose: () => void;
  anchorRect: DOMRect;
  placement: 'above' | 'below';
  menuRef: React.RefObject<HTMLDivElement>;
}) {
  const style: React.CSSProperties =
    placement === 'above'
      ? {
          position: 'fixed',
          left: anchorRect.left,
          bottom: window.innerHeight - anchorRect.top + 6,
          width: Math.max(anchorRect.width, 288),
          maxHeight: Math.min(288, anchorRect.top - 16),
        }
      : {
          position: 'fixed',
          left: anchorRect.left,
          top: anchorRect.bottom + 6,
          width: Math.max(anchorRect.width, 288),
          maxHeight: Math.min(288, window.innerHeight - anchorRect.bottom - 16),
        };

  return createPortal(
    <div
      ref={menuRef}
      role="listbox"
      style={style}
      className="z-[200] overflow-y-auto rounded-lg border border-ink-200 bg-white py-1 text-xs shadow-xl"
    >
      {autoSelectEnabled && (
        <button
          type="button"
          role="option"
          aria-selected={!value}
          onClick={() => {
            onChange('');
            onClose();
          }}
          className={`block w-full px-3 py-1.5 text-left text-xs leading-4 hover:bg-ink-50 ${!value ? 'bg-brand-50 text-brand-700' : 'text-ink-800'}`}
        >
          Auto-select
        </button>
      )}
      {!modelsReady ? (
        <p className="px-3 py-2 text-xs text-ink-500">Loading models…</p>
      ) : grouped.length === 0 ? (
        <p className="px-3 py-2 text-xs text-ink-500">No models available.</p>
      ) : null}
      {grouped.map(([prov, ms]) => (
        <div key={prov}>
          <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
            {llmProviderLabel(prov, ms[0]?.providerLabel)}
          </div>
          {ms.map((m) => {
            const needsKey = modelNeedsKey(m);
            const suffix = modelOptionSuffix(m);
            const isSelected = m.id === value;

            if (needsKey) {
              return (
                <Link
                  key={m.id}
                  href={ACCOUNT_KEYS_HREF}
                  onClick={onClose}
                  className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50"
                >
                  <span className="truncate opacity-80">
                    {m.label}
                    {suffix}
                  </span>
                  <span className="shrink-0 font-medium underline">Add key</span>
                </Link>
              );
            }

            if (!m.available) {
              return (
                <div
                  key={m.id}
                  className="flex cursor-not-allowed items-center justify-between gap-2 px-3 py-1.5 text-xs text-ink-400"
                  aria-disabled
                >
                  <span className="truncate">
                    {m.label}
                    {suffix}
                  </span>
                </div>
              );
            }

            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(m.id);
                  onClose();
                }}
                className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-ink-50 ${
                  isSelected ? 'bg-brand-50 text-brand-700' : 'text-ink-800'
                }`}
              >
                {m.label}
                {suffix}
              </button>
            );
          })}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function AiModelPicker({
  grouped,
  value,
  autoSelectEnabled,
  modelsReady = true,
  onChange,
  variant = 'toolbar',
}: {
  grouped: GroupedModels;
  value: string;
  autoSelectEnabled: boolean;
  modelsReady?: boolean;
  onChange: (id: string) => void;
  variant?: 'toolbar' | 'composer';
}) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const flat = grouped.flatMap(([, ms]) => ms);
  const selected = flat.find((m) => m.id === value);
  const selectedLabel = !modelsReady
    ? 'Loading…'
    : !value && autoSelectEnabled
      ? 'Auto-select'
      : selected?.label || value || 'Select model';

  const isComposer = variant === 'composer';
  const usePortal = isComposer;

  const updateAnchor = () => {
    if (!rootRef.current) return;
    setAnchorRect(rootRef.current.getBoundingClientRect());
  };

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }
    if (usePortal && rootRef.current) {
      setAnchorRect(rootRef.current.getBoundingClientRect());
    }
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open || !usePortal) return;
    updateAnchor();
    const onLayout = () => updateAnchor();
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    return () => {
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    };
  }, [open, usePortal]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        disabled={!modelsReady}
        className={
          isComposer
            ? `${composerControlClass} max-w-[16rem] gap-1 px-2.5 text-left disabled:opacity-60 sm:max-w-[18rem]`
            : 'flex max-w-[14rem] items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-left text-sm text-ink-900 outline-none hover:border-ink-300 disabled:opacity-60'
        }
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{selectedLabel}</span>
        <svg viewBox="0 0 20 20" className="ml-auto h-3.5 w-3.5 shrink-0 text-ink-400" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && usePortal && anchorRect && (
        <ModelPickerMenu
          grouped={grouped}
          value={value}
          autoSelectEnabled={autoSelectEnabled}
          modelsReady={modelsReady}
          onChange={onChange}
          onClose={() => setOpen(false)}
          anchorRect={anchorRect}
          placement="above"
          menuRef={menuRef}
        />
      )}

      {open && !usePortal && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border border-ink-200 bg-white py-1 shadow-lg"
        >
          {autoSelectEnabled && (
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              className={`block w-full px-3 py-1.5 text-left text-xs leading-4 hover:bg-ink-50 ${!value ? 'bg-brand-50 text-brand-700' : 'text-ink-800'}`}
            >
              Auto-select
            </button>
          )}
          {!modelsReady ? (
            <p className="px-3 py-2 text-xs text-ink-500">Loading models…</p>
          ) : grouped.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-500">No models available.</p>
          ) : null}
          {grouped.map(([prov, ms]) => (
            <div key={prov}>
              <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-ink-400">
                {llmProviderLabel(prov, ms[0]?.providerLabel)}
              </div>
              {ms.map((m) => {
                const needsKey = modelNeedsKey(m);
                const suffix = modelOptionSuffix(m);
                const isSelected = m.id === value;

                if (needsKey) {
                  return (
                    <Link
                      key={m.id}
                      href={ACCOUNT_KEYS_HREF}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50"
                    >
                      <span className="truncate opacity-80">
                        {m.label}
                        {suffix}
                      </span>
                      <span className="shrink-0 font-medium underline">Add key</span>
                    </Link>
                  );
                }

                if (!m.available) {
                  return (
                    <div
                      key={m.id}
                      className="flex cursor-not-allowed items-center justify-between gap-2 px-3 py-1.5 text-xs text-ink-400"
                      aria-disabled
                    >
                      <span className="truncate">
                        {m.label}
                        {suffix}
                      </span>
                    </div>
                  );
                }

                return (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                    className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-ink-50 ${
                      isSelected ? 'bg-brand-50 text-brand-700' : 'text-ink-800'
                    }`}
                  >
                    {m.label}
                    {suffix}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
