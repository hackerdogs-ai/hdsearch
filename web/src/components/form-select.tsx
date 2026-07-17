'use client';

import type { ReactNode, SelectHTMLAttributes } from 'react';

interface FormSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  /** stacked = label above; inline = label left of control */
  layout?: 'stacked' | 'inline';
  children: ReactNode;
}

export function FormSelect({
  label,
  layout = 'stacked',
  className = '',
  id,
  children,
  ...props
}: FormSelectProps) {
  const selectId = id ?? `select-${label.toLowerCase().replace(/\s+/g, '-')}`;
  const selectClass = `select ${layout === 'inline' ? 'min-w-[10rem]' : 'w-full'} ${className}`.trim();

  const control = (
    <select id={selectId} className={selectClass} {...props}>
      {children}
    </select>
  );

  if (layout === 'inline') {
    return (
      <div className="inline-flex items-center gap-2">
        <label htmlFor={selectId} className="shrink-0 text-sm font-medium text-ink-600">
          {label}
        </label>
        {control}
      </div>
    );
  }

  return (
    <div>
      <label htmlFor={selectId} className="label">
        {label}
      </label>
      {control}
    </div>
  );
}
