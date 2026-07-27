import Link from 'next/link';

export const HDSEARCH_GITHUB_URL = 'https://github.com/hackerdogs-ai/hdsearch';

// hdsearch wordmark + simple search (magnifying glass) mark.
export function SearchMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <span aria-hidden className={`grid place-items-center rounded-lg bg-brand-500 text-white shadow-card ${className}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="m20 20-4.6-4.6" />
      </svg>
    </span>
  );
}

function GitHubMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.387.6.113.82-.26.82-.577 0-.285-.01-1.04-.016-2.04-3.338.726-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.757-1.333-1.757-1.09-.745.083-.73.083-.73 1.205.085 1.84 1.238 1.84 1.238 1.07 1.834 2.807 1.304 3.492.997.108-.775.42-1.305.763-1.605-2.665-.303-5.467-1.333-5.467-5.931 0-1.31.468-2.381 1.236-3.221-.124-.303-.536-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.291-1.552 3.297-1.23 3.297-1.23.655 1.652.243 2.873.12 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.625-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .32.216.694.825.576C20.565 21.796 24 17.297 24 12 24 5.37 18.63 0 12 0z" />
    </svg>
  );
}

/** Octocat link to the public hdsearch repo — sits beside the wordmark. */
export function BrandGitHub({ className = '', dark = false }: { className?: string; dark?: boolean }) {
  return (
    <a
      href={HDSEARCH_GITHUB_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="hdsearch on GitHub"
      aria-label="hdsearch on GitHub"
      className={`inline-flex shrink-0 items-center rounded-lg p-1.5 transition hover:bg-ink-100 ${
        dark ? 'text-white/80 hover:bg-white/10 hover:text-white' : 'text-ink-500 hover:text-ink-900'
      } ${className}`}
    >
      <GitHubMark />
    </a>
  );
}

export function Brand({ className = '', dark = false }: { className?: string; dark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      <Link href="/" className="inline-flex min-w-0 items-center gap-2 font-bold tracking-tight">
        <SearchMark />
        <span className={`truncate ${dark ? 'text-white' : 'text-ink-900'}`}>
          hd<span className="text-brand-500">search</span>
        </span>
      </Link>
      <BrandGitHub dark={dark} />
    </span>
  );
}
