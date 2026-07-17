// Tiny code block with a copy button (client).
'use client';
import { useState } from 'react';

export function CodeBlock({ code, lang = 'bash' }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => {
          navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
        className="absolute right-2 top-2 rounded bg-white/10 px-2 py-1 text-sm text-ink-200 hover:bg-white/20"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre className="overflow-x-auto rounded-lg bg-ink-900 p-4 text-sm text-ink-100" data-lang={lang}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
