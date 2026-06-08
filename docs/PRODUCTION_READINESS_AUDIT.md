# MohandisHub — Production Readiness Audit

**Date:** 2026-06-08
**Scope:** Full repo audit — backend (`apps/api`), frontend (`apps/web`), shared package, 72 Supabase migrations, infra/deploy config (`render.yaml`, `vercel.json`, CI).
**Method:** Static review of every subsystem + automated checks (typecheck, lint, unit tests) + targeted code verification of the highest-severity findings.

> This is an assessment document. It does **not** change application code. Each issue lists a file location so it can be fixed and ticketed independently.

---

## 1. Verdict

The project is **feature-complete on paper but not yet safe to publish.** The happy paths (auth, onboarding, services, reservations, wallet, chat, admin) are implemented and pass their unit tests, but there is a cluster of **money-handling correctness gaps** and **authorization/security gaps** that can cause real financial loss, privilege escalation, or stuck funds in production. There are also several **deployment-config landmines** that can take the platform down or send real payouts to a staging endpoint.

**Overall readiness: ~70%.** Core flows work; the remaining 30% is the hard part — money invariants, authorization hardening, production config, and observability.

| Area | State |
|------|-------|
| Feature breadth | Strong — most launch-scope features exist |
| Auth / sessions | Works, but several hardening gaps + 1 escalation path |
| Money / wallet / reservations | **Highest risk** — disputes don't move money, refund gaps, race conditions |
| Data / DB / infra | No RLS, optional `DATABASE_URL`, staging-payout default, manual prod migrations |
| Frontend | Solid, but broken notification deep-links, i18n holes, client-only auth gating |
| Tests / CI | Green when env is correct; coverage thresholds very low; E2E misconfigured |

---

## 2. Automated health check (run during this audit)

| Check | Command | Result |
|-------|---------|--------|
| Type check | `npm run typecheck` | ✅ Pass |
| Lint (api + web) | `npm run lint` | ✅ Pass (0 warnings) |
| Shared unit tests | `vitest` | ✅ 10 passed |
| API unit tests | `vitest` | ✅ 82 passed *(with valid env — see P0-CONFIG-1)* |
| Web unit tests | `vitest` | ✅ 31 passed |

> **Important:** With the environment value `OTP_SMS_PROVIDER=brevo` currently injected, **14 of 18 API test suites fail to even load** and the API would **crash on boot**, because the env schema only allows `console | twilio` for SMS. See **P0-CONFIG-1**.

---

## 3. Issues by priority

Priority key: **P0 = blocks launch / can lose money or take the app down**, **P1 = fix before public launch**, **P2 = fix soon after**, **P3 = polish**.

### P0 — Critical (must fix before publishing)

| ID | Area | Issue | Location | Impact |
|----|------|-------|----------|--------|
| **P0-CONFIG-1** | Config | `OTP_SMS_PROVIDER=brevo` is set in the live env, but the schema only accepts `console`/`twilio`. Env validation throws → **API will not boot**. | `apps/api/src/config/env.ts:53`; current env | Hard outage; also breaks the entire API test suite. Set to `console` (or implement an SMS provider). |
| **P0-CONFIG-2** | Config | `DATABASE_URL` is **optional** with no production hard-fail. API boots "healthy" with no DB. | `apps/api/src/config/env.ts:9` | A misconfigured deploy goes "live" but every `/api/*` route fails at runtime. |
| **P0-CONFIG-3** | Config | `PAYMOB_PAYOUT_BASE_URL` defaults to `…stagingpayouts.paymobsolutions.com`. | `apps/api/src/config/env.ts:101` | If Paymob withdrawals are enabled in prod without overriding this, **real payouts hit the staging endpoint**. |
| **P0-SEC-1** | Auth | `lockLogins` and `signupsLocked` admin toggles are **never read** by register/login. | `apps/api/src/modules/auth/auth.service.ts` (no settings read); toggles only in `settings.service.ts` | Emergency lockdown is a no-op; attackers keep registering/logging in while admins think the platform is locked. *(Verified.)* |
| **P0-SEC-2** | Auth | Privilege escalation: any admin with `manage_users` can `PATCH /users/:id` to set `isAdmin:true` + `adminPermissions:[]`, and **empty permissions == full access**. | `admin.service.ts:156`; `middleware/require-role.ts:85` | A scoped admin can self-promote to unrestricted super-admin. *(Verified.)* |
| **P0-SEC-3** | Auth | Authorization claims (`role`, `verified`, `emailVerified`, `isAdmin`) are read from the **JWT**, not re-checked from DB except on `/api/admin/*`. Demotion/permission changes don't revoke tokens. | `middleware/authenticate.ts:83`; `admin.service.ts` `updateUser` | Demoted admins / changed-role users keep elevated access for up to the access-token TTL on non-admin routes (e.g. support tickets trust JWT `isAdmin`). |
| **P0-MONEY-1** | Reservations | **Dispute resolution moves no money.** `resolveDispute` only updates status + notifies; no refund/release/split of the held funds. | `reservations.service.ts:2132` | Funds can sit in `held` indefinitely after a dispute; admins have no in-app remedy. *(Verified.)* |
| **P0-MONEY-2** | Reservations | Pending-expiry sweep updates rows to `expired` with **no `WHERE status='pending'`** and no row lock; a concurrent accept can be overwritten. | `reservations.service.ts` `processExpiredPendingReservations` (~2056) | An accepted+booked reservation can be force-expired, releasing holds incorrectly and corrupting settlement. |
| **P0-MONEY-3** | Wallet | **Paymob withdrawals have no completion path** (no payout webhook, no admin-complete, no hold capture). | `wallet.service.ts` Paymob branch (~760); `wallet.repository.ts` `applyWithdrawalWebhookStatus` (NOWPayments-only) | If a Paymob payout succeeds externally, user funds stay `held` forever; no automatic release. |
| **P0-INFRA-1** | DB | **Zero Row-Level Security** anywhere — 0 `ENABLE ROW LEVEL SECURITY`, 0 `CREATE POLICY` in 72 migrations. All protection is app-layer. | `supabase/migrations/*` | If `DATABASE_URL`/service-role key leaks or PostgREST/Studio is exposed, every table is fully readable/writable. *(Verified: 0 hits.)* |
| **P0-INFRA-2** | DB | KYC/private bucket created with **no `storage.objects` policies** in migrations. | `supabase/migrations/20260316000000_storage_buckets.sql` | Private KYC document security depends entirely on manual dashboard setup; easy to misconfigure into public access. |

### P1 — High (fix before public launch)

| ID | Area | Issue | Location |
|----|------|-------|----------|
| P1-SEC-4 | Auth | CSRF on cookie-based `refresh`/`logout`: `SameSite=None` in prod, no CSRF token / Origin check; refresh returns access token in body. | `config/cookies.ts`; `auth.controller.ts` |
| P1-SEC-5 | Auth | Account/email enumeration: `forgotPassword` returns distinct messages for unknown vs disabled vs success; login also has a bcrypt timing side-channel. | `auth.service.ts` `forgotPassword`/`login` |
| P1-SEC-6 | Auth | Email-change confirm uses a 6-digit code with **no attempt cap** (unlike OTP verify) — brute-forceable within TTL. | `users.service.ts` `confirmEmailChange` |
| P1-SEC-7 | Auth | Admin demotion / permission change does **not** revoke refresh tokens (deactivate does, updateUser doesn't). | `admin.service.ts` `updateUser` |
| P1-SEC-8 | Auth | `GET /admin/settings` and `/dashboard/stats` sit behind `requireRole('admin')` but **no** `requireAdminPermission` — any scoped admin reads full financial/feature config. | `admin.routes.ts:24` |
| P1-SEC-9 | Auth | WebSocket auth only verifies JWT signature; no live `isUserActive` check — deactivated users keep realtime connections. | `chat.socket.ts` |
| P1-MONEY-4 | Reservations | Hold placed at create; acceptance fee charged in a **separate** transaction on accept. Fee failure rolls back accept but **leaves the create-time hold** → funds locked on a still-`pending` reservation. | `reservations.service.ts` create vs `chargeAcceptanceFee` |
| P1-MONEY-5 | Reservations | Acceptance fee is **never refunded on cancellation**, even when provider cancels with full customer refund. | `cancelReservation` branches |
| P1-MONEY-6 | Ads | **Ad cancellation does not refund** the prepaid wallet debit — user loses full ad spend. | `advertisements.service.ts:135` *(Verified.)* |
| P1-MONEY-7 | Plans | No guard against existing active subscription — repeated `subscribeToPlan` **stacks paid periods and re-charges**. | `plans.service.ts` `subscribeToPlan` |
| P1-MONEY-8 | Reservations | Server-side create **idempotency is check-then-act** (key stored after insert) → parallel duplicate creates possible despite stable client key. | `reservations.service.ts` create / `storeActionIdempotency` |
| P1-MONEY-9 | Wallet | Crypto deposit credit uses `actually_paid * fx` with **no cap to the requested amount** → over-credit on overpayment. | `wallet-fx.service.ts` `computeDepositCreditEgp` |
| P1-MONEY-10 | Wallet | Admin `reverseTransaction` treats **all `payment` rows as debits**; reversing a provider payout credit double-charges the provider; no negative-balance guard. | `admin.repository.ts` `reverseTransaction` |
| P1-MONEY-11 | Reservations | Provider late-cancel penalty is best-effort; on insufficient provider balance it's skipped and customer still gets full refund → lost platform revenue. | `applyProviderLateCancellationPenalty` |
| P1-WEB-1 | Frontend | **Job notifications deep-link to `/app/projects`, which is a "Coming soon" page** — job workflow is unreachable from notifications. | `packages/shared/src/notifications.ts:94`; `app/[locale]/app/projects/page.tsx` |
| P1-WEB-2 | Frontend | `/[locale]/app/*` has **no server-side/edge auth gate** — protection is client-only `useEffect` redirects. | `middleware.ts`, `app/[locale]/app/layout.tsx` |
| P1-INFRA-3 | Deploy | API and worker JWT secret handling is **asymmetric** (`generateValue:true` on API, `sync:false` on worker). Mismatch → token validation failures / auth split-brain. | `render.yaml:32,105` |
| P1-INFRA-4 | Deploy | `scripts/push-migrations.mjs` runs migrations from `.env` with **no confirmation guard** (unlike `ship.mjs`). | `scripts/push-migrations.mjs` |
| P1-INFRA-5 | Deploy | `TRUST_PROXY` not set in `render.yaml`; behind Render's proxy `req.ip` is the proxy IP → **per-IP rate limits become global** (brute-force/OTP throttling collapses). | `render.yaml`; `env.ts:17` |
| P1-INFRA-6 | Deploy | Worker has **no Sentry, no health check** in `render.yaml`; if `DATABASE_URL` is unset it no-ops but stays "running" → reservation lifecycle/billing & retention never execute, silently. | `worker.ts`; `render.yaml` |
| P1-INFRA-7 | Deploy | Production env guards don't **require** `BREVO_API_KEY`, `DIDIT_*`, `SUPABASE_*`, `API_PUBLIC_URL`, `WEB_PUBLIC_URL` at boot — they fail at runtime (500s) instead of failing fast. | `env.ts:138-209` |

### P2 — Medium (fix shortly after launch)

| ID | Area | Issue | Location |
|----|------|-------|----------|
| P2-MONEY-12 | Reservations | Online per-minute billing debits **both** customer and provider (`rate/2` each); session ends when either runs out; not in user-facing policy copy. | `billMinutesInTransaction` |
| P2-MONEY-13 | Reservations | Provider-ended call refunds full fixed hold after per-minute charges — collusion-friendly economics. | `endCall` |
| P2-MONEY-14 | Wallet | Paymob/NOWPayments deposit credit uses order amount, not always the webhook-paid amount; no documented underpay tolerance. | `handlePaymobDepositWebhook`, `handleNowPaymentsDepositIpn` |
| P2-MONEY-15 | Wallet | FX rate fetched live at credit/quote time (CoinGecko/er-api) with static `48.5` fallback → quote-vs-settle drift. | `wallet-fx.service.ts` |
| P2-INFRA-8 | DB | No DB `CHECK` preventing negative `wallets.balance`; enforced only in app code. | `…_wallet_transactions.sql` |
| P2-INFRA-9 | DB | Three-way currency churn EGP→USD→EGP via `UPDATE` with no FX conversion of historical rows → ledger interpretation risk for data created mid-migration. | currency migrations |
| P2-INFRA-10 | DB | Destructive cutover `DROP TABLE bookings/availability_slots` with no rollback migration; opaque filename `…_new-migration.sql`. | `20260309101419_new-migration.sql` |
| P2-INFRA-11 | DB | Several core tables are non-idempotent (`CREATE TABLE` without `IF NOT EXISTS`); `config.toml` references missing `seed.sql` → `supabase db reset` fails. | `20240101*` migrations; `config.toml:65` |
| P2-INFRA-12 | DB | Missing indexes: `refresh_tokens.expires_at`, `verification_codes.expires_at`, `messages.sender_id`, several `*_author_id`/`admin_user_id`. | various migrations |
| P2-INFRA-13 | Sec | No `helmet`/CSP/security headers; `next.config.ts` image `remotePatterns` allows any HTTPS host (`hostname:'**'`) → SSRF-ish proxy risk. | `app.ts`, `next.config.ts` |
| P2-INFRA-14 | CI | E2E Playwright config starts **only web (no API)**; integration journeys (wallet/reservations) untested or flaky; coverage thresholds 9-20%. | `ci.yml`, `playwright.config.ts`, vitest configs |
| P2-INFRA-15 | Deploy | Render services on **free tier** (cold starts, no SLA) — unacceptable for a payments marketplace. | `render.yaml:10,89` |
| P2-WEB-3 | Frontend | Socket not reconnected after token refresh and **never disconnected on logout** → stale realtime session on shared devices. | `lib/chat/socket.ts` |
| P2-WEB-4 | Frontend | Notification deep-link query params (`need`,`job`,`negotiation`,`service`,`application`) are set but **not read** by target pages (only `reservation`,`c`,`post` work). | `notification-display.ts` + screens |
| P2-WEB-5 | Frontend | Most API clients lack 401-refresh/retry (only `admin/client.ts` has it); transient refresh failures surface as empty/error states. | `lib/*/client.ts` |
| P2-WEB-6 | i18n | Missing dictionary keys → English shown in Arabic: `needs.customerNeedsOverview`, `bidsOverviewFromSearchHint`, `linkOrScreenshotPlaceholder`, `bidsUnavailableForRole`; `archived` status has no label key. | `business-dashboard.tsx`, dictionaries |
| P2-WEB-7 | i18n | Whole surfaces hardcoded English: `business-jobs-tab.tsx`, wallet/history status labels, profile dispute placeholders. | listed components |
| P2-WEB-8 | i18n | Stale "coming soon" copy while features exist: `login.description`, `appHome.balanceStubNote`/`balanceTopUp`. | `en.ts`/`ar.ts` |
| P2-WEB-9 | Frontend | Booking deep link `?reservation=<id>` only opens if the id is already in the (max 80) loaded list — no fetch-by-id fallback. | `bookings-screen.tsx` |
| P2-WEB-10 | Frontend | "Send demo notification" button exposed to all users in production. | `notification-center.tsx` |

### P3 — Low (polish / hardening)

| ID | Area | Issue |
|----|------|-------|
| P3-SEC | Auth | Login password has no max length (bcrypt DoS); password-reset token in URL query string; `.env.example` JWT placeholders pass the `min(32)` rule (catastrophic if copied unchanged); `JWT_REFRESH_SECRET` required but unused; non-prod `devResetLink` echoed in responses; maintenance mode whitelists the whole `/admin` tree. |
| P3-WEB | Frontend | RTL physical-direction styles (toasts `right:20px`, `marginLeft`); `not-found.tsx` English-only; root `<html lang="en">` until hydration; tablist a11y (`aria-controls`), color-only unread dots, wallet button `aria-label` says "Settings"; duplicate `visibilitychange` refresh listeners; orphan `/app/browse` route. |
| P3-INFRA | Infra | Duplicate Sentry `captureException` on some 500s; no Dockerfile; `pg` pool max 10×2 vs Supabase tier limits; `validate-i18n.mjs` doesn't check structural key parity; CI Supabase CLI pinned to `latest`; PII columns stored plaintext despite "encrypted/masked" comments. |

---

## 4. Gap to a publish-ready version

A pragmatic, dependency-ordered path. Treat **Stage A** as the launch blocker set.

### Stage A — Launch blockers (correctness, safety, money)
1. **Fix env/boot config** — set `OTP_SMS_PROVIDER=console` (P0-CONFIG-1); make `DATABASE_URL` required in prod (P0-CONFIG-2); override `PAYMOB_PAYOUT_BASE_URL` for prod or disable Paymob withdrawals (P0-CONFIG-3); require `BREVO_API_KEY`/`SUPABASE_*`/`*_PUBLIC_URL` at boot (P1-INFRA-7).
2. **Close the privilege-escalation path** — separate "manage users" from "grant admin"; make empty `adminPermissions` mean **deny**, not full access (P0-SEC-2); revoke tokens on demotion (P1-SEC-7); re-check role/admin from DB or shorten access TTL (P0-SEC-3).
3. **Enforce lockdown toggles** — wire `lockLogins`/`signupsLocked` into register/login (P0-SEC-1).
4. **Make money invariants correct** — dispute resolution must actually refund/release/split (P0-MONEY-1); pending-expiry sweep must be conditional + locked (P0-MONEY-2); Paymob withdrawal completion path (P0-MONEY-3); fee+hold atomicity and fee refund on cancel (P1-MONEY-4/5); ad-cancel refund (P1-MONEY-6); plan double-charge guard (P1-MONEY-7); server-side idempotency insert-before-work (P1-MONEY-8); deposit overpayment cap (P1-MONEY-9); fix `reverseTransaction` direction + negative-balance guard (P1-MONEY-10).
5. **Lock down data** — enable RLS (or formally accept service-role-only access with documented network restrictions + key handling) (P0-INFRA-1); add storage bucket policies (P0-INFRA-2).
6. **Deploy hardening** — set `TRUST_PROXY` (P1-INFRA-5); sync JWT secrets across API+worker (P1-INFRA-3); add a confirmation guard to `push-migrations.mjs` (P1-INFRA-4); worker Sentry + health/readiness (P1-INFRA-6); move off free tier (P2-INFRA-15).

### Stage B — Pre-public-launch polish
- Server-side auth gate for `/app/*` (P1-WEB-2); fix job-notification deep link / ship or hide `/app/projects` (P1-WEB-1).
- CSRF protection on refresh/logout (P1-SEC-4); enumeration + email-change brute-force fixes (P1-SEC-5/6); scoped permission on settings/stats (P1-SEC-8); socket live-status check (P1-SEC-9).
- Socket reconnect on refresh + disconnect on logout (P2-WEB-3); notification deep-link param handling (P2-WEB-4); 401-refresh in all API clients (P2-WEB-5).
- i18n key parity + de-hardcode English surfaces (P2-WEB-6/7/8); remove stale "coming soon" copy.

### Stage C — Operability
- Raise test coverage on money paths; fix E2E to run API+web; add prod deploy/migrate pipeline (P2-INFRA-14).
- Add `helmet`/CSP, restrict image remote patterns (P2-INFRA-13); negative-balance `CHECK` + missing indexes (P2-INFRA-8/12).
- Backup/restore runbook for Supabase + PITR given destructive migrations; metrics/APM and alerting on health/readiness.

---

## 5. Suggested features (post-stabilization)

These are additive opportunities, not gaps. Several already have DB scaffolding.

- **Coupons / promotions redemption** — `coupons` table exists (`20260318000003`) but no redemption API/UI.
- **Business team accounts** — tables exist (`20260318000002`) but invite/member permissions are deferred; finish RBAC for seats.
- **Provider analytics depth** — current analytics tab is basic; add trends, conversion funnels, payout forecasts.
- **Multi-currency / FX lock-in** — lock the FX rate at checkout (ties into P2-MONEY-15) and consider currency selection.
- **Additional payment rails** — Stripe/Cryptomus/Paymob deposits are partially stubbed; complete and certify one card rail.
- **SMS / WhatsApp notifications** — email fan-out exists; add the SMS path (also resolves the `OTP_SMS_PROVIDER` mismatch).
- **In-app dispute center** — first-class dispute UI with evidence upload and split-settlement (depends on P0-MONEY-1 fix).
- **Reviews moderation & provider reputation** — dispute/report exist; add reputation scoring and abuse detection.
- **Reservation auto-rebooking / waitlist** — when a slot frees up, notify pending/waitlisted customers automatically.
- **Saved searches + recommendation surfacing** — recommendation API exists; surface "Suggested for you" in UI.
- **Mobile app** — PWA base exists; native shell or push notifications would extend reach.
- **Audit/observability dashboard** — surface `audit_log`/`admin_moderation_log` and wallet/hold reconciliation reports in admin.

---

## 6. What's working well (so you don't break it)

- Refresh-token **rotation + reuse detection** with family revocation; bcrypt cost 12; parameterized SQL throughout auth.
- NOWPayments IPN: raw-body HMAC-SHA512 verification + deposit idempotency via `deposit_requests.status` + row lock.
- Per-minute call billing uses wallet `FOR UPDATE` + per-second carry — solid against fractional-minute leakage.
- Reservation accept locks the slot `FOR UPDATE`, has an overlap exclusion constraint, and auto-rejects competing pendings.
- Lifecycle worker runs every 60s with advisory lock + `FOR UPDATE SKIP LOCKED`.
- Hold capture/release transitions are idempotent (`held → captured/released` guarded).
- CI runs typecheck, lint, tests, coverage, i18n validation, and format check on every PR.

---

*Generated by an automated code audit. Locations are accurate as of the audited commit; line numbers may drift as code changes.*
