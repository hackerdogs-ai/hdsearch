'use client';

import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Consumer-grade rendering for AI Search answers: real markdown → styled elements
// (no raw `**`/`##`/`[](…)`), plus a ChatGPT/Gemini-style collapsible Sources row.

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Route third-party images through our proxy (same as search results). */
export function proxiedImg(url?: string | null): string {
  if (!url?.trim()) return '';
  if (url.startsWith('data:') || url.startsWith('/')) return url;
  return `/api/img?url=${encodeURIComponent(url)}`;
}

export function faviconFor(url: string): string | null {
  try {
    const h = new URL(url).hostname;
    return proxiedImg(`https://www.google.com/s2/favicons?domain=${h}&sz=64`);
  } catch {
    return null;
  }
}

/**
 * Drop a trailing "Sources / References / Citations" section the model sometimes appends,
 * since we render our own polished Sources row. Only strips a block at the very end.
 */
export function stripTrailingSources(text: string): string {
  return text.replace(/\n+\s*(?:#{1,6}\s*)?(?:sources|references|citations)\s*:?\s*\n[\s\S]*$/i, '').trimEnd();
}

// Map markdown nodes to styled, consumer-looking elements (we don't rely on the
// tailwind typography plugin — these give precise control over the look).
const components = {
  p: (p: any) => <p className="my-2 text-base leading-7 text-ink-800 first:mt-0 last:mb-0" {...p} />,
  h1: (p: any) => <h1 className="mb-2 mt-4 text-xl font-semibold text-ink-900 first:mt-0" {...p} />,
  h2: (p: any) => <h2 className="mb-2 mt-4 text-lg font-semibold text-ink-900 first:mt-0" {...p} />,
  h3: (p: any) => <h3 className="mb-1.5 mt-3 text-base font-semibold text-ink-900 first:mt-0" {...p} />,
  ul: (p: any) => <ul className="my-2 ml-1 space-y-1.5 text-base leading-7 text-ink-800" {...p} />,
  ol: (p: any) => <ol className="my-2 ml-1 list-decimal space-y-1.5 pl-4 text-base leading-7 text-ink-800" {...p} />,
  li: (p: any) => <li className="marker:text-ink-400" {...p} />,
  a: (p: any) => <a className="font-medium text-brand-700 underline-offset-2 hover:underline" target="_blank" rel="noreferrer" {...p} />,
  strong: (p: any) => <strong className="font-semibold text-ink-900" {...p} />,
  em: (p: any) => <em className="italic" {...p} />,
  hr: () => <hr className="my-4 border-ink-100" />,
  blockquote: (p: any) => <blockquote className="my-2 border-l-2 border-brand-200 pl-3 text-ink-600" {...p} />,
  // react-markdown v9 no longer passes `inline`; detect block code via a language
  // class or a contained newline. Block code is wrapped by the styled <pre> below.
  pre: (p: any) => <pre className="my-2 overflow-auto rounded-lg bg-ink-900 p-3 text-sm leading-relaxed text-ink-50" {...p} />,
  code: (p: any) => {
    const { className, children, ...rest } = p;
    const isBlock = /language-/.test(className || '') || String(children).includes('\n');
    if (isBlock) return <code className={className} {...rest}>{children}</code>;
    return <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-sm text-ink-800" {...rest}>{children}</code>;
  },
  table: (p: any) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...p} />
    </div>
  ),
  th: (p: any) => <th className="border-b border-ink-200 px-3 py-1.5 text-left font-semibold text-ink-700" {...p} />,
  td: (p: any) => <td className="border-b border-ink-100 px-3 py-1.5 text-ink-700" {...p} />,
};

export function MarkdownView({ text }: { text: string }) {
  return (
    <div className="text-ink-800">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}

// ───────────── Sources row — ChatGPT / Gemini style (icons → expand) ─────────────

export interface Source {
  title: string;
  url: string;
}

/** Dedupe by URL, keeping first/best title. */
export function dedupeSources(sources: Source[]): Source[] {
  const seen = new Map<string, Source>();
  for (const s of sources) {
    if (!s?.url) continue;
    const key = s.url;
    if (!seen.has(key)) seen.set(key, { title: s.title || hostOf(s.url), url: s.url });
  }
  return [...seen.values()];
}

export function Sources({ sources, className = '' }: { sources: Source[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const list = dedupeSources(sources);
  if (!list.length) return null;

  const hosts = [...new Set(list.map((s) => hostOf(s.url)))];
  const icons = hosts.slice(0, 4);

  return (
    <div className={className ? className : 'mt-2'}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-2.5 py-1 text-sm text-ink-600 transition hover:bg-ink-50"
      >
        {/* stacked favicons — isolate keeps per-icon z-index from escaping over the sticky composer */}
        <span className="isolate flex -space-x-1.5">
          {icons.map((h, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={proxiedImg(`https://www.google.com/s2/favicons?domain=${h}&sz=64`)}
              alt=""
              className="relative h-4 w-4 rounded-full ring-2 ring-white"
              style={{ zIndex: icons.length - i }}
            />
          ))}
        </span>
        <span className="font-medium text-ink-700">Sources</span>
        <span className="text-ink-400">{list.length}</span>
        <span className="text-ink-400">{open ? '▲' : '▾'}</span>
      </button>

      {open && (
        <ol className="mt-2 space-y-1.5">
          {list.map((s, i) => {
            const fav = faviconFor(s.url);
            return (
              <li key={i}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-start gap-2 rounded-lg border border-ink-100 bg-white p-2 transition hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-100 text-sm font-semibold text-ink-500">
                    {i + 1}
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {fav && <img src={fav} alt="" className="mt-0.5 h-4 w-4 rounded" />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink-800 group-hover:text-brand-700">{s.title}</span>
                    <span className="block truncate text-sm text-ink-400">{hostOf(s.url)}</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
