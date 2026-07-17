'use client';

import { SEARCH_DEPTH_OPTIONS, type SearchDepth } from '@/lib/search-depth';
import { ComposerSelect } from './composer-select';
import { useSearchExperience } from './search-experience-context';

const DEPTH_HELP =
  'Search breadth: Low = one engine (priority order). Medium = up to 2 engines in parallel. High = up to 5 engines in parallel.';

function ComposerIconToggle({
  icon,
  active,
  disabled,
  title,
  ariaLabel,
  onClick,
}: {
  icon: string;
  active: boolean;
  disabled?: boolean;
  title: string;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${
        disabled
          ? active
            ? 'cursor-not-allowed bg-brand-100 text-brand-600 opacity-80'
            : 'cursor-not-allowed text-ink-300'
          : active
            ? 'bg-brand-100 text-brand-600 hover:bg-brand-200'
            : 'text-ink-500 hover:bg-ink-100 hover:text-ink-700'
      }`}
    >
      <span className="material-symbols-outlined text-[1.25rem] leading-none">{icon}</span>
    </button>
  );
}

export function SearchComposerSettings() {
  const { searchDepth, setSearchDepth, temporary, setTemporary, signedIn } = useSearchExperience();

  const temporaryTitle = !signedIn
    ? 'Sign in to save searches.'
    : temporary
      ? 'This search is not saved.'
      : 'Searches are saved to your account. Click for a temporary search.';

  return (
    <div className="flex items-center gap-3">
      <ComposerSelect
        value={searchDepth}
        onChange={(v) => setSearchDepth(v as SearchDepth)}
        title={DEPTH_HELP}
        ariaLabel="Search breadth"
      >
        {SEARCH_DEPTH_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </ComposerSelect>

      <ComposerIconToggle
        icon="chat_dashed"
        active={temporary}
        disabled={!signedIn}
        title={temporaryTitle}
        ariaLabel="Toggle temporary search"
        onClick={() => setTemporary(!temporary)}
      />
    </div>
  );
}
