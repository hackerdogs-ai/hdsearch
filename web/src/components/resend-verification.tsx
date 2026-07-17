'use client';

import { useState } from 'react';

// Resend the Auth0 verification email via the BFF (which calls hackerdogs-core).
export function ResendVerification() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  async function resend() {
    setState('sending');
    try {
      const res = await fetch('/api/auth/resend', { method: 'POST' });
      setState(res.ok ? 'sent' : 'error');
    } catch {
      setState('error');
    }
  }
  if (state === 'sent') return <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Verification email sent — check your inbox.</p>;
  return (
    <div>
      <button onClick={resend} disabled={state === 'sending'} className="btn-primary w-full disabled:opacity-60">
        {state === 'sending' ? 'Sending…' : 'Resend verification email'}
      </button>
      {state === 'error' && <p className="mt-2 text-sm text-amber-700">Couldn’t resend right now. Try again shortly.</p>}
    </div>
  );
}
