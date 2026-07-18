import { Brand } from '@/components/brand';
import { ForgotPasswordForm } from '@/components/forgot-password-form';

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-b from-brand-50 to-ink-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
