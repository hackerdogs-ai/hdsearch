'use client';

import { MarkdownView } from './markdown';

export function TermsDocument({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div
      className={
        className ??
        'max-h-[28rem] overflow-auto rounded-lg border border-ink-100 bg-ink-50 p-4 text-sm leading-relaxed'
      }
    >
      <MarkdownView text={content} />
    </div>
  );
}
