'use client';

import { useEffect, useState } from 'react';

// Admin control for self-registration (the Databasus "external registrations" toggle).
// Open  → anyone can create an account from the sign-in page.
// Invite-only → the sign-up form is hidden; admins create accounts.
export function SignupPolicy() {
  const [allow, setAllow] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/panel/signup')
      .then((r) => r.json())
      .then((d) => setAllow(!!d.allowSignup))
      .catch(() => setErr('Could not load the current policy.'));
  }, []);

  async function set(next: boolean) {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch('/api/panel/signup', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allow: next }),
      });
      if (!r.ok) throw new Error();
      setAllow(next);
    } catch {
      setErr('Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-ink-100 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">User registration</h2>
          <p className="mt-0.5 text-sm text-ink-500">
            {allow === null
              ? 'Loading…'
              : allow
                ? 'Open — anyone can create an account from the sign-in page.'
                : 'Invite-only — the sign-up form is hidden; you create accounts.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!allow}
          disabled={allow === null || saving}
          onClick={() => set(!allow)}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
            allow ? 'bg-brand-500' : 'bg-ink-300'
          } ${allow === null || saving ? 'opacity-50' : ''}`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${allow ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}
