'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { searchHref } from '@/lib/search-routes';
import type { TrendArticle, TrendSection, TrendsPageData } from '@/lib/trends-types';

function hostOf(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function fmtTime(raw?: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function ArticleRow({ item }: { item: TrendArticle }) {
  const href = item.url || searchHref({ q: item.title, modality: 'news' });
  const external = !!item.url;
  return (
    <li className="group border-b border-ink-100 py-4 last:border-0">
      <div className="flex items-center gap-2 text-sm text-ink-500">
        <span className="truncate">{item.source || hostOf(item.url) || 'News'}</span>
        {item.publishedAt && <span>· {fmtTime(item.publishedAt)}</span>}
      </div>
      <a
        href={href}
        {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
        className="mt-0.5 block text-base font-medium text-brand-700 group-hover:underline"
      >
        {item.title}
      </a>
      {item.summary && (
        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-600">{item.summary}</p>
      )}
      <Link
        href={searchHref({ q: item.title, modality: 'news' })}
        className="mt-2 inline-block text-sm text-ink-400 hover:text-brand-600"
      >
        Search this topic →
      </Link>
    </li>
  );
}

function SectionBlock({ section }: { section: TrendSection }) {
  if (!section.items.length) return null;
  return (
    <section className="min-w-0">
      <h2 className="text-lg font-semibold text-ink-900">{section.label}</h2>
      <ul className="mt-2 divide-y divide-ink-100 rounded-xl border border-ink-100 bg-white px-4">
        {section.items.map((item) => (
          <ArticleRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

function hasItems(sections: TrendSection[]): boolean {
  return sections.some((s) => s.items.length > 0);
}

export function TrendsView({
  sections: initialSections,
  windowHours: initialWindowHours,
}: {
  sections: TrendSection[];
  windowHours: number;
}) {
  const [sections, setSections] = useState(initialSections);
  const [windowHours, setWindowHours] = useState(initialWindowHours);
  const [refreshing, setRefreshing] = useState(false);

  // SSR or Next cache can serve an empty snapshot after a transient hd-feeds failure — refetch once.
  useEffect(() => {
    if (hasItems(initialSections)) return;
    let cancelled = false;
    setRefreshing(true);
    fetch('/api/trends', { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<TrendsPageData>) : null))
      .then((data) => {
        if (cancelled || !data || !hasItems(data.sections)) return;
        setSections(data.sections);
        if (data.windowHours) setWindowHours(data.windowHours);
      })
      .finally(() => {
        if (!cancelled) setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialSections]);

  const active = sections.filter((s) => s.items.length > 0);
  if (refreshing && !active.length) {
    return <p className="py-24 text-center text-ink-500">Loading trends…</p>;
  }
  if (!active.length) {
    return (
      <p className="py-24 text-center text-ink-500">
        No recent headlines in the last {windowHours} hours. Check back soon.
      </p>
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      {active.map((section) => (
        <SectionBlock key={section.id} section={section} />
      ))}
    </div>
  );
}
