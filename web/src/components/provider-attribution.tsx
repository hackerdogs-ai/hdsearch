'use client';

import type { ProviderAttribution } from '@/lib/provider-attribution';

/** Footer row for required upstream branding (Google, Brave, OSM, archives, etc.). */
export function ProviderAttributionBar({ items }: { items: ProviderAttribution[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink-100 pt-3 text-sm text-ink-500">
      {items.map((a) =>
        a.href ? (
          <a key={a.id} href={a.href} target="_blank" rel="noreferrer" className="hover:text-brand-700 hover:underline">
            {a.label}
          </a>
        ) : (
          <span key={a.id}>{a.label}</span>
        ),
      )}
    </div>
  );
}
