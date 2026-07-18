'use client';

import { useState } from 'react';
import { checkPassword, PASSWORD_HINT } from '@/components/auth-card';

/** Rotate your own password. Requires the current one, so a hijacked session
 *  alone cannot lock the owner out. */
export function ChangePassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function reset() {
    setCurrent(''); setPw(''); setConfirm(''); setOpen(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pwErr = checkPassword(pw);
    if (pwErr) return setMsg({ kind: 'err', text: pwErr });
    if (pw !== confirm) return setMsg({ kind: 'err', text: 'New passwords do not match.' });
    if (pw === current) return setMsg({ kind: 'err', text: 'New password must differ from the current one.' });

    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/panel/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: pw }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || d.message || 'Could not change your password.');
      setMsg({ kind: 'ok', text: 'Password updated.' });
      reset();
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Password</h2>
          <p className="mt-1 text-sm text-ink-500">Change the password you use to sign in.</p>
        </div>
        {!open && (
          <button type="button" onClick={() => { setOpen(true); setMsg(null); }} className="btn-ghost text-sm">
            Change password
          </button>
        )}
      </div>

      {msg && (
        <p className={`mt-3 rounded-md px-3 py-2 text-sm ${msg.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg.text}
        </p>
      )}

      {open && (
        <form onSubmit={submit} className="mt-4 max-w-sm space-y-3">
          <div>
            <label className="label">Current password</label>
            <input
              type="password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="input"
              autoComplete="current-password"
            />
          </div>
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
          <div className="flex items-center gap-2">
            <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">
              {busy ? 'Saving…' : 'Update password'}
            </button>
            <button type="button" onClick={reset} className="btn-ghost text-sm">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
