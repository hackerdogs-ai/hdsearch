import 'server-only';
import { redirect } from 'next/navigation';
import { config } from './config';
import { api, ApiError, rethrowIfRedirect } from './api';
import { isDisclaimerAccepted } from './core-settings';
import { persistSessionFields, type SessionData } from './session';

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
  if (!accepted) redirect('/disclaimer');
  persistSessionFields(user, { da: true });
}
