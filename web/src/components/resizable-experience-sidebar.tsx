'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export const EXPERIENCE_SIDEBAR_WIDTH_KEY = 'hds_experience_sidebar_width';

/** Matches Tailwind `w-56` (14rem). */
export const EXPERIENCE_SIDEBAR_DEFAULT_WIDTH = 224;
const MIN_WIDTH = 200;
const MAX_WIDTH = 420;

function readSavedWidth(): number {
  if (typeof window === 'undefined') return EXPERIENCE_SIDEBAR_DEFAULT_WIDTH;
  try {
    const raw = localStorage.getItem(EXPERIENCE_SIDEBAR_WIDTH_KEY);
    if (raw == null) return EXPERIENCE_SIDEBAR_DEFAULT_WIDTH;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, n));
  } catch {
    /* ignore */
  }
  return EXPERIENCE_SIDEBAR_DEFAULT_WIDTH;
}

export function ResizableExperienceSidebar({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose?: () => void;
}) {
  const [width, setWidth] = useState(EXPERIENCE_SIDEBAR_DEFAULT_WIDTH);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(EXPERIENCE_SIDEBAR_DEFAULT_WIDTH);

  useEffect(() => {
    setWidth(readSavedWidth());
  }, []);

  const clamp = useCallback(
    (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w)),
    [],
  );

  const persistWidth = useCallback((w: number) => {
    try {
      localStorage.setItem(EXPERIENCE_SIDEBAR_WIDTH_KEY, String(w));
    } catch {
      /* ignore */
    }
  }, []);

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
    const onUp = () => {
      if (!dragging.current) return;
      setWidth((w) => {
        persistWidth(w);
        return w;
      });
      endDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [clamp, endDrag, persistWidth]);

  const asideStyle = {
    ['--hds-sidebar-w' as string]: `${width}px`,
  } as CSSProperties;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-ink-900/30 md:hidden"
        aria-hidden
        onClick={onClose}
      />
      <aside
        style={asideStyle}
        className="fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] shrink-0 flex-col overflow-hidden border-r border-ink-100 bg-ink-50/95 shadow-xl backdrop-blur md:relative md:z-auto md:w-[var(--hds-sidebar-w,14rem)] md:shadow-none"
      >
        {children}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuenow={width}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              setWidth((w) => {
                const next = clamp(w + 16);
                persistWidth(next);
                return next;
              });
            }
            if (e.key === 'ArrowLeft') {
              setWidth((w) => {
                const next = clamp(w - 16);
                persistWidth(next);
                return next;
              });
            }
          }}
          className="group absolute -right-2 top-0 z-10 hidden h-full w-4 cursor-col-resize items-center justify-center touch-none md:flex"
        >
          <span className="h-12 w-1 rounded-full bg-ink-200/50 transition-colors group-hover:bg-brand-400 group-active:bg-brand-500" />
        </div>
      </aside>
    </>
  );
}
