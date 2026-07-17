'use client';

import type { ReactNode } from 'react';
import { COMPOSER_CHEVRON_BG, composerSelectClass } from '@/lib/composer-control-styles';

export function ComposerSelect({
  icon,
  value,
  onChange,
  title,
  ariaLabel,
  className = '',
  children,
}: {
  icon?: string;
  value: string;
  onChange: (value: string) => void;
  title?: string;
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`relative inline-flex max-w-full items-center ${className}`}>
      {icon ? (
        <span
          className="material-symbols-outlined pointer-events-none absolute left-2.5 z-10 shrink-0 text-base leading-none text-ink-500"
          aria-hidden
        >
          {icon}
        </span>
      ) : null}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={title}
        aria-label={ariaLabel}
        className={`${composerSelectClass} min-w-[5.75rem] max-w-full ${icon ? 'pl-8' : 'pl-2.5'}`}
        style={{ backgroundImage: COMPOSER_CHEVRON_BG }}
      >
        {children}
      </select>
    </div>
  );
}
