'use client';

import { useState } from 'react';
import Link from 'next/link';
import { checkPassword, PASSWORD_HINT } from '@/components/auth-card';

/** Redeem a reset link and set a new password. The token is single-use. */
export function ResetPasswordForm({ token }: { token: string }) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pwErr = checkPassword(pw);
    if (pwErr) return setError(pwErr);
    if (pw !== confirm) return setError('Passwords do not match.');

    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'reset', token, password: pw }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || 'Could not reset your password.');
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="card w-full p-8 text-center">
        <h1 className="text-xl font-bold text-ink-900">Link is missing its token</h1>
        <p className="mt-2 text-sm text-ink-500">Open the link from your email again, or request a new one.</p>
        <Link href="/forgot-password" className="btn-primary mt-6 inline-block">Request a new link</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card w-full p-8 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-green-100 text-2xl text-green-700">✓</div>
        <h1 className="text-xl font-bold text-ink-900">Password updated</h1>
        <p className="mt-2 text-sm text-ink-500">You can now sign in with your new password.</p>
        <Link href="/login" className="btn-primary mt-6 inline-block">Sign in →</Link>
      </div>
    );
  }

  return (
    <div className="card w-full p-8">
      <h1 className="text-center text-xl font-bold text-ink-900">Choose a new password</h1>

      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}

      <form onSubmit={submit} className="mt-6 space-y-3">
        <div>
          <label className="label">New password</label>
          <input
            type="password"
            required
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className="input"
            autoComplete="new-password"
          />
          <p className={`mt-1 text-sm ${pw && checkPassword(pw) ? 'text-ink-500' : 'text-green-600'}`}>
            {pw ? checkPassword(pw) || 'Strong password ✓' : PASSWORD_HINT}
          </p>
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <input
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="input"
            autoComplete="new-password"
          />
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-50">
          {busy ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </div>
  );
}
