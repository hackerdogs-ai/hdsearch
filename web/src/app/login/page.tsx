import Link from 'next/link';
import { Brand } from '@/components/brand';
import { AuthCard } from '@/components/auth-card';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

type AuthStatus = { localAuthEnabled: boolean; setupRequired: boolean; openSignup: boolean; emailEnabled?: boolean };

// Ask the API whether local auth is on and whether this is first-run (no admin yet).
async function getAuthStatus(): Promise<AuthStatus | null> {
  try {
    const res = await fetch(`${config.apiUrl}/v1/auth/status`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as AuthStatus;
  } catch {
    return null;
  }
}

const ERROR_LABELS: Record<string, string> = {
  invalid_credentials: 'Incorrect email or password.',
  invalid_token: 'That sign-in link is invalid or has expired. Request a new one.',
  registration_closed: 'Registration is closed — ask an admin to create your account.',
  conflict: 'An account with that email already exists. Try signing in.',
  missing_fields: 'Please enter your email and password.',
  api_unreachable: 'Could not reach the server. Is the API running?',
  bad_request: 'Please check your details and try again.',
};

// Sign-in page. Open-source default: local email + password stored in hd-search's own
// database. First run shows a "create admin account" form (the Databasus/Directus model);
// afterwards it shows sign-in. Auth0 is used instead only when AUTH0_* is configured.
export default async function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  const status = await getAuthStatus();
  const localAuth = !!status?.localAuthEnabled;
  const firstRun = !!status?.setupRequired;
  const devLogin = config.devLoginEnabled && !localAuth; // dev-login only if local auth is unavailable
  const errMsg = searchParams.error ? ERROR_LABELS[searchParams.error] || `Login failed (${searchParams.error}).` : null;

  // Local auth (the open-source default) renders the full onboarding card, which
  // handles first-run admin creation, sign-in, and self-service sign-up.
  if (localAuth) {
    return (
      <div className="grid min-h-screen place-items-center bg-gradient-to-b from-brand-50 to-ink-50 px-4">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex justify-center">
            <Brand />
          </div>
          <AuthCard firstRun={firstRun} openSignup={!!status?.openSignup} emailEnabled={!!status?.emailEnabled} error={errMsg} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-b from-brand-50 to-ink-50 px-4">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <h1 className="text-center text-xl font-bold text-ink-900">Sign in to hdsearch</h1>

        {errMsg && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-center text-sm text-red-700">{errMsg}</p>
        )}

        {devLogin ? (
          <form action="/api/auth/dev" method="post" className="mt-6 space-y-3">
            <div>
              <label className="label">Name</label>
              <input name="name" defaultValue="Dev User" className="input" />
            </div>
            <div>
              <label className="label">Email</label>
              <input name="email" type="email" defaultValue="dev@hackerdogs.ai" className="input" />
            </div>
            <button type="submit" className="btn-primary w-full">Continue (dev login)</button>
          </form>
        ) : (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-center text-sm text-amber-700">
            No authentication method is available. The API may be unreachable.
          </p>
        )}

        <p className="mt-6 text-center text-sm text-ink-400">
          <Link href="/" className="hover:text-ink-700">← Back to home</Link>
        </p>
      </div>
    </div>
  );
}
