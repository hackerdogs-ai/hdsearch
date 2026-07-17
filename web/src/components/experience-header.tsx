'use client';

import { Brand } from '@/components/brand';
import { ProfileMenu } from '@/components/profile-menu';
import { SearchModalityNav } from '@/components/search-modality-nav';
import { useSearchExperienceOptional } from './search-experience-context';

export function ExperienceHeader({
  modality,
  query = '',
  signedIn,
  user,
  pending,
  onNavigate,
}: {
  modality: string;
  query?: string;
  signedIn: boolean;
  user?: { name?: string | null; email?: string | null; picture?: string | null };
  pending?: boolean;
  onNavigate?: (run: () => void) => void;
}) {
  const exp = useSearchExperienceOptional();
  const sidebarOpen = exp?.sidebarOpen ?? true;
  const setSidebarOpen = exp?.setSidebarOpen;

  return (
    <header className="shrink-0 border-b border-ink-100 bg-white/90 backdrop-blur">
      <div className="flex items-center gap-1 px-2 py-1.5 sm:gap-2 sm:px-4">
        <div className="flex min-w-0 max-w-[8rem] shrink items-center gap-0.5 sm:max-w-[12rem] sm:gap-1">
          {setSidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800 md:hidden"
              title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
              aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            >
              <span className="material-symbols-outlined text-xl">
                {sidebarOpen ? 'menu_open' : 'menu'}
              </span>
            </button>
          )}
          <Brand className="min-w-0 shrink [&_span]:truncate" />
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto py-1">
          <SearchModalityNav
            activeModality={modality}
            query={query}
            pending={pending}
            onNavigate={onNavigate}
            className="mx-auto w-max justify-center"
          />
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2">
          {signedIn && user ? (
            <ProfileMenu
              name={user.name ?? undefined}
              email={user.email ?? undefined}
              picture={user.picture ?? undefined}
            />
          ) : (
            <a href="/login" className="btn-primary whitespace-nowrap px-3 py-2 text-sm sm:text-base">
              Sign in
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
