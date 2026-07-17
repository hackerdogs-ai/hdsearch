'use client';

import { AiPageHeader } from './ai-page-header';
import { AiSearchPanel } from './ai-search-panel';

export function AiPage({
  initialQuery = '',
  signedIn = false,
  user,
}: {
  initialQuery?: string;
  signedIn?: boolean;
  user?: { name?: string | null; email?: string | null; picture?: string | null };
}) {
  return (
    <AiSearchPanel
      layout="fullscreen"
      initialQuery={initialQuery}
      signedIn={signedIn}
      headerUser={user}
    />
  );
}
