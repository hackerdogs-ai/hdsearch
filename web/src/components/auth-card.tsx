'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TERMS_VERSION } from '@/lib/terms-meta';

const MIN_LENGTH = 12;
const PASSPHRASE_LENGTH = 16;
const COMMON = [
  'password', 'passw0rd', 'letmein', 'welcome', 'admin', 'administrator', 'qwerty',
  'azerty', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'sunshine',
  'princess', 'superman', 'trustno1', 'changeme', 'default', 'secret', 'access',
  'master', 'shadow', 'michael', 'jennifer', 'hunter2', 'abc123', 'qazwsx',
  'starwars', 'whatever', 'freedom', 'ninja', 'login', 'hdsearch', 'hackerdogs',
];

function hasLongSequence(s: string): boolean {
  const lower = s.toLowerCase();
  let run = 1;
  for (let i = 1; i < lower.length; i++) {
    const d = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    run = d === 1 || d === -1 ? run + 1 : 1;
    if (run >= 5) return true;
  }
  return false;
}

/** Shown under an empty password field, and reused by the reset-password form. */
export const PASSWORD_HINT =
  `At least ${MIN_LENGTH} characters. A ${PASSPHRASE_LENGTH}+ character passphrase needs nothing else; ` +
  `shorter ones need 3 of: lowercase, uppercase, number, symbol.`;

/** Mirrors the server policy in api/src/password.ts so errors surface before submit. */
export function checkPassword(pw: string, identifier?: string): string | null {
  if (pw.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters.`;
  if (pw.length > 200) return 'Password is too long.';
  if (pw.trim().length !== pw.length) return 'Password cannot start or end with a space.';
  const lower = pw.toLowerCase();
  if (identifier) {
    const id = identifier.trim().toLowerCase();
    const local = id.split('@')[0] || '';
    if (id.length >= 3 && lower.includes(id)) return 'Password must not contain your email.';
    if (local.length >= 3 && lower.includes(local)) return 'Password must not contain your name or email.';
  }
  if (COMMON.some((w) => lower.includes(w))) return 'That password is too common — choose something less guessable.';
  if (/^(.)\1+$/.test(pw)) return 'Password cannot be a single repeated character.';
  if (hasLongSequence(pw)) return 'Password cannot contain long sequences like 12345 or abcde.';
  if (pw.length >= PASSPHRASE_LENGTH) return null;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (classes < 3) {
    return `Passwords under ${PASSPHRASE_LENGTH} characters need at least 3 of: lowercase, uppercase, number, symbol — or use a longer passphrase.`;
  }
  return null;
}

// Local email+password onboarding, the Databasus/Directus model:
//  • firstRun (no admin yet)  → "Create your admin account" (this account becomes admin)
//  • otherwise                → Sign in, with a Sign-up toggle when signups are open
// Posts to the BFF /api/auth/local (mode register|login), which sets the session cookie.
// Confirm-password is validated here on the client before the form submits.
export function AuthCard({
  firstRun,
  openSignup,
  emailEnabled = false,
  error,
}: {
  firstRun: boolean;
  openSignup: boolean;
  /** SMTP configured → offer password reset and magic-link sign-in. */
  emailEnabled?: boolean;
  error?: string | null;
}) {
  // Sign-up view when it's first-run (create admin) or the user toggled to register.
  const [signup, setSignup] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [magic, setMagic] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const [magicBusy, setMagicBusy] = useState(false);
  // Terms are accepted here, at signup, so the post-login /disclaimer
  // interstitial never fires for new accounts. Reset when toggling views so
  // switching sign-in <-> sign-up can't carry an acceptance across.
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const isRegister = firstRun || signup;

  const title = firstRun ? 'Create your admin account' : signup ? 'Create your account' : 'Sign in to hdsearch';
  const subtitle = firstRun
    ? null
    : signup
      ? 'Sign up with your email and a password.'
      : 'Access your dashboard, API keys and usage.';

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!isRegister) return; // sign-in has no confirm field
    const form = e.currentTarget;
    const pw = (form.elements.namedItem('password') as HTMLInputElement)?.value || '';
    const confirm = (form.elements.namedItem('confirm') as HTMLInputElement)?.value || '';
    const email = (form.elements.namedItem('email') as HTMLInputElement)?.value || '';
    const pwErr = checkPassword(pw, email);
    if (pwErr) {
      e.preventDefault();
      setClientError(pwErr);
      return;
    }
    if (pw !== confirm) {
      e.preventDefault();
      setClientError('Passwords do not match.');
      return;
    }
    setClientError(null);
  }

  async function sendMagicLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = (new FormData(e.currentTarget).get('email') as string) || '';
    setMagicBusy(true);
    setClientError(null);
    try {
      const r = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'magic', email }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || 'Could not send a sign-in link.');
      setMagicSent(true);
    } catch (err) {
      setClientError((err as Error).message);
    } finally {
      setMagicBusy(false);
    }
  }

  // Magic-link view: ask for an email, then confirm it was (maybe) sent.
  if (magic) {
    return (
      <div className="card w-full max-w-sm p-8">
        {magicSent ? (
          <div className="text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-green-100 text-2xl text-green-700">✓</div>
            <h1 className="text-xl font-bold text-ink-900">Check your email</h1>
            <p className="mt-2 text-sm text-ink-500">
              If that address is registered, a sign-in link is on its way. It expires in 15 minutes and can be used once.
            </p>
            <button
              type="button"
              onClick={() => { setMagic(false); setMagicSent(false); }}
              className="btn-ghost mt-6 text-sm"
            >
              ← Back to sign-in
            </button>
          </div>
        ) : (
          <>
            <h1 className="text-center text-xl font-bold text-ink-900">Email me a sign-in link</h1>
            <p className="mt-1 text-center text-sm text-ink-500">No password needed — we&apos;ll send a one-time link.</p>
            {clientError && (
              <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-center text-sm text-red-700">{clientError}</p>
            )}
            <form onSubmit={sendMagicLink} className="mt-6 space-y-3">
              <div>
                <label className="label">Email</label>
                <input name="email" type="email" required placeholder="you@example.com" className="input" autoComplete="email" />
              </div>
              <button type="submit" disabled={magicBusy} className="btn-primary w-full disabled:opacity-50">
                {magicBusy ? 'Sending…' : 'Send sign-in link'}
              </button>
            </form>
            <p className="mt-6 text-center text-sm text-ink-500">
              <button type="button" onClick={() => setMagic(false)} className="font-medium text-brand-600 hover:underline">
                Use a password instead
              </button>
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="card w-full max-w-sm p-8">
      <h1 className="text-center text-xl font-bold text-ink-900">{title}</h1>
      {subtitle && <p className="mt-1 text-center text-sm text-ink-500">{subtitle}</p>}
      {!isRegister && (
        <p className="mt-3 text-center text-sm text-ink-500">
          By continuing you agree to our{' '}
          <Link href="/terms" className="text-brand-600 hover:underline">Terms of Service</Link>.
        </p>
      )}

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
            minLength={isRegister ? MIN_LENGTH : undefined}
            placeholder={isRegister ? `At least ${MIN_LENGTH} characters` : 'Your password'}
            className="input"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            onChange={isRegister ? (e) => setPw(e.target.value) : undefined}
          />
          {isRegister && (
            <p className={`mt-1 text-sm ${pw && checkPassword(pw) ? 'text-ink-500' : 'text-green-600'}`}>
              {pw
                ? checkPassword(pw) || 'Strong password ✓'
                : PASSWORD_HINT}
            </p>
          )}
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

        {isRegister && (
          <label className="flex items-start gap-2 pt-1 text-sm text-ink-700">
            <input
              type="checkbox"
              name="acceptTerms"
              value="1"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I have read and agree to the{' '}
              <Link href="/terms" target="_blank" className="text-brand-600 hover:underline">
                Terms of Service
              </Link>
              .
            </span>
          </label>
        )}
        <input type="hidden" name="termsVersion" value={TERMS_VERSION} />

        <button
          type="submit"
          disabled={isRegister && !acceptedTerms}
          title={isRegister && !acceptedTerms ? 'Accept the Terms of Service to continue' : undefined}
          className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
        >
          {firstRun ? 'Create admin account' : signup ? 'Create account' : 'Sign in'}
        </button>
      </form>

      {!isRegister && emailEnabled && (
        <div className="mt-4 space-y-2 text-center text-sm">
          <button type="button" onClick={() => setMagic(true)} className="font-medium text-brand-600 hover:underline">
            Email me a sign-in link instead
          </button>
          <p>
            <Link href="/forgot-password" className="text-ink-400 hover:text-ink-700">Forgot your password?</Link>
          </p>
        </div>
      )}

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
