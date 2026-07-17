'use client';

import { useEffect, useState, type ReactNode } from 'react';

const SWEEP_KEY = 'hds_composer_sweep_shown';

/** One-time green left-to-right sweep on first visit (ChatGPT-style landing polish). */
export function ComposerWelcomeSweep({ children }: { children: ReactNode }) {
  const [sweep, setSweep] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(SWEEP_KEY) === '1') return;
      localStorage.setItem(SWEEP_KEY, '1');
      setSweep(true);
      const t = window.setTimeout(() => setSweep(false), 1400);
      return () => window.clearTimeout(t);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className={`relative w-full ${sweep ? 'hds-composer-sweep' : ''}`}>
      {children}
    </div>
  );
}
