import Link from 'next/link';

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

export function Brand({ className = '', dark = false }: { className?: string; dark?: boolean }) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2 font-bold tracking-tight ${className}`}>
      <SearchMark />
      <span className={dark ? 'text-white' : 'text-ink-900'}>
        hd<span className="text-brand-500">search</span>
      </span>
    </Link>
  );
}
