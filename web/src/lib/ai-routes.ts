import { searchHref } from './search-routes';

/** Canonical URL for AI Search within the unified search experience. */
export function aiSearchHref(q?: string): string {
  const trimmed = (q || '').trim();
  return searchHref({ modality: 'ai', ...(trimmed ? { q: trimmed } : {}) });
}

/** Whether a modality string refers to AI Search. */
export function isAiModality(modality: string): boolean {
  return modality === 'ai';
}
