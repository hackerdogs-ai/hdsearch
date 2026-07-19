'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useModalityNavOptional } from '@/components/modality-nav-context';
import { pushRecent } from '@/lib/recents';
import { MODALITY_META, modalityShort } from '@/lib/search-modality-meta';
import { PRODUCT_HOME_PATH, searchHref } from '@/lib/search-routes';

/** Modality tabs shared by classic search and the unified search experience header. */
export const SEARCH_MODALITIES = [
  'web',
  'news',
  'images',
  'videos',
  'maps',
  'scholar',
  'code',
  'social',
  'archive',
  'darkweb',
  'semantic',
  'ai',
] as const;

export type SearchModality = (typeof SEARCH_MODALITIES)[number];

function ModalityNavButton({
  active,
  loading,
  disabled,
  title,
  label,
  caption,
  icon,
  onClick,
}: {
  active: boolean;
  loading: boolean;
  disabled?: boolean;
  title: string;
  label: string;
  caption: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      aria-busy={loading || undefined}
      aria-current={active && !loading ? 'page' : undefined}
      className={`relative flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 overflow-visible rounded-lg px-1 py-1 transition ${
        loading
          ? 'bg-white text-brand-700 shadow-sm'
          : active
            ? 'bg-brand-600 text-white shadow-sm'
            : 'text-ink-500 hover:bg-ink-100 hover:text-ink-700'
      }`}
    >
      {loading ? (
        <span
          className="hd-progress-ring pointer-events-none absolute -inset-0.5 rounded-lg border-2 border-brand-200 border-t-brand-500"
          aria-hidden
        />
      ) : null}
      <span
        className="material-symbols-outlined relative z-10 text-[20px] leading-none"
        style={{ fontVariationSettings: active && !loading ? "'FILL' 1" : "'FILL' 0" }}
      >
        {icon}
      </span>
      <span className="relative z-10 w-full truncate text-center text-[9px] font-medium leading-none tracking-tight">
        {caption}
      </span>
    </button>
  );
}

export function SearchModalityNav({
  activeModality,
  query = '',
  pending: pendingProp,
  className = '',
  onNavigate,
}: {
  activeModality: string;
  query?: string;
  pending?: boolean;
  className?: string;
  onNavigate?: (run: () => void) => void;
}) {
  const router = useRouter();
  const modalityNav = useModalityNavOptional();
  const [navPending, startTransition] = useTransition();
  const pending = pendingProp ?? navPending;
  const [localTarget, setLocalTarget] = useState<SearchModality | null>(null);
  const loadingSinceRef = useRef<number | null>(null);

  const targetModality = modalityNav?.targetModality ?? localTarget;
  const modalityNavBusy = modalityNav?.modalityNavBusy ?? localTarget != null;

  useEffect(() => {
    if (modalityNav) return;
    if (!localTarget || pending) return;
    if (activeModality !== localTarget) return;

    const elapsed = loadingSinceRef.current ? Date.now() - loadingSinceRef.current : 400;
    const delay = Math.max(0, 400 - elapsed);
    const t = window.setTimeout(() => {
      setLocalTarget(null);
      loadingSinceRef.current = null;
    }, delay);
    return () => window.clearTimeout(t);
  }, [modalityNav, localTarget, pending, activeModality]);

  const go = useCallback(
    (run: () => void) => {
      if (onNavigate) onNavigate(run);
      else startTransition(run);
    },
    [onNavigate],
  );

  const navigate = useCallback(
    (nextModality: SearchModality) => {
      if (nextModality === activeModality && !modalityNavBusy) return;

      const run = () => {
        const q = query.trim();
        if (q && nextModality !== 'ai') pushRecent(q, nextModality);
        if (q && nextModality === 'ai') pushRecent(q, 'ai');
        const sp = new URLSearchParams({ modality: nextModality });
        if (q) sp.set('q', q);
        const href = searchHref(sp);
        if (nextModality === 'ai' && !q) router.replace(href);
        else router.push(href);
      };

      if (modalityNav) {
        modalityNav.navigateModality(nextModality, run);
        return;
      }

      loadingSinceRef.current = Date.now();
      setLocalTarget(nextModality);
      go(run);
    },
    [activeModality, modalityNav, modalityNavBusy, query, router, go],
  );

  return (
    <nav
      className={`flex items-center gap-1.5 overflow-x-auto py-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      aria-label="Search type"
    >
      <Link
        href={PRODUCT_HOME_PATH}
        prefetch={false}
        title="API overview"
        aria-label="API overview"
        className="flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1 py-1 text-ink-500 transition hover:bg-ink-100 hover:text-ink-700"
      >
        <span className="material-symbols-outlined text-[20px] leading-none" aria-hidden>
          api
        </span>
        <span className="w-full truncate text-center text-[9px] font-medium leading-none tracking-tight">
          API
        </span>
      </Link>
      {SEARCH_MODALITIES.map((m) => {
        const meta = MODALITY_META[m];
        const loading = targetModality === m;
        const active = m === activeModality && !loading;
        return (
          <ModalityNavButton
            key={m}
            active={active}
            loading={loading}
            disabled={modalityNavBusy}
            title={meta.title}
            label={meta.label}
            caption={modalityShort(m)}
            icon={meta.icon}
            onClick={() => navigate(m)}
          />
        );
      })}
    </nav>
  );
}
