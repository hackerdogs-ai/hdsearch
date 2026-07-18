'use client';

import { useState } from 'react';
import Link from 'next/link';

/**
 * Request a password-reset link. The server answers identically whether or not
 * the address is registered, so this screen must not imply the account exists.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'forgot', email }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 503) {
        setError(d.message || 'Email is not configured on this server. Ask an administrator to reset your password.');
        return;
      }
      if (!r.ok) throw new Error(d.message || 'Something went wrong.');
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="card w-full p-8 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-green-100 text-2xl text-green-700">✓</div>
        <h1 className="text-xl font-bold text-ink-900">Check your email</h1>
        <p className="mt-2 text-sm text-ink-500">
          If <strong>{email}</strong> is registered, a reset link is on its way. It expires in one hour and can be
          used once.
        </p>
        <Link href="/login" className="btn-primary mt-6 inline-block">Back to sign-in</Link>
      </div>
    );
  }

  return (
    <div className="card w-full p-8">
      <h1 className="text-center text-xl font-bold text-ink-900">Reset your password</h1>
      <p className="mt-1 text-center text-sm text-ink-500">
        Enter your email and we&apos;ll send you a link to choose a new password.
      </p>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}

      <form onSubmit={submit} className="mt-6 space-y-3">
        <div>
          <label className="label">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="input"
            autoComplete="email"
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-50">
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-400">
        <Link href="/login" className="hover:text-ink-700">← Back to sign-in</Link>
      </p>
    </div>
  );
}
