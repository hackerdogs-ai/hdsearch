'use client';

import Link from 'next/link';
import { useState } from 'react';
import { TERMS_VERSION } from '@/lib/terms-meta';
import { POST_AUTH_LANDING_PATH } from '@/lib/routes';

// Accept the disclaimer (records consent via the BFF) and continue to the app.
export function AcceptDisclaimer({ next }: { next?: string }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/panel/accept-disclaimer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ termsVersion: TERMS_VERSION }),
      });
      if (!res.ok) throw new Error('could not record acceptance');
      // Return to the page that triggered the gate (e.g. Manage), not the
      // search screen. Guarded to same-site paths by the caller.
      window.location.href = next && next.startsWith('/') && !next.startsWith('//')
        ? next
        : POST_AUTH_LANDING_PATH;
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-2 text-sm text-ink-700">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5" />
        <span>
          I have read and agree to the{' '}
          <Link href="/terms" className="text-brand-600 hover:underline" target="_blank">
            Terms of Service
          </Link>.
        </span>
      </label>
      <button onClick={accept} disabled={!checked || busy} className="btn-primary w-full disabled:opacity-50">
        {busy ? 'Saving…' : 'Accept & continue'}
      </button>
      {error && <p className="text-sm text-amber-700">{error}</p>}
    </div>
  );
}
