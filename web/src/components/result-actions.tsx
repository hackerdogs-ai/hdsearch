'use client';

import Link from 'next/link';
import { useState } from 'react';
import { searchHref } from '@/lib/search-routes';
import { archiveHref, type ArchiveLoc } from './results';

// Per-result actions that surface engine capabilities directly in the open search
// results:
//   • Extract     — crawl the URL (crawl4ai/browserless) → clean markdown, inline.
//                   For archive results, extracts from the Common Crawl capture.
//   • Screenshot  — full-page PNG capture of the rendered page (live results only).
//   • PDF         — rendered PDF of the page (live results only).
//   • Archived    — historical captures via Common Crawl (hidden on the archive tab).
type Mode = 'markdown' | 'screenshot' | 'pdf';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

interface Capture {
  loading: boolean;
  err: string | null;
  markdown?: string;
  screenshot?: string;
  pdf?: string;
  source?: string;
}

export function ResultActions({ url, modality, archive }: { url: string; modality?: string; archive?: ArchiveLoc }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [data, setData] = useState<Record<Mode, Capture | undefined>>({} as any);
  const host = hostOf(url);
  const isArchive = modality === 'archive';

  async function run(m: Mode) {
    // toggle off if the same panel is open
    if (mode === m) {
      setMode(null);
      return;
    }
    setMode(m);
    if (data[m] && !data[m]!.err) return; // already fetched
    setData((d) => ({ ...d, [m]: { loading: true, err: null } }));
    try {
      // archive results extract from the Common Crawl capture, not the live page.
      const endpoint =
        isArchive && m === 'markdown'
          ? archiveHref(archive, false) || `/api/archive?url=${encodeURIComponent(url)}`
          : `/api/crawl?url=${encodeURIComponent(url)}&format=${m}`;
      const res = await fetch(endpoint);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'crawl failed');
      setData((d) => ({
        ...d,
        [m]: {
          loading: false,
          err: null,
          source: json.source,
          markdown: json.markdown,
          screenshot: json.screenshot,
          pdf: json.pdf,
        },
      }));
    } catch (e: any) {
      setData((d) => ({ ...d, [m]: { loading: false, err: e?.message || 'crawl failed' } }));
    }
  }

  const cur = mode ? data[mode] : undefined;

  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <ActionButton
          active={mode === 'markdown'}
          onClick={() => run('markdown')}
          label={mode === 'markdown' ? 'Hide extract' : isArchive ? 'Extract (snapshot → markdown)' : 'Extract (crawl → markdown)'}
        >
          <path d="M4 4h10l6 6v10H4z" strokeLinejoin="round" />
          <path d="M14 4v6h6" strokeLinejoin="round" />
        </ActionButton>

        {/* Screenshot/PDF render the *live* page — not meaningful for an archived capture. */}
        {!isArchive && (
          <>
            <ActionButton active={mode === 'screenshot'} onClick={() => run('screenshot')} label={mode === 'screenshot' ? 'Hide screenshot' : 'Screenshot'}>
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="12" cy="12" r="3" />
            </ActionButton>

            <ActionButton active={mode === 'pdf'} onClick={() => run('pdf')} label={mode === 'pdf' ? 'Hide PDF' : 'PDF'}>
              <path d="M6 2h8l4 4v16H6z" strokeLinejoin="round" />
              <path d="M14 2v4h4" strokeLinejoin="round" />
            </ActionButton>
          </>
        )}

        {/* "Find archived captures" only makes sense off the archive tab. */}
        {!isArchive && host && (
          <Link
            href={searchHref({ q: host, modality: 'archive' })}
            className="inline-flex items-center gap-1 text-ink-500 hover:text-brand-700"
            title={`Historical captures of ${host} in Common Crawl`}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 8v4l3 2M12 3a9 9 0 100 18 9 9 0 000-18z" strokeLinecap="round" />
            </svg>
            Archived (Common Crawl)
          </Link>
        )}
      </div>

      {mode && cur && (
        <div className="mt-2 rounded-lg border border-ink-200 bg-ink-50 p-3">
          {cur.loading && (
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-300 border-t-brand-500" />
              {mode === 'markdown' ? (isArchive ? 'Reading archived capture…' : 'Crawling & extracting…') : mode === 'screenshot' ? 'Rendering full-page screenshot…' : 'Rendering PDF…'}
            </div>
          )}
          {cur.err && <p className="text-sm text-red-600">{cur.err}</p>}

          {!cur.loading && !cur.err && mode === 'markdown' && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-700">
              {cur.markdown || '(no extractable content)'}
            </pre>
          )}

          {!cur.loading && !cur.err && mode === 'screenshot' && cur.screenshot && (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cur.screenshot} alt="Full-page screenshot" className="max-h-96 w-full rounded border border-ink-200 object-contain object-top" />
              <a href={cur.screenshot} download={`${host || 'page'}.png`} className="text-sm text-brand-600 hover:underline">
                Download PNG
              </a>
            </div>
          )}

          {!cur.loading && !cur.err && mode === 'pdf' && cur.pdf && (
            <div className="space-y-2">
              <object data={cur.pdf} type="application/pdf" className="h-96 w-full rounded border border-ink-200">
                <p className="text-sm text-ink-500">Preview unavailable — use the link below.</p>
              </object>
              <a href={cur.pdf} download={`${host || 'page'}.pdf`} className="text-sm text-brand-600 hover:underline">
                Download PDF
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1 ${active ? 'text-brand-700' : 'text-ink-500'} hover:text-brand-700`}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
        {children}
      </svg>
      {label}
    </button>
  );
}
