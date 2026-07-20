import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { config } from './config';
import { api, ApiError, rethrowIfRedirect } from './api';
import { isDisclaimerAccepted } from './core-settings';
import { persistSessionFields, type SessionData } from './session';

/**
 * `?next=` for the disclaimer page — the path the user was heading to, set by
 * middleware as `x-pathname`. Only same-site absolute paths are passed through,
 * so a spoofed header cannot turn the post-acceptance redirect into an open one.
 */
function nextParam(): string {
  const p = headers().get('x-pathname') || '';
  if (!p.startsWith('/') || p.startsWith('//')) return '';
  if (p === '/disclaimer' || p.startsWith('/disclaimer?')) return '';
  return `?next=${encodeURIComponent(p)}`;
}

/** One-time disclaimer check — skipped when session already carries `da` (disclaimer accepted). */
export async function ensureDisclaimerGate(user: SessionData): Promise<void> {
  if (config.devLoginEnabled || user.da) return;

  let acc: { disclaimerAccepted?: boolean } | null = null;
  try {
    acc = await api.account();
  } catch (e) {
    rethrowIfRedirect(e);
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) redirect('/api/auth/logout');
  }

  if (acc?.disclaimerAccepted === true) {
    persistSessionFields(user, { da: true });
    return;
  }

  const accepted = await isDisclaimerAccepted(user, acc || undefined);
  // Carry the page the user was actually trying to reach, so accepting returns
  // them there. Without this every acceptance dumped the user on the search page,
  // even when they were on their way to Manage.
  if (!accepted) redirect(`/disclaimer${nextParam()}`);
  persistSessionFields(user, { da: true });
}
