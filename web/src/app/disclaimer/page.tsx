import Link from 'next/link';
import { redirect } from 'next/navigation';
import { POST_AUTH_LANDING_PATH } from '@/lib/routes';
import { Brand } from '@/components/brand';
import { getSession } from '@/lib/session';
import { isDisclaimerAccepted } from '@/lib/core-settings';
import { AcceptDisclaimer } from '@/components/accept-disclaimer';
import { TermsDocument } from '@/components/terms-document';
import { getTermsMarkdown } from '@/lib/terms';

export const dynamic = 'force-dynamic';

// One-time terms / disclaimer gate, shown after first sign-in until accepted.
export default async function DisclaimerPage() {
  const user = getSession();
  if (!user) redirect('/login');
  if (user.ev === false) redirect('/verify-email');
  const accepted = await isDisclaimerAccepted(user);
  if (accepted) redirect(POST_AUTH_LANDING_PATH);

  const terms = getTermsMarkdown();

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-b from-brand-50 to-ink-50 px-4 py-10">
      <div className="card w-full max-w-2xl p-8">
        <div className="mb-6 flex justify-center"><Brand /></div>
        <h1 className="text-center text-xl font-bold text-ink-900">Terms of Service</h1>
        <p className="mt-1 text-center text-sm text-ink-500">
          Please read and accept before continuing.{' '}
          <Link href="/terms" className="text-brand-600 hover:underline" target="_blank">
            Open full page
          </Link>
        </p>

        <div className="mt-6">
          <TermsDocument content={terms} />
        </div>

        <div className="mt-6">
          <AcceptDisclaimer />
        </div>
      </div>
    </div>
  );
}
