import { SiteHeader } from '@/components/site-header';

// Shown while the /search route loads (navigation in from home / first load).
// Modality-tab and in-page query changes use the SearchControls progress bar.
export default function SearchLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="border-b border-ink-100 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <div className="relative">
            <div className="absolute inset-x-0 -top-px h-0.5 overflow-hidden">
              <div className="hd-progress h-full w-full bg-brand-500" />
            </div>
            <div className="h-11 animate-pulse rounded-2xl bg-ink-100" />
            <div className="mt-3 flex gap-1">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-7 w-16 animate-pulse rounded-full bg-ink-100" />
              ))}
            </div>
          </div>
        </div>
      </div>
      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="space-y-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-40 animate-pulse rounded bg-ink-100" />
              <div className="h-5 w-2/3 animate-pulse rounded bg-ink-100" />
              <div className="h-3 w-full animate-pulse rounded bg-ink-100" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-ink-100" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
