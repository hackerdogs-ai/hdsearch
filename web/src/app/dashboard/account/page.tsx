import { Suspense } from 'react';
import { AccountKeysFallback, AccountKeysSection } from '@/components/account-keys-section';

export const dynamic = 'force-dynamic';

export default function AccountPage({
  searchParams,
}: {
  searchParams: { keys?: string };
}) {
  const keysCategory = searchParams.keys === 'llm' ? 'llm' : 'search';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink-900">Account</h1>

      <Suspense fallback={<AccountKeysFallback />}>
        <AccountKeysSection keysCategory={keysCategory} />
      </Suspense>
    </div>
  );
}
