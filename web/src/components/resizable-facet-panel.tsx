'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FacetRail, type Facet } from './facet-rail';

const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const FACETS_COLLAPSED_KEY = 'hds_facets_collapsed';

export function ResizableFacetPanel({
  facets,
  baseParams,
  active,
}: {
  facets: Facet[];
  baseParams: Record<string, string>;
  active: string[];
}) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [collapsed, setCollapsed] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(DEFAULT_WIDTH);

  useEffect(() => {
    try {
      const v = localStorage.getItem(FACETS_COLLAPSED_KEY);
      if (v === '1') setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(FACETS_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const clamp = useCallback(
    (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)),
    [],
  );

  const endDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      setWidth(clamp(startWidth.current + (e.clientX - startX.current)));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [clamp, endDrag]);

  const panelHeader = (
    <div className="mb-2 flex items-center gap-2 px-1">
      <span className="material-symbols-outlined text-lg text-ink-500">filter_list</span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-ink-600">Filters</span>
      <button
        type="button"
        onClick={toggleCollapsed}
        className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
        title="Hide filters"
        aria-label="Hide filters"
      >
        <span className="material-symbols-outlined text-xl">chevron_left</span>
      </button>
    </div>
  );

  if (collapsed) {
    return (
      <>
        <div className="w-full lg:hidden">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="mb-2 flex w-full items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-600 hover:bg-ink-100"
          >
            <span className="material-symbols-outlined text-lg">filter_list</span>
            <span className="flex-1 text-left font-medium">Show filters</span>
            <span className="material-symbols-outlined text-lg text-ink-400">chevron_right</span>
          </button>
        </div>
        <div className="hidden shrink-0 lg:block" style={{ width: 48 }}>
          <button
            type="button"
            onClick={toggleCollapsed}
            title="Show filters"
            aria-label="Show filters"
            className="flex h-full min-h-[8rem] w-full flex-col items-center justify-start rounded-lg border border-ink-200 bg-ink-50 py-3 text-ink-500 hover:bg-ink-100"
          >
            <span className="material-symbols-outlined text-xl">chevron_right</span>
            <span className="material-symbols-outlined mt-2 text-xl">filter_list</span>
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="w-full lg:hidden">
        {panelHeader}
        <FacetRail facets={facets} baseParams={baseParams} active={active} />
      </div>

      <div className="relative hidden shrink-0 lg:block" style={{ width }}>
        {panelHeader}
        <FacetRail facets={facets} baseParams={baseParams} active={active} />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize filters panel"
          aria-valuenow={width}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setWidth((w) => clamp(w - 16));
            if (e.key === 'ArrowRight') setWidth((w) => clamp(w + 16));
          }}
          className="group absolute -right-4 top-0 z-10 flex h-full w-8 cursor-col-resize items-center justify-center touch-none"
        >
          <span className="h-12 w-1 rounded-full bg-ink-200/50 transition-colors group-hover:bg-brand-400 group-active:bg-brand-500" />
        </div>
      </div>
    </>
  );
}
