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
import { log, errFields } from '../logger.js';

export const authLocalRoutes = new Hono();

/** Stable local user id derived from the email. */
export function localUserId(email: string): string {
  return `local|${email.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

function gravatar(email: string): string {
  return `https://www.gravatar.com/avatar/${Buffer.from(email).toString('hex').slice(0, 32)}?d=identicon`;
}

/** First-run when there are no local accounts yet (no password-backed users). */
export async function isSetupRequired(): Promise<boolean> {
  const rows = await tryQuery<{ n: string }>(
    `select count(*)::int as n from ${SCHEMA}.users where password_hash is not null`,
  );
  return Number(rows[0]?.n || 0) === 0;
}

// GET /v1/auth/status — drives the web login vs. first-run-setup screens.
authLocalRoutes.get('/status', async (c) => {
  const setupRequired = await isSetupRequired();
  return c.json({ localAuthEnabled: true, setupRequired, openSignup: env.openSignup });
});

const RegisterSchema = z.object({
  email: z.string().email(),
  name: z.string().max(200).optional(),
  password: z.string().min(1),
});

// POST /v1/auth/register — create a local account. First account = admin.
authLocalRoutes.post('/register', async (c) => {
  const parsed = RegisterSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad_request', issues: parsed.error.issues }, 400);
  const email = parsed.data.email.trim();
  const name = parsed.data.name?.trim() || email.split('@')[0];
  const pwErr = validatePassword(parsed.data.password);
  if (pwErr) return c.json({ error: 'bad_request', message: pwErr }, 400);

  const setupRequired = await isSetupRequired();
  if (!setupRequired && !env.openSignup) {
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

  log.info('local account created', { userId: id, role });
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
