# HD-Search — Auth & Plan Integration with hackerdogs-core

**Status:** Design v1 (approved direction). **Decisions locked:** (a) **Auth** — hd-search becomes a *consumer* of the central hackerdogs-core identity, exactly like worldmonitor/Streamlit; it stops running its own login/session. (b) **Plans = Option B2** — fold hd-search capabilities into the **existing** core plans (Chihuahua / Bulldog / German Shepherd / Doberman); hd-search does **not** sell its own plans. (c) **Deployment** — hd-search is a standalone app at `hdsearch.hackerdogs.ai` (and possibly its own apex domain); not embedded in worldmonitor. **Owner:** hd-search · **Audience:** eng

> Doc-first per request. No code has been changed. This specifies what to build, the contracts, the migration, and the open decisions.

---

## 1. Goals / non-goals

**Goals**
- One identity across Streamlit, worldmonitor, and hd-search. A user who signs in anywhere can use hd-search without a second account.
- hd-search reads the user's **existing core plan** and maps it to search/crawl/vector/AI-Search entitlements. No separate hd-search billing.
- Zero per-user data migration: provider keys, history, and usage stay keyed by the same identifier they already use (the Auth0 `sub`).

**Non-goals (now)**
- Product-scoped plans / multiple concurrent subscriptions (that was Option B1/B3 — explicitly deferred).
- Moving AI-Search credit metering onto the core credit ledger (phase 2 — see §6).
- Embedding hd-search inside worldmonitor.

---

## 2. Current vs. target

| Concern | Today | Target |
|---|---|---|
| IdP | Auth0 (hd-search runs its **own** code-exchange) | Auth0 — **same tenant** as core |
| Session | hd-search mints its own signed `hd_session` cookie (HMAC, `HDSEARCH_WEB_SESSION_SECRET`) | Hold the **core Hackerdogs JWT** (HS256, shared `JWT_SECRET_KEY`); refresh via core |
| API trust | BFF asserts identity via `X-HD-User` + `X-HD-Internal` (self-asserted) | API **verifies the core JWT**; identity comes from signed claims |
| Identity store | `hd_search.users` (id = Auth0 sub) — a parallel copy | Core `hdtm.t_users` is the source of truth; `hd_search.users` becomes an optional per-service cache keyed by the same sub |
| Plan | `hd_search.users.plan` + `api/src/plans.ts` catalog + own Stripe price IDs | Core `current_plan` from token-exchange; tier→entitlement map in hd-search |
| Billing UI | hd-search `/dashboard/billing` + Stripe checkout | "Manage plan" deep-links to the **core** billing portal |

**Identity invariant (the key de-risker):** hd-search already keys provider keys, history, and usage by the Auth0 `sub`, and the core JWT's `sub` *is* that same Auth0 `sub`. So once hd-search trusts the core JWT, **all existing per-user rows keep resolving** — no backfill.

---

## 3. Auth design

### 3.1 Core JWT contract (consumed by hd-search)
- **Issuer:** core `POST /auth/token-exchange` (`api/routers/auth.py`). Input: Auth0 `id_token`. Output: `{ access_token: <HS256 JWT>, user: {...current_plan, current_subscription, roles, tenant_id...} }`.
- **Signature:** HS256 with `JWT_SECRET_KEY` (shared secret — hd-search's Node API must have it to verify).
- **Claims used by hd-search:** `sub`/`id` (user id), `email`, `tenant_id`, `roles`, `auth_provider`. **Plan is NOT in the JWT** — it rides in the token-exchange `user` payload and is queried server-side (see §4).
- **Validation:** verify signature + `exp`; reject otherwise. (Mirror core's `get_current_user` dependency.)

### 3.2 API changes — `services/hd-search/api/src/auth.ts`
`requireAuth()` gains a **core-JWT path**, selected first:
1. **`Authorization: Bearer <coreJWT>`** → verify HS256 with `JWT_SECRET_KEY` → `principal = { userId: sub, tenant, roles, plan }` (plan resolved per §4). ← new
2. **`Authorization: Bearer sk-hds-…` / `X-Api-Key`** → existing developer API-key path. **Keep.**
3. **`X-HD-Internal` + `X-HD-User`** → keep ONLY as a transport detail for the web BFF→API hop, but the BFF must now put a *verified* core JWT behind it (or forward the Bearer directly). The "trust a self-asserted user header" behavior is removed.
4. **Dev-login** → allowed only when `RUN_MODE=dev`.

Roll out behind `HDSEARCH_AUTH_MODE = legacy | core | both` so we can run both paths during cutover and flip per-env.

### 3.3 Web BFF — mirror worldmonitor's flow (subdomain only)

**Scope:** subdomain only (`hdsearch.hackerdogs.ai`). A separate apex domain is deferred.

hd-search uses the **same flow worldmonitor-main uses** (`worldmonitor-main/src/auth/auth-client.ts`), adapted to a server-side BFF. Worldmonitor does: **Auth0 login → `POST /auth/token-exchange { auth0_token }` → `{ access_token: HackerdogsJWT, user{current_plan,...} }` → `Authorization: Bearer <jwt>` on every call → refresh by silently re-running `token-exchange`.** There is **no `/auth/refresh` endpoint** — refresh just re-exchanges and yields a fresh JWT + fresh plan.

The one deliberate difference: hd-search is a **confidential BFF**, so it holds the JWT in an **httpOnly cookie** (not `localStorage` like the worldmonitor SPA) and uses the Authorization-Code flow it already has. SSO comes from the shared Auth0 session on the `.hackerdogs.ai` tenant — a user already signed into worldmonitor/Streamlit hits `hdsearch.hackerdogs.ai` and Auth0 silently returns an `id_token` (no re-prompt), which the BFF exchanges.

Result: **BFF holds the core JWT and forwards `Authorization: Bearer <coreJWT>` to the hd-search API.** Replace `web/src/lib/auth.ts` (own Auth0 code-exchange) with a core token-exchange call; demote `web/src/lib/session.ts` to "hold the core JWT, not a self-minted identity"; `web/src/lib/api.ts` sends the Bearer instead of `X-HD-User`.

### 3.4 Login / logout / refresh (sequence — same shape as worldmonitor)
```
Login:
  user → hdsearch.../api/auth/login → Auth0 (silent; shared .hackerdogs.ai session)
       → /api/auth/callback (id_token) → core POST /auth/token-exchange { auth0_token }
       → { access_token(JWT), user{current_plan} } → set httpOnly cookie(JWT) → /dashboard
Per request:
  browser → hd-search BFF (cookie) → hd-search API  [Authorization: Bearer JWT]
          → verify HS256(JWT_SECRET_KEY) → principal{ sub }; plan via GET /auth/me (§4)
Refresh (timer + on 401, like worldmonitor's refreshToken):
  BFF silently re-runs token-exchange → fresh JWT + fresh current_plan
Logout:
  clear hd-search cookie → redirect Auth0 /v2/logout (shared session ends everywhere)
```

### 3.5 Deleted / kept
- **Delete:** hd-search's own Auth0 client (`web/src/lib/auth.ts`), `hd_session` minting, `X-HD-User`-trust path. Dev-login kept under `RUN_MODE=dev` only.
- **Keep:** `sk-hds-*` API keys (developer/programmatic access — orthogonal to user SSO), AES-GCM provider-key store, the BFF internal-secret transport.

### 3.6 Prerequisites (config — must be true before cutover)
1. **Same Auth0 tenant + audience** for hd-search as core. ⚠️ The scans showed a likely split (`hackerdogs.us.auth0.com` vs a `dev-…us.auth0.com`); align these or the `sub`s won't match.
2. hd-search Node API has the shared **`JWT_SECRET_KEY`**.
3. Agree the **session cookie domain** `.hackerdogs.ai` (httpOnly) so the Auth0/SSO session is shared with worldmonitor/Streamlit on the same parent domain.
4. **Add core `GET /auth/me`** — validates the JWT via the existing `get_current_user` dependency and returns the user + `current_plan` (the same payload `token-exchange` builds via `get_user_plan_and_subscription`). Worldmonitor never needed it because the SPA re-runs `token-exchange`; hd-search's server-side API needs to resolve plan from a Bearer JWT, so this small endpoint is the clean addition. (Fallback if it can't be added: hd-search BFF re-runs `token-exchange` and passes `current_plan` down to the API.)

---

## 4. Plan integration (Option B2)

### 4.1 Source of truth
The user's plan is the **core** `current_plan` (from `t_u_payment_subscriptions` → `g_pdt_plans`). hd-search reads it from the token-exchange `user` payload at login and refreshes it from **`GET /auth/me`** (§3.6.4), **cached** ~5 min per user in Redis. hd-search stores no authoritative plan; `hd_search.users.plan` becomes a cache or is dropped.

### 4.2 Tier → entitlement mapping (current hd-search tiers → core plans)
This is a **rename** of the existing 5 hd-search tiers onto the core plan ladder — same capabilities, new SKU as the gate. hd-search owns this map in one place (`api/src/entitlements.ts`); gate on **SKU**, not display name.

| Current hd-search tier | → Core plan | hd-search monthly quota (search+crawl) | Vector search | AI Search |
|---|---|---|---|---|
| `free` | **Chihuahua** (`chihuahua-free`) | 100 | ✕ | local/Ollama only |
| `dev` | **Bulldog** (`bulldog-starter`) | 1,000 | ✕ | + commercial models |
| `devtest` | **German Shepherd** (`…-premium`) | 15,000 | ✓ | all models |
| `production` | **Doberman** (`…-enterprise`) | 30,000 | ✓ | all models |
| `enterprise` | **Alpha (Customer)** | unlimited | ✓ | all models |

> ⚠️ **"Alpha (Customer)" is not in the core plan seed** (`scripts/upload_plans.py` has only the 4 dog tiers). It must be **added to `g_pdt_plans`** (its own SKU, e.g. `alpha-customer`, Stripe price optional/contract) before this tier resolves. Until then, `enterprise`-equivalent users fall back to Doberman.
> Unknown/legacy SKU → safe default (Chihuahua/free).

### 4.3 Enforcement
- **Quota:** keep `hd_search.usage_counters` + the `checkQuota()` call sites in `routes/search.ts|crawl.ts|ai.ts`; only the *plan source* changes (core, not `hd_search.users.plan`).
- **AI-Search credits:** phase 1 — keep the self-contained credit meter you built (it still bounds spend and shows credits). Phase 2 (optional) — debit the **core** `t_u_credit_balances` ledger so all products share one credit pool (B2's natural end-state). Flag this as a follow-up, not part of the auth cutover.

### 4.4 Billing UI
Remove hd-search Stripe checkout (`api/src/routes/billing.ts`, `plans.ts`, `/dashboard/billing`, `STRIPE_*` envs). Replace the Plans/Upgrade UI with a **"Manage plan"** button that deep-links to the **core** billing portal (`/payments/individual/...`). hd-search only *reads* entitlements.

---

## 5. Data model changes
- `hd_search.users`: demote from identity source → optional cache (keep `id` = sub for FK convenience; `plan` column becomes cache or dropped). **No change** to `user_provider_keys`, `usage_counters`, `usage_metrics`, `search_history` — all stay keyed by sub.
- No new tables. No backfill (identity unchanged).

---

## 6. Config / env / secrets
- **Add:** `JWT_SECRET_KEY` (shared with core), `HDSEARCH_AUTH_MODE` (`legacy|core|both`), `HD_CORE_BASE_URL` (token-exchange / me), `HD_PARENT_COOKIE_DOMAIN=.hackerdogs.ai` (Mode A).
- **Align:** `AUTH0_DOMAIN` / `AUTH0_CLIENT_ID` / `AUTH0_AUDIENCE` to the core tenant.
- **Remove (after cutover):** `STRIPE_*`, `STRIPE_PRICE_*`, and the standalone `HDSEARCH_WEB_SESSION_SECRET` identity role (HMAC session retired).

---

## 7. Migration & rollout (staged, reversible)
1. ✅ **DONE — Add core-JWT validation** to the API behind `HDSEARCH_AUTH_MODE` (default `legacy`; `core`/`both` enable it). Legacy still works. No user-visible change. Files: `src/coreClient.ts` (verify HS256 + `/auth/me` plan, graceful), `src/entitlements.ts` (SKU→PlanId), `src/auth.ts` (core-JWT Bearer path), `src/env.ts`. Verified: core JWT → 200 in `both`, → 401 in `legacy`; bad signature → 401; stub `/auth/me`(doberman) → `production` tier via `/v1/account`.
2. **Add the entitlement map**; switch plan reads to core (cached), keep usage enforcement. Verify free/paid users resolve correctly.
3. ✅ **DONE — Secure web BFF cutover.** Auth0 **Authorization Code + PKCE** (server-side, no client secret) → core `/auth/token-exchange` → Hackerdogs JWT. Tokens (JWT + Auth0 refresh token) live in an **AES-256-GCM encrypted httpOnly cookie** — never in browser JS. BFF forwards **`Authorization: Bearer <coreJWT>`**; refresh via the Auth0 refresh token. API **hardened**: in `core` mode the self-asserted `X-HD-User` path is disabled (verified: `X-HD-User`→401, Bearer JWT→200). Dev-login retained for local only (`HDSEARCH_DEV_LOGIN`, off in prod). Files: web `lib/auth.ts` (PKCE + token-exchange + refresh), `lib/session.ts` (AES-GCM), `lib/api.ts` (Bearer + refresh), `app/api/auth/{login,callback,dev}`, `lib/config.ts`; api `src/auth.ts` (core-mode gate). **Manual step to go live:** register hd-search's callback `{APP_BASE_URL}/api/auth/callback` on the Auth0 client + enable refresh-token rotation.
4. **Flip `HDSEARCH_AUTH_MODE=core`** per env (dev → staging → prod). Keep `legacy` as instant rollback.
5. ✅ **DONE (billing half)** — Retired hd-search Stripe: deleted `api/src/routes/billing.ts` (+ `/v1/billing` registration), web BFF `checkout`/`portal` routes, and the `api.checkout/portal` methods. Rebranded `dashboard/billing` → **"Upgrade Plan"** showing the 5 core tiers (Chihuahua→Alpha) with hd-search capabilities; Upgrade/Manage buttons link to the core portal via `NEXT_PUBLIC_CORE_BILLING_URL` (placeholder — deep-links TBD). Auth tenant + `JWT_SECRET_KEY` wired in `api/.env` (tenant `dev-qvl70rmqadokdop1`, `HDSEARCH_AUTH_MODE=both`). *(Remaining: retire own Auth0/session code in the web BFF — the web login cutover.)*
6. **(Optional, later)** move AI-Search credits onto the core ledger.

---

## 8. Risks & mitigations
- **Auth0 tenant mismatch** → `sub`s differ, SSO breaks. *Mitigate:* confirm/align tenant before step 1; add a boot check that fails fast if the JWT issuer ≠ expected.
- **JWT has no plan claim** → must call core per request. *Mitigate:* cache plan ~5 min in Redis; refresh on login.
- **Cutover regressions** → `both` mode + per-env flag + `legacy` rollback.
- **Shared-secret exposure** (`JWT_SECRET_KEY`) → server-side only; never reaches the browser; rotate via the secrets file.
- **Provider keys orphaned** if identity ever changes → it doesn't (same sub); add a guard that refuses to run `core` mode unless the issuer/tenant matches.

---

## 9. Decisions — status
- ✅ **Auth flow** = mirror worldmonitor (Auth0 → `token-exchange` → Bearer JWT → re-exchange to refresh). *(locked)*
- ✅ **Plan model** = B2, folded into existing core plans. *(locked)*
- ✅ **Deployment** = subdomain `hdsearch.hackerdogs.ai` only; apex/Mode B deferred. *(locked)*
- ✅ **Tier map** = §4.2 (free→Chihuahua, dev→Bulldog, devtest→German Shepherd, production→Doberman, enterprise→Alpha). *(locked)*
- ✅ **Plan fetch** = add core `GET /auth/me` (worldmonitor re-runs token-exchange; the API needs a by-JWT lookup). *(locked, pending core PR)*

**Still to confirm:**
1. **Auth0 tenant**: confirm hd-search will point at the **same** Auth0 tenant + audience as core (scans suggested a possible dev/prod split — this is step zero).
2. **Add the `alpha-customer` plan** to `g_pdt_plans` (it doesn't exist yet) — owner + SKU + whether it's Stripe-billed or contract/manual.
3. **Confirm the per-tier quota numbers** in §4.2 carry over as-is, or adjust.
4. Phase-2 credits: share the core `t_u_credit_balances` ledger for AI Search, or keep hd-search's local meter for now?

---

## 10. File-by-file change list (for the build phase)
**API:** `src/auth.ts` (+core-JWT path, flag), new `src/entitlements.ts` (tier→caps), `src/plans.ts` (read core, drop catalog), `routes/billing.ts` (delete), `routes/search.ts|crawl.ts|ai.ts` (plan source only), new `src/coreClient.ts` (token-exchange/me + Redis cache).
**Web:** `lib/auth.ts` (replace with core token-exchange), `lib/session.ts` (hold core JWT, not own identity), `lib/api.ts` (forward Bearer), `app/api/auth/*` (login/callback/logout → core), `app/dashboard/billing/*` (→ "Manage plan" link), `lib/config.ts` (+core/JWT/cookie-domain envs).
**Docs/infra:** `.env.example` (+`JWT_SECRET_KEY`, `HD_CORE_BASE_URL`, `HDSEARCH_AUTH_MODE`, parent cookie domain; −`STRIPE_*`), compose/start scripts updated.
