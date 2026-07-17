'use client';

import { useMessageError } from '@assistant-ui/core/react';
import { useAuiState } from '@assistant-ui/react';
import { useAiSearch } from './ai-search-context';

export function AiMessageErrorBanner() {
  const { signInRequiredForAi } = useAiSearch();
  const errorDetail = useMessageError();
  const hideBecauseReplied = useAuiState(
    (s) =>
      s.message.role === 'assistant' &&
      s.message.content.some((p) => p.type === 'text' && p.text.trim().length > 0),
  );
  if (errorDetail === undefined || hideBecauseReplied) return null;

  const detailText =
    typeof errorDetail === 'string'
      ? errorDetail
      : typeof errorDetail === 'object' &&
          errorDetail !== null &&
          'message' in errorDetail &&
          typeof (errorDetail as { message?: unknown }).message === 'string'
        ? String((errorDetail as { message: string }).message)
        : null;

  const isAuthRequired = signInRequiredForAi && detailText?.toLowerCase().includes('sign in');

  if (isAuthRequired) {
    return (
      <div className="mb-2 flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3" role="alert">
        <span className="text-sm text-ink-700">Sign in to use AI Search</span>
        <a href="/login" className="btn-primary ml-auto text-sm">
          Sign In
        </a>
      </div>
    );
  }

  return (
    <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
      <strong className="font-medium">Error:</strong>{' '}
      {detailText ?? 'Something went wrong. Try another model or check your provider keys under Account.'}
    </div>
  );
}
