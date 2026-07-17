'use client';

import type { ReactNode } from 'react';
import { ComposerWelcomeSweep } from './composer-welcome-sweep';

/** Vertically centered landing composer — slightly above true center (ChatGPT / Claude pattern). */
export function CenteredComposerShell({
  title,
  children,
  footer,
  lift = 'default',
}: {
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Extra upward nudge for sign-in gate (no title above the box). */
  lift?: 'default' | 'signin';
}) {
  const liftClass =
    lift === 'signin'
      ? '-translate-y-5 pb-[min(20vh,9.5rem)]'
      : '-translate-y-3 pb-[min(18vh,8.75rem)]';

  return (
    <div
      className={`flex min-h-full w-full flex-1 flex-col items-center justify-center px-4 ${liftClass}`}
    >
      {title ? (
        <p className="mb-6 w-full max-w-3xl text-center text-2xl font-normal text-ink-400">{title}</p>
      ) : null}
      <ComposerWelcomeSweep>
        <div className="mx-auto w-full max-w-3xl">
          {children}
          {footer}
        </div>
      </ComposerWelcomeSweep>
    </div>
  );
}
