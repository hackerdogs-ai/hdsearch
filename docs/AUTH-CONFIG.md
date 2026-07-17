# HD-Search — Authentication Configuration

Self-hosted HD-Search uses **local email + password** accounts stored in its own
database. There is no external identity provider, no SSO dependency, and nothing
to register with a third party — a dev clones the repo, runs it, and creates an
admin account in the browser.

---

## 1. How it works (30-second tour)

HD-Search is a **Next.js web app (BFF) + a Hono API**. Auth uses the
Backend-For-Frontend pattern:

```
Browser ──▶ hd-search WEB (BFF)                          hd-search API
            │  email + password  ──POST /v1/auth/login──▶ (verifies scrypt hash)
            │                                    ◀── { user, role }
            ▼
          WEB stores the identity in an AES-256-GCM ENCRYPTED httpOnly cookie
          WEB ──▶ API   with   X-HD-Internal: <shared secret> + X-HD-User: <id>
          API trusts the shared internal secret, looks up the user's role in the DB
```

Security properties:

- **Passwords** are hashed with **scrypt** (Node's built-in KDF — no external
  dependency), never stored or logged in plaintext.
- The **session cookie** (`hd_session`) is **AES-256-GCM encrypted**, `httpOnly`,
  `Secure`, `SameSite=Lax` — unreadable from browser JS and tamper-evident.
- The web↔API trust is a **shared internal secret** (`X-HD-Internal`) that is
  **auto-generated** and shared via a Docker volume — see §5. No token ever
  reaches the browser.

---

## 2. First-run admin setup

On the very first run there are no accounts, so:

- **Via the UI (default):** open the app → you get a **"Create your admin
  account"** screen. The first account created becomes the administrator.
- **Headless (Docker/CI):** set both env vars and the admin is created on first
  boot instead:
  ```bash
  HDSEARCH_ADMIN_EMAIL=admin@example.com
  HDSEARCH_ADMIN_PASSWORD=at-least-8-characters
  ```

There is **no hard-coded default password** — you always set one on first run.

---

## 3. Registration & roles

- **After the admin exists, registration is closed.** Additional accounts can't
  be self-created unless you opt in:
  ```bash
  HDSEARCH_OPEN_SIGNUP=true      # allow self-service signup
  ```
- **Roles:** `admin` and `user`, stored in the `role` column of `hd_search.users`.
  - `admin` gets the `admin:platform` scope → System Admin pages, system-wide
    provider keys, and other admin-only endpoints.
  - `user` gets standard search/crawl/vector + own-API-key scopes.
- Admin is derived **from the DB role** on every request (the internal-header
  path in [`api/src/auth.ts`](../api/src/auth.ts)), so promoting a user is a DB
  update, not a config change. `GET /v1/account` returns the caller's `role`.

Public auth endpoints (called by the web BFF, then it sets the session cookie):
`GET /v1/auth/status` · `POST /v1/auth/register` · `POST /v1/auth/login`.

---

## 4. API keys

Programmatic access uses `sk-hds-…` API keys (independent of the web session):

- **UI:** Account → API Keys. A default key is issued when your account is created
  (shown once).
- **CLI:** `docker compose -f docker-compose.selfhost.yml exec hds-api node
  dist/scripts/hds-keys.js issue --user me --name laptop`.

Keys are sha-256 hashed in the DB with per-key scopes; send them as
`Authorization: Bearer sk-hds-…`.

---

## 5. Secrets — no configuration required

You do **not** set any auth secret. On first boot the API generates:

| Secret | Used for |
|---|---|
| internal secret | web↔API trust (`X-HD-Internal`) |
| web session secret | encrypting the `hd_session` cookie |
| encryption key | AES-256-GCM encryption of stored provider keys |

They are persisted to the shared **`hds-secrets`** Docker volume (`/secrets` in
both containers, uid 10001, `0600`), so the API and web agree automatically and
the values survive restarts. Resolution is **env → shared file → generate**, so
you *can* pin any of them via env, but you never need to.

- **Back up the `hds-secrets` volume** — losing the encryption key makes stored
  provider keys unrecoverable.
- The web waits for the API to be healthy on startup so the shared secret already
  exists when it reads it.

---

## 6. Behind a reverse proxy

Auth redirects and the session cookie follow `X-Forwarded-Host` /
`X-Forwarded-Proto` (then `Host`), so the cookie lands on the origin you actually
browse — `localhost`, a custom port, or your public domain. Ensure your proxy
forwards those headers (Caddy/Nginx do by default) so the cookie is marked
`Secure` for your real origin. Set `APP_BASE_URL` (and `PUBLIC_API_URL`) to your
public `https://…` in production.

---

## 7. Disclaimer / terms gate

First sign-in is gated by a **Terms of Service** acceptance screen until accepted;
acceptance is stored per user (Redis, keyed by user id). Replace the placeholder
legal text in
[`web/src/app/disclaimer/page.tsx`](../web/src/app/disclaimer/page.tsx) and
`web/src/app/terms/` with your own reviewed copy before a public deployment.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Create admin account" never appears | An account already exists. Use the **Sign in** form, or reset by wiping the DB volume (`docker compose … down -v`). |
| Login says "incorrect email or password" | Wrong credentials, or the account was created headlessly with a different `HDSEARCH_ADMIN_PASSWORD`. |
| "registration is closed" on signup | Expected after the admin exists. Set `HDSEARCH_OPEN_SIGNUP=true` to allow signups. |
| Signed in but dashboard 401s / redirects to login | The web and API aren't sharing the internal secret — confirm both mount the `hds-secrets` volume and the web started **after** the API became healthy. |
| Behind a proxy, login loops | Proxy must forward `X-Forwarded-Host` / `X-Forwarded-Proto`; set `APP_BASE_URL` to the public origin. |
| Admin user has no System Admin access | The `role` column isn't `admin` for that user — the first account (or the headless `HDSEARCH_ADMIN_*` account) is admin; others default to `user`. |

---

## 9. Security notes

- **No secrets in env or in the browser.** Crypto secrets are auto-generated
  server-side; the session cookie is encrypted and `httpOnly`.
- **Passwords** use scrypt with a per-hash salt; verification is constant-time.
- **Rotate** by deleting the relevant key from the `hds-secrets` volume (a new one
  regenerates): removing the web session secret invalidates all sessions; removing
  the encryption key makes existing stored provider keys unreadable (re-enter
  them).
- Keep `HDSEARCH_OPEN_SIGNUP` off unless you intend public registration.
- Provider API keys are stored **AES-256-GCM encrypted** in the DB and entered via
  the UI — never in env or the repo.

> Legacy note: `HDSEARCH_AUTH_MODE` (`legacy`/`both`/`core`) and the Auth0 +
> hackerdogs-core JWT path still exist in the code for the non-self-host
> deployment, but are **not used** by the self-host stack, which runs
> `HDSEARCH_AUTH_MODE=legacy` with local accounts.
