'use client';

import { useAiSearch, type AiSourceDetails } from './ai-search-context';
import { ComposerSelect } from '@/components/composer-select';

const SOURCE_DETAILS_OPTIONS: { value: AiSourceDetails; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const DETAILS_HELP =
  'Context depth: Low = snippets only. Medium = full text from top 3 pages. High = full text from top 10 pages.';

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

/** Tool UI + source depth + temporary — composer footer beside model picker. */
export function AiComposerSettings() {
  const { showSteps, setShowSteps, sourceDetails, setSourceDetails, temporary, setTemporary, signedIn } =
    useAiSearch();

  const toolUiTitle = showSteps
    ? 'Tool UI on — show tool cards (search, maps, charts) in the thread. Click to hide.'
    : 'Tool UI off — answer-only view. Tools still run in the background. Click to show cards.';

  const temporaryTitle = !signedIn
    ? 'Sign in to save chats.'
    : temporary
      ? 'This chat is not saved.'
      : 'Chats are saved to your account. Click for a temporary chat.';

  return (
    <div className="flex items-center gap-3">
      <ComposerIconToggle
        icon="widgets"
        active={showSteps}
        title={toolUiTitle}
        ariaLabel="Toggle tool UI"
        onClick={() => setShowSteps(!showSteps)}
      />

      <ComposerSelect
        value={sourceDetails}
        onChange={(v) => setSourceDetails(v as AiSourceDetails)}
        title={DETAILS_HELP}
        ariaLabel="Source details"
      >
        {SOURCE_DETAILS_OPTIONS.map((o) => (
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
        ariaLabel="Toggle temporary chat"
        onClick={() => setTemporary(!temporary)}
      />
    </div>
  );
}
