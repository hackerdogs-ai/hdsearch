import { redirect } from 'next/navigation';
import Link from 'next/link';
import { POST_AUTH_LANDING_PATH } from '@/lib/routes';
import { Brand } from '@/components/brand';
import { getSession } from '@/lib/session';
import { ResendVerification } from '@/components/resend-verification';

export const dynamic = 'force-dynamic';

// Email-verification gate. Reached when a signed-in user's Auth0 email isn't verified.
export default function VerifyEmailPage() {
  const user = getSession();
  if (!user) redirect('/login');
  if (user.ev !== false) redirect(POST_AUTH_LANDING_PATH);

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-b from-brand-50 to-ink-50 px-4">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="mb-6 flex justify-center"><Brand /></div>
        <div className="mb-3 text-3xl">✉️</div>
        <h1 className="text-xl font-bold text-ink-900">Verify your email</h1>
        <p className="mt-2 text-sm text-ink-500">
          We sent a verification link to <span className="font-medium text-ink-800">{user.email}</span>.
          Click it to activate your account, then sign in again.
        </p>
        <div className="mt-6 space-y-3">
          <ResendVerification />
          <Link href="/api/auth/logout" className="btn-ghost w-full">I’ve verified — sign in again</Link>
        </div>
        <p className="mt-6 text-sm text-ink-400">
          Wrong address? <Link href="/api/auth/logout" className="hover:text-ink-700">Sign out</Link> and use a different account.
        </p>
      </div>
    </div>
  );
}
