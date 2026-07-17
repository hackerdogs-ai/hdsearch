// Next.js redirect()/notFound() throw special errors that must propagate — never swallow in catch.
import 'server-only';

export function isRedirectError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return false;
  return String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT');
}

/** Re-throw redirect/notFound errors so automatic logout redirects are not caught as API failures. */
export function rethrowIfRedirect(error: unknown): void {
  if (isRedirectError(error)) throw error;
}
