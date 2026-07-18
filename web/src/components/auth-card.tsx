'use client';

import { useState } from 'react';
import Link from 'next/link';

// Local email+password onboarding, the Databasus/Directus model:
//  • firstRun (no admin yet)  → "Create your admin account" (this account becomes admin)
//  • otherwise                → Sign in, with a Sign-up toggle when signups are open
// Posts to the BFF /api/auth/local (mode register|login), which sets the session cookie.
// Confirm-password is validated here on the client before the form submits.
export function AuthCard({
  firstRun,
  openSignup,
  error,
}: {
  firstRun: boolean;
  openSignup: boolean;
  error?: string | null;
}) {
  // Sign-up view when it's first-run (create admin) or the user toggled to register.
  const [signup, setSignup] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const isRegister = firstRun || signup;

  const title = firstRun ? 'Create your admin account' : signup ? 'Create your account' : 'Sign in to hdsearch';
  const subtitle = firstRun
    ? 'This is the first run — the account you create becomes the administrator.'
    : signup
      ? 'Sign up with your email and a password.'
      : 'Access your dashboard, API keys and usage.';

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!isRegister) return; // sign-in has no confirm field
    const form = e.currentTarget;
    const pw = (form.elements.namedItem('password') as HTMLInputElement)?.value || '';
    const confirm = (form.elements.namedItem('confirm') as HTMLInputElement)?.value || '';
    if (pw.length < 8) {
      e.preventDefault();
      setClientError('Password must be at least 8 characters.');
      return;
    }
    if (pw !== confirm) {
      e.preventDefault();
      setClientError('Passwords do not match.');
      return;
    }
    setClientError(null);
  }

  return (
    <div className="card w-full max-w-sm p-8">
      <h1 className="text-center text-xl font-bold text-ink-900">{title}</h1>
      <p className="mt-1 text-center text-sm text-ink-500">{subtitle}</p>
      <p className="mt-3 text-center text-sm text-ink-500">
        By continuing you agree to our{' '}
        <Link href="/terms" className="text-brand-600 hover:underline">Terms of Service</Link>.
      </p>

      {(clientError || error) && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-center text-sm text-red-700">{clientError || error}</p>
      )}

      <form action="/api/auth/local" method="post" onSubmit={onSubmit} className="mt-6 space-y-3">
        <input type="hidden" name="mode" value={isRegister ? 'register' : 'login'} />

        {isRegister && (
          <div>
            <label className="label">Name</label>
            <input name="name" placeholder="Your name" className="input" autoComplete="name" />
          </div>
        )}

        <div>
          <label className="label">Email</label>
          <input name="email" type="email" required placeholder="you@example.com" className="input" autoComplete="email" />
        </div>

        <div>
          <label className="label">Password</label>
          <input
            name="password"
            type="password"
            required
            minLength={isRegister ? 8 : undefined}
            placeholder={isRegister ? 'At least 8 characters' : 'Your password'}
            className="input"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
          />
        </div>

        {isRegister && (
          <div>
            <label className="label">Confirm password</label>
            <input
              name="confirm"
              type="password"
              required
              placeholder="Re-enter your password"
              className="input"
              autoComplete="new-password"
            />
          </div>
        )}

        <button type="submit" className="btn-primary w-full">
          {firstRun ? 'Create admin account' : signup ? 'Create account' : 'Sign in'}
        </button>
      </form>

      {/* Toggle between sign-in and sign-up (never during first-run admin setup) */}
      {!firstRun && (
        <p className="mt-6 text-center text-sm text-ink-500">
          {signup ? (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => { setSignup(false); setClientError(null); }}
                className="font-medium text-brand-600 hover:underline"
              >
                Sign in
              </button>
            </>
          ) : openSignup ? (
            <>
              New here?{' '}
              <button
                type="button"
                onClick={() => { setSignup(true); setClientError(null); }}
                className="font-medium text-brand-600 hover:underline"
              >
                Create an account
              </button>
            </>
          ) : (
            <span className="text-ink-400">Registration is invite-only — ask an administrator for an account.</span>
          )}
        </p>
      )}

      <p className="mt-4 text-center text-sm text-ink-400">
        <Link href="/" className="hover:text-ink-700">← Back to home</Link>
      </p>
    </div>
  );
}
