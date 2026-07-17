import { redirect } from 'next/navigation';
import { aiSearchHref } from '@/lib/ai-routes';

export const dynamic = 'force-dynamic';

/** Legacy `/ai` URLs redirect into the unified search experience. */
export default function AiSearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  redirect(aiSearchHref((searchParams.q || '').trim()));
}
