import { Brand } from '@/components/brand';
import { ResetPasswordForm } from '@/components/reset-password-form';

export const dynamic = 'force-dynamic';

export default function ResetPasswordPage({ searchParams }: { searchParams: { token?: string } }) {
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-b from-brand-50 to-ink-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <ResetPasswordForm token={searchParams.token || ''} />
      </div>
    </div>
  );
}
