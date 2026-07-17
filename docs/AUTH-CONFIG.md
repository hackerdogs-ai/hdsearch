# HD-Search — Authentication Configuration (step by step)

How to configure sign-in for hd-search. There are **two modes**:

- **Dev login** — a local email-only login, no Auth0 needed. For local development only.
- **Auth0 SSO** — the real, secure path: the same Auth0 tenant as worldmonitor/Streamlit, so a
  user signed in to any Hackerdogs product is signed in to hd-search.

> Companion design doc: [`AUTH_PLAN_INTEGRATION.md`](AUTH_PLAN_INTEGRATION.md).

---

## 1. How it works (30-second tour)

hd-search is a **Next.js web app (BFF) + a Hono API**. Auth uses the **Backend-For-Frontend
pattern**, which is the secure standard for an app that has a server:

```
Browser ──▶ hd-search WEB (BFF)                         hd-search API
            │  Auth0 Authorization Code + PKCE          (validates the JWT)
            │  (server-side, no tokens in the browser)
            ▼
          Auth0  ──id_token──▶  WEB  ──POST /auth/token-exchange──▶  hackerdogs-core
                                                              ◀── Hackerdogs JWT (HS256)
          WEB stores {JWT + Auth0 refresh token} in an AES-256-GCM ENCRYPTED httpOnly cookie
          WEB ──▶ API   with   Authorization: Bearer <JWT>   (NOT a self-asserted header)
          API verifies the JWT signature (shared JWT_SECRET_KEY) → identity = sub, plan via /auth/me
```

Security properties: tokens **never reach browser JavaScript** (httpOnly, encrypted cookie);
the API trusts only a **cryptographically-signed JWT**; PKCE means **no client secret** is
required. Identity is the Auth0 `sub`, shared with hackerdogs-core (so no data migration).

**Cookies set by the flow:** `hd_session` (encrypted session), `hd_oauth_state` (CSRF, login
only), `hd_pkce` (PKCE verifier, login only).

---

## 2. Quick start — local dev (dev login, no Auth0)

Minimum to run hd-search locally with a fake user.

**`web/.env`**
```bash
HDSEARCH_API_URL=http://127.0.0.1:8791
HDSEARCH_INTERNAL_SECRET=<same value as the API’s>   # openssl rand -hex 32
HDSEARCH_WEB_SESSION_SECRET=<random>                 # openssl rand -hex 32
APP_BASE_URL=http://localhost:3030
HDSEARCH_DEV_LOGIN=1            # enable the local dev login
# leave AUTH0_* unset
```

**`api/.env`**
```bash
HDSEARCH_AUTH_MODE=both        # accept the dev BFF header AND a real JWT
HDSEARCH_INTERNAL_SECRET=<same value as the web’s>
```

Run both, open `http://localhost:3030/login`, use the **dev login** form → you're in. Done.

> `HDSEARCH_INTERNAL_SECRET` must be **identical** in `web/.env` and `api/.env` (the BFF signs
> first-party calls with it). In dev `HDSEARCH_AUTH_MODE=both` lets the dev login work while
> the JWT path is also available.

---

## 3. Production setup — Auth0 SSO (the secure path)

Three places to configure: the **Auth0 dashboard** (one-time), the **web** env, the **API** env.

### Step 3.1 — Auth0 dashboard (one-time)

Reuse the **existing shared Auth0 application** (the SPA client worldmonitor uses) — do **not**
create a new app. In [Auth0 Dashboard](https://manage.auth0.com) → **Applications → that app →
Settings**:

1. **Allowed Callback URLs** — add hd-search's callback for every origin it runs on:
   ```
   http://localhost:3030/api/auth/callback,
   https://hdsearch.hackerdogs.ai/api/auth/callback
   ```
2. **Allowed Logout URLs** — `http://localhost:3030`, `https://hdsearch.hackerdogs.ai`
3. **Allowed Web Origins** — the same origins.
4. **Refresh Token Rotation** — **enable** (Settings → *Refresh Token Rotation*). The BFF
   requests the `offline_access` scope and uses the rotating refresh token to refresh the JWT.
5. Social connections (GitHub / Google) are already enabled on this tenant — nothing to add.
6. **Save Changes.**

> **No client secret needed.** PKCE replaces it. Only set `AUTH0_CLIENT_SECRET` if you
> deliberately use a confidential (Regular Web App) client instead of the shared SPA client.

### Step 3.2 — Web env (`web/.env` for dev, `web/.env.prod` for prod)

```bash
# --- Auth0 (same tenant + SPA client as worldmonitor) ---
AUTH0_DOMAIN=dev-qvl70rmqadokdop1.us.auth0.com
AUTH0_CLIENT_ID=ACX4BvdDBpmT4AGAlCciqWpHCVkTVql4
# AUTH0_CLIENT_SECRET=          # leave blank (PKCE)
# AUTH0_AUDIENCE=               # leave unset (as worldmonitor)

# --- this app + the core bridge ---
APP_BASE_URL=https://hdsearch.hackerdogs.ai          # dev: http://localhost:3030
HD_CORE_BASE_URL=https://preview.hackerdogs.ai       # dev: http://localhost:8000
HDSEARCH_WEB_SESSION_SECRET=<random 32-byte hex>     # encrypts the session cookie
HDSEARCH_INTERNAL_SECRET=<same as API>               # only used by dev/legacy path

# --- production hardening ---
HDSEARCH_DEV_LOGIN=0                                  # MUST be 0/unset in prod
NEXT_PUBLIC_CORE_BILLING_URL=https://preview.hackerdogs.ai/billing   # Upgrade buttons link here
```

As soon as `AUTH0_DOMAIN` + `AUTH0_CLIENT_ID` are set, the app switches from dev login to the
Auth0 flow (`auth0Configured()` becomes true).

### Step 3.3 — API env (`api/.env` / `api/.env.prod`)

```bash
HDSEARCH_AUTH_MODE=core                 # prod: accept ONLY a verified JWT (rejects X-HD-User)
JWT_SECRET_KEY=<same value hackerdogs-core signs with>   # HS256 shared secret
HD_CORE_BASE_URL=https://preview.hackerdogs.ai           # for GET /auth/me (plan lookup)
```

### Step 3.4 — hackerdogs-core dependency (one-time, core side)

- The web flow calls core **`POST /auth/token-exchange`** — already exists.
- For server-side plan resolution the API calls core **`GET /auth/me`** (validate the JWT via
  the existing `get_current_user`, return the user + `current_plan`). If it isn't present yet,
  plan resolution falls back to **free** — everything else still works.

---

## 4. Environment variable reference

### Web (`web/.env`, `web/.env.prod`)
| Var | Required | Purpose |
|---|---|---|
| `AUTH0_DOMAIN` | Auth0 | Tenant domain (shared: `dev-qvl70rmqadokdop1.us.auth0.com`) |
| `AUTH0_CLIENT_ID` | Auth0 | SPA client id (shared with worldmonitor) |
| `AUTH0_CLIENT_SECRET` | no | Only for a confidential client; blank for PKCE |
| `AUTH0_AUDIENCE` | no | API audience; leave unset to match worldmonitor |
| `APP_BASE_URL` | yes | Public origin of THIS app (callback origin) |
| `HD_CORE_BASE_URL` | Auth0 | hackerdogs-core API base (token-exchange) |
| `HDSEARCH_WEB_SESSION_SECRET` | yes | AES-256-GCM key for the session cookie (`openssl rand -hex 32`) |
| `HDSEARCH_INTERNAL_SECRET` | yes | Must equal the API's; used by dev/legacy BFF path |
| `HDSEARCH_DEV_LOGIN` | no | `1` allows dev login (default on in dev, **off in prod**) |
| `HDSEARCH_API_URL` | yes | Server-side API base the BFF calls |
| `NEXT_PUBLIC_CORE_BILLING_URL` | no | Core billing portal the Upgrade buttons link to |

### API (`api/.env`, `api/.env.prod`)
| Var | Required | Purpose |
|---|---|---|
| `HDSEARCH_AUTH_MODE` | yes | `legacy` \| `both` \| `core` (see §5) |
| `JWT_SECRET_KEY` | core/both | HS256 secret hackerdogs-core signs JWTs with (also `HDSEARCH_JWT_SECRET_KEY`) |
| `HD_CORE_BASE_URL` | core/both | Core API base for `GET /auth/me` plan lookup |
| `HDSEARCH_INTERNAL_SECRET` | yes | Must equal the web's; trust for the first-party BFF |

---

## 5. Auth modes (`HDSEARCH_AUTH_MODE`)

| Mode | API accepts | Use when |
|---|---|---|
| `legacy` | `sk-hds-*` API keys + the internal BFF header (`X-HD-Internal`+`X-HD-User`) | Original behavior / instant rollback |
| `both` | the above **plus** a verified core JWT (Bearer) | **Cutover** — run old + new together |
| `core` | API keys + **verified core JWT only** — the self-asserted `X-HD-User` path is **disabled** | **Production** — most secure |

Recommended path: `legacy` → `both` (verify real logins) → `core` (lock it down).

---

## 6. Verify

1. Open `${APP_BASE_URL}` → **Sign in** → GitHub/Gmail → approve → land on `/dashboard`.
   Flow: `/api/auth/login` (sets `hd_oauth_state` + `hd_pkce`) → Auth0 `/authorize` →
   `/api/auth/callback` (verifies state, PKCE code exchange, core token-exchange, sets the
   encrypted `hd_session`) → `/dashboard`.
2. **Cookie is secure:** in DevTools the `hd_session` cookie is `HttpOnly` + `Secure`, and
   `document.cookie` does **not** contain the JWT.
3. **API enforces it:** with `HDSEARCH_AUTH_MODE=core`, a request carrying only `X-HD-User`
   returns **401**; a real signed-in session works (the BFF sends `Authorization: Bearer`).

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Redirected to Auth0 "Callback URL mismatch" | Add `${APP_BASE_URL}/api/auth/callback` to **Allowed Callback URLs** (exact scheme+host+port). |
| `/login?error=exchange` | `HD_CORE_BASE_URL` wrong/unreachable, or core `/auth/token-exchange` rejected the id_token (tenant/audience mismatch). |
| API returns 401 for signed-in users | `JWT_SECRET_KEY` differs from core's, or `HDSEARCH_AUTH_MODE` is `legacy`. Set the shared secret + `both`/`core`. |
| Plan always shows "Free" for paid users | core `GET /auth/me` not available/returning `current_plan` — add it (§3.4). Plan is cached ~5 min. |
| Dev login button missing / does nothing | `HDSEARCH_DEV_LOGIN` not `1` (it defaults **off** under `NODE_ENV=production`, i.e. `next start`). |
| Sessions log out after ~15 min | Refresh token rotation not enabled, or `offline_access` not granted on the Auth0 client. |
| Behind a reverse proxy, login loops | Proxy must forward `X-Forwarded-Host` / `X-Forwarded-Proto`; the callback URL must match the **public** origin. |

---

## 9. Roles (RBAC), email verification & disclaimer

**RBAC — inherited from hackerdogs-core.** The core JWT carries the user's role names; hd-search
maps them to its own capabilities ([`api/src/roles.ts`](../api/src/roles.ts)):

| Core role(s) | hd-search role | Effect |
|---|---|---|
| `hd_super`, `super_admin`, `tenant_admin`, `admin`, `owner` | **admin** | gets the `admin:platform` scope **and unlimited (enterprise) quota** — vector + all AI models |
| `data_analyst` (default) / anything else | **user** | standard scopes on their plan tier |

A user's role rides in every request's JWT, so a **super-user already in the core DB automatically
gets admin access in hd-search** — no separate setup. `GET /v1/account` returns `role`. Gate
admin-only endpoints with `requireScope('admin:platform')`.

**Email verification — unified with worldmonitor/Streamlit.** The gate is driven by the
**authoritative core flag `is_active`** (from the token-exchange `user` payload), falling back to the
Auth0 `email_verified` claim only when core doesn't report it. A user who already verified on
worldmonitor (`is_active=true`) is therefore **not** re-gated on hd-search. Unverified users land on
**`/verify-email`** with a Resend button → core `POST /auth/resend-activation-email` carrying
`return_to=${APP_BASE_URL}/api/auth/verified`. After they click the activation link, core
`/auth/verify` redirects back to **`/api/auth/verified`**, which re-exchanges (refresh token → fresh
`is_active`) and lets them in — **no re-login**. Dev login bypasses this.

**Core API env (hackerdogs-core root `.env` / `.env.prod`)** — required for dynamic post-verify redirects:

| Variable | Purpose |
|---|---|
| `VERIFICATION_API_BASE` | Public origin where `/api/auth/verify` is reachable (used in activation emails) |
| `VERIFICATION_ALLOWED_ORIGINS` | Comma-separated allowlist of client `return_to` origins — **must include this app's `APP_BASE_URL` origin** (e.g. `https://hdsearch.hackerdogs.ai` or `http://localhost:3030`) |
| `VERIFICATION_REDIRECT` | Legacy default landing when no per-client `return_to` is stored (Streamlit fallback) |

Implementation: `api/services/verification_redirect_service.py`. WM and hd-search send `return_to` on
`POST /auth/token-exchange` and `POST /auth/resend-activation-email`; after verify the API redirects
to `{return_to}?email_verified=1`.

**Disclaimer / terms — unified with worldmonitor/Streamlit.** Acceptance is the **shared core
setting `DISCLAIMER_AGREED`** in `hdtm.t_user_settings` (read/written via core `/tusersettingsui`
with the user's JWT), so accepting on worldmonitor carries over to hd-search and vice-versa. For
dev/legacy sessions with no core JWT it falls back to hd-search's own store (`hds:consent:<sub>`,
Redis db 5). First sign-in is gated by **`/disclaimer`** until accepted; accepting writes to core
**and** mirrors locally. Replace the placeholder copy in
[`web/src/app/disclaimer/page.tsx`](../web/src/app/disclaimer/page.tsx) with your reviewed legal text.

> The verification + disclaimer gates run in the dashboard layout (the post-login chokepoint).
> **Net effect:** onboard once on worldmonitor → no extra verification or disclaimer gates on
> hd-search (plan + RBAC are already shared via the core JWT).

---

## 8. Security notes

- **No tokens in the browser.** The Hackerdogs JWT + Auth0 refresh token live only in the
  server-side, **AES-256-GCM encrypted**, `httpOnly`, `Secure`, `SameSite=Lax` `hd_session`
  cookie — immune to XSS token theft and unreadable even if the cookie is exfiltrated.
- **API trusts cryptography, not headers.** In `core` mode the API verifies the JWT signature
  on every request; the legacy self-asserted `X-HD-User` header is rejected.
- **PKCE** (S256) protects the code exchange without a client secret.
- **CSRF:** the `state` parameter is checked against the `hd_oauth_state` cookie on callback.
- **Rotate** `HDSEARCH_WEB_SESSION_SECRET` to invalidate all sessions; rotate `JWT_SECRET_KEY`
  (in lockstep with core) to invalidate all JWTs.
- Keep `HDSEARCH_DEV_LOGIN=0` in every shared/production environment.
