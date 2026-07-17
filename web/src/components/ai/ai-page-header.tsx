'use client';

import { Brand } from '@/components/brand';
import { ProfileMenu } from '@/components/profile-menu';
import { SearchModalityNav } from '@/components/search-modality-nav';
import { useAiSearch } from './ai-search-context';

export function AiPageHeader({
  signedIn,
  user,
  initialQuery = '',
}: {
  signedIn: boolean;
  user?: { name?: string | null; email?: string | null; picture?: string | null };
  initialQuery?: string;
}) {
  const { sidebarOpen, setSidebarOpen } = useAiSearch();

  return (
    <header className="shrink-0 border-b border-ink-100 bg-white/90 backdrop-blur">
      <div className="flex items-center gap-1 px-2 py-1.5 sm:gap-2 sm:px-4">
        {/* Left: menu + brand — sized to content so the center tabs get max room */}
        <div className="flex min-w-0 max-w-[8rem] shrink items-center gap-0.5 sm:max-w-[12rem] sm:gap-1">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800 md:hidden"
            title={sidebarOpen ? 'Hide conversations' : 'Show conversations'}
            aria-label={sidebarOpen ? 'Hide conversations' : 'Show conversations'}
          >
            <span className="material-symbols-outlined text-xl">
              {sidebarOpen ? 'menu_open' : 'menu'}
            </span>
          </button>

          <Brand className="min-w-0 shrink [&_span]:truncate" />
        </div>

        {/* Center: modality tabs — same row as brand */}
        <div className="min-w-0 flex-1 overflow-x-auto py-1">
          <SearchModalityNav
            activeModality="ai"
            query={initialQuery}
            className="mx-auto w-max justify-center"
          />
        </div>

        {/* Right: account — sized to content so the center tabs get max room */}
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
