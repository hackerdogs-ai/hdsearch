// Local (self-hosted) email + password auth. This is the open-source alternative
// to Auth0 / hackerdogs-core: identities live in hd_search.users with a scrypt
// password_hash. The FIRST account created becomes the admin ("first-run setup",
// the Databasus/Directus model). After that, registration is closed unless
// HDSEARCH_OPEN_SIGNUP=true, so a solo self-host isn't left world-writable.
//
// These endpoints are PUBLIC (no requireAuth) — they establish identity. The web
// BFF calls them, then sets its encrypted session cookie; subsequent API calls use
// the internal-header path (auth.ts), which derives admin scope from users.role.
import { Hono } from 'hono';
import { z } from 'zod';
import { env } from '../env.js';
import { SCHEMA, query, tryQuery } from '../db.js';
import { hashPassword, verifyPassword, validatePassword } from '../password.js';
import { issueKey, listKeys, DEFAULT_SCOPES } from '../apikeys.js';
import { getAllowSignup } from '../runtime-config.js';
import { requireAuth } from '../auth.js';
import { rateLimit } from '../ratelimit.js';
import { emailEnabled, sendMail, maskEmail } from '../email.js';
import { issueToken, peekToken, consumeToken, revokeTokens, TOKEN_TTL_SEC } from '../auth-tokens.js';
import { recordDisclaimer } from '../consent.js';
import { log, errFields } from '../logger.js';

export const authLocalRoutes = new Hono();

/** Whether normal users may self-register. Open by default (the Databasus model);
 *  an admin can switch to invite-only, or HDSEARCH_OPEN_SIGNUP can force it via env.
 *  Precedence: admin toggle (runtime-config) → env (if explicitly set) → open. */
export function signupAllowed(): boolean {
  const admin = getAllowSignup();
  if (typeof admin === 'boolean') return admin;
  if (process.env.HDSEARCH_OPEN_SIGNUP != null) return env.openSignup;
  return true;
}

/** Stable local user id derived from the email. */
export function localUserId(email: string): string {
  return `local|${email.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

function gravatar(email: string): string {
  return `https://www.gravatar.com/avatar/${Buffer.from(email).toString('hex').slice(0, 32)}?d=identicon`;
}

/** Is there at least one administrator? An instance without one is unmanageable. */
export async function adminExists(): Promise<boolean> {
  const rows = await tryQuery<{ n: string }>(
    `select count(*)::int as n from ${SCHEMA}.users where role = 'admin'`,
  );
  return Number(rows[0]?.n || 0) > 0;
}

/** Any password-backed (local) account at all. */
async function localUserExists(): Promise<boolean> {
  const rows = await tryQuery<{ n: string }>(
    `select count(*)::int as n from ${SCHEMA}.users where password_hash is not null`,
  );
  return Number(rows[0]?.n || 0) > 0;
}

/**
 * First run = a genuinely fresh instance: no administrator AND no local accounts.
 * The create-admin screen is unauthenticated, so it must only ever appear on an
 * empty instance — if accounts already exist, letting any visitor claim admin
 * would be privilege escalation. That case is adminRecoveryRequired() instead.
 */
export async function isSetupRequired(): Promise<boolean> {
  return !(await adminExists()) && !(await localUserExists());
}

/**
 * Accounts exist but none is an admin — the instance is stranded. Recovery goes
 * through HDSEARCH_ADMIN_EMAIL/PASSWORD (server access), never a public form.
 */
export async function adminRecoveryRequired(): Promise<boolean> {
  return !(await adminExists()) && (await localUserExists());
}

// GET /v1/auth/status — drives the web login vs. first-run-setup screens.
authLocalRoutes.get('/status', async (c) => {
  const setupRequired = await isSetupRequired();
  // emailEnabled drives whether "forgot password" and magic-link sign-in are offered.
  return c.json({
    localAuthEnabled: true,
    setupRequired,
    openSignup: signupAllowed(),
    emailEnabled: await emailEnabled(),
    // Stranded instance: surface recovery instructions instead of a claim form.
    adminRecoveryRequired: await adminRecoveryRequired(),
  });
});

const RegisterSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200).optional(),
  password: z.string().min(1),
  // Terms are accepted at signup (checkbox gates the submit button), so the
  // separate post-login /disclaimer interstitial never fires for new accounts.
  // Optional here: accounts created by an admin out-of-band still get gated.
  acceptTerms: z.boolean().optional(),
  termsVersion: z.string().max(64).optional(),
});

// POST /v1/auth/register — create a local account. First account = admin.
authLocalRoutes.post('/register', async (c) => {
  const parsed = RegisterSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const email = parsed.data.email.trim();
  const name = parsed.data.name?.trim() || email.split('@')[0];
  const pwErr = validatePassword(parsed.data.password, email);
  if (pwErr) return c.json({ error: 'bad_request', message: pwErr }, 400);

  const setupRequired = await isSetupRequired();
  if (!setupRequired && !signupAllowed()) {
    return c.json({ error: 'registration_closed', message: 'registration is closed; ask an admin to create your account' }, 403);
  }

  // reject if the email is already taken
  const existing = await tryQuery<{ id: string }>(
    `select id from ${SCHEMA}.users where lower(email)=lower($1)`,
    [email],
  );
  if (existing.length) return c.json({ error: 'conflict', message: 'an account with that email already exists' }, 409);

  const role = setupRequired ? 'admin' : 'user';
  const id = localUserId(email);
  const picture = gravatar(email);
  const password_hash = hashPassword(parsed.data.password);

  await query(
    `insert into ${SCHEMA}.users (id, email, name, picture, plan, role, password_hash, updated_at)
       values ($1,$2,$3,$4,'free',$5,$6, now())
     on conflict (id) do update set
       email = excluded.email, name = excluded.name, picture = excluded.picture,
       role = excluded.role, password_hash = excluded.password_hash, updated_at = now()`,
    [id, email, name, picture, role, password_hash],
  );

  // auto-issue a default API key so the account can use the API immediately
  let apiKey: string | undefined;
  try {
    if (!(await listKeys(id)).length) {
      const { key } = await issueKey({ userId: id, name: 'Default', scopes: [...DEFAULT_SCOPES, 'admin:keys'] });
      apiKey = key;
    }
  } catch (e) {
    log.warn('auto-create API key failed (non-fatal)', { userId: id, ...errFields(e) });
  }

  // Record consent here rather than in the web BFF: the session cookie the BFF
  // sets is not readable within the same request, so doing it there would race.
  // Recording it with account creation also means the API enforces the same rule
  // for any client, not just our UI.
  if (parsed.data.acceptTerms) {
    try {
      await recordDisclaimer(id, parsed.data.termsVersion);
    } catch (e) {
      log.warn('recording signup consent failed (user will be gated)', { userId: id, ...errFields(e) });
    }
  }

  log.info('local account created', { userId: id, role, termsAccepted: !!parsed.data.acceptTerms });
  return c.json({ user: { sub: id, email, name, role, picture }, ...(apiKey ? { apiKey } : {}) });
});

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

// POST /v1/auth/login — verify credentials, return the identity (no token; the web
// BFF sets its own encrypted session cookie from this).
authLocalRoutes.post('/login', async (c) => {
  const parsed = LoginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const email = parsed.data.email.trim();

  const rows = await tryQuery<{ id: string; email: string; name: string; picture: string; role: string; password_hash: string }>(
    `select id, email, name, picture, role, password_hash from ${SCHEMA}.users where lower(email)=lower($1)`,
    [email],
  );
  const u = rows[0];
  // verify against the stored hash (verifyPassword is constant-time and false on null)
  if (!u || !verifyPassword(parsed.data.password, u.password_hash)) {
    return c.json({ error: 'invalid_credentials', message: 'incorrect email or password' }, 401);
  }
  return c.json({ user: { sub: u.id, email: u.email, name: u.name, role: u.role || 'user', picture: u.picture } });
});

// ---------------------------------------------------------------------------
// Password change / reset + magic-link sign-in.
//
// The email-sending endpoints are deliberately indistinguishable for known and
// unknown addresses: they always answer 200 with the same body, so they cannot be
// used to enumerate accounts. They are also rate limited per address, since they
// let an unauthenticated caller cause mail to be sent.
// ---------------------------------------------------------------------------

/** Uniform reply for the two "we may have emailed you" endpoints. */
const SENT = { sent: true, message: 'If that email is registered, a message is on its way.' } as const;

/** Throttle a public email-sending endpoint. Returns false when over the limit. */
async function emailRateOk(kind: string, email: string): Promise<boolean> {
  const r = await rateLimit(`email:${kind}:${email.toLowerCase()}`, 3); // 3/min per address
  return r.allowed;
}

async function userByEmail(email: string) {
  const rows = await tryQuery<{ id: string; email: string; name: string; picture: string; role: string }>(
    `select id, email, name, picture, role from ${SCHEMA}.users where lower(email)=lower($1)`,
    [email],
  );
  return rows[0];
}

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

// POST /v1/auth/change-password — signed-in user rotates their own password.
authLocalRoutes.post('/change-password', requireAuth(), async (c) => {
  const p = c.get('principal');
  const parsed = ChangePasswordSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);

  const rows = await tryQuery<{ email: string; password_hash: string }>(
    `select email, password_hash from ${SCHEMA}.users where id=$1`,
    [p.userId],
  );
  const u = rows[0];
  if (!u?.password_hash) {
    return c.json({ error: 'bad_request', message: 'this account has no local password' }, 400);
  }
  if (!verifyPassword(parsed.data.currentPassword, u.password_hash)) {
    return c.json({ error: 'invalid_credentials', message: 'current password is incorrect' }, 401);
  }
  const pwErr = validatePassword(parsed.data.newPassword, u.email);
  if (pwErr) return c.json({ error: 'bad_request', message: pwErr }, 400);
  if (verifyPassword(parsed.data.newPassword, u.password_hash)) {
    return c.json({ error: 'bad_request', message: 'new password must differ from the current one' }, 400);
  }

  await query(`update ${SCHEMA}.users set password_hash=$2, updated_at=now() where id=$1`,
    [p.userId, hashPassword(parsed.data.newPassword)]);
  // Any outstanding reset/magic links are stale once the password changes.
  await revokeTokens(p.userId);
  log.info('password changed', { userId: p.userId });
  return c.json({ changed: true });
});

const EmailOnlySchema = z.object({ email: z.string().email() });

// POST /v1/auth/forgot-password — email a single-use reset link.
authLocalRoutes.post('/forgot-password', async (c) => {
  const parsed = EmailOnlySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(SENT);       // same reply as success — no enumeration
  const email = parsed.data.email.trim();
  if (!(await emailRateOk('reset', email))) return c.json(SENT);
  if (!(await emailEnabled())) {
    return c.json({ error: 'unavailable', message: 'email is not configured on this server' }, 503);
  }

  const u = await userByEmail(email);
  if (u) {
    const token = await issueToken(u.id, 'reset');
    const link = `${env.appBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const mins = Math.round(TOKEN_TTL_SEC.reset / 60);
    await sendMail({
      to: u.email,
      subject: 'Reset your hdsearch password',
      text: `Someone asked to reset the password for your hdsearch account.\n\n`
        + `Open this link to choose a new one (valid for ${mins} minutes, single use):\n${link}\n\n`
        + `If this wasn't you, you can ignore this email — your password will not change.`,
    });
    log.info('password reset requested', { userId: u.id, email: maskEmail(u.email) });
  }
  return c.json(SENT);
});

const ResetSchema = z.object({ token: z.string().min(1), password: z.string().min(1) });

// POST /v1/auth/reset-password — redeem the link and set a new password.
authLocalRoutes.post('/reset-password', async (c) => {
  const parsed = ResetSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);

  // Validate BEFORE redeeming, so a rejected password doesn't burn the user's
  // single-use link and force them to request another email.
  const pending = await peekToken(parsed.data.token, 'reset');
  if (!pending) {
    return c.json({ error: 'invalid_token', message: 'this reset link is invalid or has expired' }, 400);
  }
  const rows = await tryQuery<{ email: string }>(`select email from ${SCHEMA}.users where id=$1`, [pending]);
  const pwErr = validatePassword(parsed.data.password, rows[0]?.email);
  if (pwErr) return c.json({ error: 'bad_request', message: pwErr }, 400);

  // Redeem atomically — this is what makes the link single-use under concurrency.
  const userId = await consumeToken(parsed.data.token, 'reset');
  if (!userId) {
    return c.json({ error: 'invalid_token', message: 'this reset link is invalid or has expired' }, 400);
  }
  await query(`update ${SCHEMA}.users set password_hash=$2, updated_at=now() where id=$1`,
    [userId, hashPassword(parsed.data.password)]);
  await revokeTokens(userId);
  log.info('password reset completed', { userId });
  return c.json({ reset: true });
});

// POST /v1/auth/magic-link — email a single-use sign-in link.
authLocalRoutes.post('/magic-link', async (c) => {
  const parsed = EmailOnlySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(SENT);
  const email = parsed.data.email.trim();
  if (!(await emailRateOk('magic', email))) return c.json(SENT);
  if (!(await emailEnabled())) {
    return c.json({ error: 'unavailable', message: 'email is not configured on this server' }, 503);
  }

  const u = await userByEmail(email);
  if (u) {
    const token = await issueToken(u.id, 'magic');
    const link = `${env.appBaseUrl}/api/auth/magic?token=${encodeURIComponent(token)}`;
    const mins = Math.round(TOKEN_TTL_SEC.magic / 60);
    await sendMail({
      to: u.email,
      subject: 'Your hdsearch sign-in link',
      text: `Open this link to sign in to hdsearch (valid for ${mins} minutes, single use):\n${link}\n\n`
        + `If you didn't request it, ignore this email — nobody can sign in without the link.`,
    });
    log.info('magic link requested', { userId: u.id, email: maskEmail(u.email) });
  }
  return c.json(SENT);
});

const MagicVerifySchema = z.object({ token: z.string().min(1) });

// POST /v1/auth/magic-verify — redeem a sign-in link, returning the identity for
// the web BFF to turn into a session cookie (same shape as /login).
authLocalRoutes.post('/magic-verify', async (c) => {
  const parsed = MagicVerifySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

  const userId = await consumeToken(parsed.data.token, 'magic');
  if (!userId) {
    return c.json({ error: 'invalid_token', message: 'this sign-in link is invalid or has expired' }, 400);
  }
  const rows = await tryQuery<{ id: string; email: string; name: string; picture: string; role: string }>(
    `select id, email, name, picture, role from ${SCHEMA}.users where id=$1`,
    [userId],
  );
  const u = rows[0];
  if (!u) return c.json({ error: 'invalid_token' }, 400);
  log.info('magic link sign-in', { userId: u.id });
  return c.json({ user: { sub: u.id, email: u.email, name: u.name, role: u.role || 'user', picture: u.picture } });
});
