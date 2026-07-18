// Single-use, expiring tokens for password reset and magic-link sign-in.
//
// Security properties:
//   * only sha256(token) is persisted — a database leak cannot be replayed
//   * consumption is a single atomic UPDATE, so a token cannot be used twice
//     even under concurrent requests
//   * short lifetimes (reset 1h, magic link 15m)
//   * issuing a new token of a kind invalidates that user's outstanding ones
import { randomBytes, createHash } from 'node:crypto';
import { SCHEMA, query, tryQuery } from './db.js';
import { log, errFields } from './logger.js';

export type TokenKind = 'reset' | 'magic';

/** Lifetimes: a reset link may sit in an inbox; a sign-in link should not. */
export const TOKEN_TTL_SEC: Record<TokenKind, number> = {
  reset: 60 * 60, // 1 hour
  magic: 15 * 60, // 15 minutes
};

function hash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Mint a token for a user. Returns the RAW value — the only time it exists in
 * plaintext; it goes straight into the emailed link and is never logged or stored.
 */
export async function issueToken(userId: string, kind: TokenKind): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  const ttl = TOKEN_TTL_SEC[kind];
  // Supersede any outstanding token of this kind so an older email stops working.
  await query(`delete from ${SCHEMA}.auth_tokens where user_id = $1 and kind = $2`, [userId, kind]);
  await query(
    `insert into ${SCHEMA}.auth_tokens (token_hash, user_id, kind, expires_at)
     values ($1, $2, $3, now() + make_interval(secs => $4))`,
    [hash(raw), userId, kind, ttl],
  );
  return raw;
}

/**
 * Look up a token WITHOUT redeeming it, so callers can validate their input
 * before spending the user's single-use link. Never grants access on its own —
 * the caller must still consumeToken() to complete the action.
 */
export async function peekToken(raw: string, kind: TokenKind): Promise<string | null> {
  if (!raw) return null;
  try {
    const rows = await tryQuery<{ user_id: string }>(
      `select user_id from ${SCHEMA}.auth_tokens
        where token_hash = $1 and kind = $2 and used_at is null and expires_at > now()`,
      [hash(raw), kind],
    );
    return rows[0]?.user_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Atomically redeem a token. Returns the user id, or null when the token is
 * unknown, of the wrong kind, already used, or expired — the caller must not
 * distinguish these cases to the client.
 */
export async function consumeToken(raw: string, kind: TokenKind): Promise<string | null> {
  if (!raw) return null;
  try {
    const rows = await query<{ user_id: string }>(
      `update ${SCHEMA}.auth_tokens
          set used_at = now()
        where token_hash = $1
          and kind = $2
          and used_at is null
          and expires_at > now()
      returning user_id`,
      [hash(raw), kind],
    );
    return rows[0]?.user_id ?? null;
  } catch (e) {
    log.warn('consumeToken failed', errFields(e));
    return null;
  }
}

/** Drop a user's outstanding tokens — called after a password change or reset. */
export async function revokeTokens(userId: string, kind?: TokenKind): Promise<void> {
  try {
    if (kind) {
      await query(`delete from ${SCHEMA}.auth_tokens where user_id = $1 and kind = $2`, [userId, kind]);
    } else {
      await query(`delete from ${SCHEMA}.auth_tokens where user_id = $1`, [userId]);
    }
  } catch (e) {
    log.debug('revokeTokens failed', errFields(e));
  }
}

/** Housekeeping: remove expired/used rows. Best-effort, called on a timer at boot. */
export async function purgeExpiredTokens(): Promise<number> {
  const rows = await tryQuery<{ token_hash: string }>(
    `delete from ${SCHEMA}.auth_tokens
      where expires_at < now() - interval '1 day' or used_at is not null
      returning token_hash`,
  );
  return rows.length;
}
