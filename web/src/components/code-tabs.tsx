'use client';

import { useState } from 'react';

export interface Snippet {
  lang: string; // unique id
  label: string; // tab label
  code: string;
}

// Tabbed multi-language code block with a copy button. Used for SDK examples.
export function CodeTabs({ snippets }: { snippets: Snippet[] }) {
  const [active, setActive] = useState(snippets[0]?.lang ?? '');
  const [copied, setCopied] = useState(false);
  const current = snippets.find((s) => s.lang === active) ?? snippets[0];

  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-ink-200">
      <div className="flex flex-wrap items-center gap-1 border-b border-ink-200 bg-ink-50 px-2 py-1.5">
        {snippets.map((s) => (
          <button
            key={s.lang}
            onClick={() => setActive(s.lang)}
            className={`rounded px-2.5 py-1 text-sm font-medium ${
              s.lang === (current?.lang ?? '')
                ? 'bg-brand-500 text-white'
                : 'text-ink-600 hover:bg-ink-200'
            }`}
          >
            {s.label}
          </button>
        ))}
        <button
          onClick={() => {
            if (current) {
              navigator.clipboard.writeText(current.code).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }
          }}
          className="ml-auto rounded px-2 py-1 text-sm text-ink-500 hover:bg-ink-200"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto bg-ink-900 p-4 text-sm leading-relaxed text-ink-100">
        <code>{current?.code}</code>
      </pre>
    </div>
  );
}
