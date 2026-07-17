// One-time disclaimer / terms acceptance, keyed by user id. Stored in Redis (db 5, key
// `hds:consent:<sub>`). Value is JSON: { at, termsVersion } or legacy ISO timestamp.
import { redis, k } from './store.js';
import { log, errFields } from './logger.js';

const consentKey = (userId: string) => k('consent', userId);

type ConsentRecord = { at: string; termsVersion?: string };

function parseConsent(raw: string | null): ConsentRecord | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as ConsentRecord;
    if (j?.at) return j;
  } catch {
    /* legacy plain ISO timestamp */
  }
  return { at: raw };
}

export async function hasAcceptedDisclaimer(userId: string): Promise<boolean> {
  try {
    return !!parseConsent(await redis.get(consentKey(userId)));
  } catch (e) {
    log.warn('consent read failed', errFields(e));
    return false;
  }
}

export async function acceptedAt(userId: string): Promise<string | null> {
  try {
    return parseConsent(await redis.get(consentKey(userId)))?.at ?? null;
  } catch {
    return null;
  }
}

export async function acceptedTermsVersion(userId: string): Promise<string | null> {
  try {
    return parseConsent(await redis.get(consentKey(userId)))?.termsVersion ?? null;
  } catch {
    return null;
  }
}

/** Record acceptance (idempotent). Returns the timestamp stored. */
export async function recordDisclaimer(userId: string, termsVersion?: string): Promise<string> {
  const at = new Date().toISOString();
  const record: ConsentRecord = { at, ...(termsVersion ? { termsVersion } : {}) };
  try {
    const existing = parseConsent(await redis.get(consentKey(userId)));
    if (existing) return existing.at;
    await redis.set(consentKey(userId), JSON.stringify(record));
  } catch (e) {
    log.warn('consent write failed', errFields(e));
  }
  return at;
}
