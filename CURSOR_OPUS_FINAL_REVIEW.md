# Cursor Opus Final Review

_Independent, read-only pre-release audit of mohandishub.app. No files were edited. Every finding below was verified directly against the current repository code, not from prior reports._

## Executive Summary

- **Final verdict: READY_AFTER_SMALL_FIXES**
- **Short reason:** The whole build/test/lint/typecheck suite is green (185 tests pass), and the auth, session, OTP/email, password-reset, Resend, upload authorization, and deployment configuration are all genuinely solid and production-grade. There is exactly **one** real code defect that will crash a core flow: a React Rules-of-Hooks violation in the Chat screen that white-screens `/app/chat` on hard load / refresh / deep-link. Fix that one thing, then self-test.
- **P0 count: 1** (chat-scoped crash — see FIND-001)
- **P1 count: 1**
- **P2 count: 7**
- **P3 count: 4**

---

## What This App Appears To Be

- **Stack:** npm-workspaces monorepo.
  - `apps/web` — Next.js 15 (App Router, React 19) bilingual (English + Arabic/RTL) client, deployed on **Vercel**.
  - `apps/api` — Express 4 (TypeScript, ESM) REST + Socket.IO server, deployed on **Render** (web service + a separate worker).
  - `packages/shared` — shared types/utilities consumed by both.
  - `apps/e2e` — Playwright harness (separate workspace).
- **Data/infra:** PostgreSQL via **Supabase** (SQL migrations in `supabase/migrations`), Supabase Storage (`uploads` public bucket, `verification-docs` private bucket), **Resend** for transactional email/OTP, **Didit** for KYC, optional Agora (calls), Sentry, and payment rails (NOWPayments / Paymob / Stripe) that are **disabled by default**.
- **Roles:** `customer`, `expert`, `craftsman`, `business`, plus `admin` (permission-based). Verifiable roles (expert/craftsman/business) go through onboarding + verification.
- **Main flows:** signup → email OTP verification → login → role onboarding → dashboard → post a need / create a service → bid/respond → booking/reservation → chat (with attachments) → reviews; plus wallet/escrow and an admin console.
- **Auth model:** short-lived JWT access token (Bearer, 15 min) + opaque rotating refresh token stored hashed in DB, delivered as an httpOnly cookie scoped to `/api/auth` (`SameSite=None; Secure` in production). Refresh uses token-family rotation with reuse detection.

---

## Top Risks Before External Testers

1. **Chat page crashes on refresh / deep-link (FIND-001, P0 chat-scoped).** A hooks-order bug white-screens `/app/chat` whenever the page is loaded cold (browser refresh, opening a `/app/chat?c=<id>` link, or the first load right after login while the session is still resolving). In-app navigation to chat works, which can mask it during casual clicking — but a tester following the "refresh while logged in" step, or clicking a chat notification link, will hit it.
2. **This class of bug is invisible to CI (FIND-002, P1).** `eslint-plugin-react-hooks` is not configured, so the hooks violation passed lint. Any similar regression will also pass.
3. **API failures in main lists look like "empty" states (FIND-003, P2).** Several core data loads `catch {}` silently, so a transient API/network error renders "you have nothing" instead of an error — confusing during testing and hard to diagnose.
4. **No route-level error boundaries (FIND-004, P2).** There is no `error.tsx`/`global-error.tsx` anywhere under `apps/web/app`, so any uncaught render error (including FIND-001 until fixed) shows the raw Next.js error screen rather than a friendly fallback.
5. **Deployment depends on dashboard-only secrets that cannot be proven from the repo** (Didit keys, Resend key/sender, Supabase keys, JWT secrets). The env-validation code will hard-fail startup if these are missing in production — good — but they must be confirmed in the Render/Vercel dashboards (see Manual Dashboard Checklist).

---

## Must Fix Before Self-Testing

**FIND-001 — Chat screen React hooks violation (crashes `/app/chat` on cold load).** This is the only issue that blocks self-testing. One-line fix (move the hook call above the early return). Details in Findings.

There are **no** P0-severity auth/security/data-exposure/deployment issues. FIND-001 is scoped to the chat feature (it does not affect login, signup, OTP, or other pages), which is why the overall verdict is READY_AFTER_SMALL_FIXES rather than NOT_READY.

---

## Must Fix Before External Testers

- **FIND-001 (P0, chat)** — chat crash on cold load. Must be fixed.
- **FIND-002 (P1)** — add `eslint-plugin-react-hooks` so this bug class is caught in CI/lint before the next round.
- **FIND-003 (P2, recommended)** — surface an error state (not silent empty) in the main lists (chat, customer dashboard, services), so testers can tell "broke" from "empty".
- **FIND-004 (P2, recommended)** — add at least a top-level `app/[locale]/app/error.tsx` so a crash degrades gracefully instead of a raw stack page.

---

## Safe To Leave Until After Testers

- FIND-005 (P2) — `/app/projects` is reachable by URL but not in the sidebar nav.
- FIND-006 (P2) — `/app/settings` and `/app/profile` render the identical `ProfileScreen`.
- FIND-007 (P2) — wallet unread indicator is attached to `/app/settings` instead of `/app/settings/wallet`.
- FIND-008 (P2) — `NEXT_PUBLIC_PAYMOB_ENABLED` is declared in `.env.example` but read nowhere (dead/misleading flag).
- FIND-009 (P2) — hard-coded English strings in a few wallet/services sub-sections (Arabic testers see English there).
- FIND-010 (P2) — Disputes nav item shown to all roles (a plain customer sees an empty "No dispute cases yet").
- FIND-011 (P3) — Content-Security-Policy is `report-only` on both API and web (not enforced).
- FIND-012 (P3) — Dead code: `ComingSoonPage` component and `common.comingSoon` strings are unused.
- FIND-013 (P3) — API `authenticate` middleware runs a DB query on every authenticated request (fine at tester scale; note for later).
- FIND-014 (P3) — API still accepts `primaryRole` on the admin update endpoint even though the UI no longer sends it (defense-in-depth only; see FIND-A note).

---

## Findings

### FIND-001 — Chat screen calls a hook after a conditional early return (crash)
- **ID:** FIND-001
- **Severity:** P0 (scoped to the chat feature)
- **Category:** Logic bug / core-flow breakage (React Rules of Hooks)
- **File/path:** `apps/web/components/app/chat-screen.tsx:222` (early return) and `:232` (`const { openProfileModal } = useProfileModal();`)
- **What is wrong:** `useProfileModal()` (which calls `useContext`, `apps/web/components/app/profile-modal-context.tsx:46`) is invoked at line 232, *after* the conditional early return `if (!isReady || !authUser) return …` at line 222. `isReady` initializes to `false` (`apps/web/components/auth/auth-provider.tsx:68`) and flips to `true` after session bootstrap. On the first render the component returns early and never calls `useProfileModal`; on the next render it does — changing the hook count between renders. React then throws "Rendered more hooks than during the previous render." `AppShell` renders `{children}` unconditionally (`apps/web/components/app/app-shell.tsx:274`), so the chat page mounts before `isReady` is true and this transition always happens on a cold load.
- **Why it matters:** Chat is a core tester flow, and "refresh the page while logged in" is an explicit self-test step. Refreshing on `/app/chat`, opening a chat deep-link (`/app/chat?c=<id>`), or landing on chat right after login white-screens the page. It does *not* reproduce when navigating to chat from another in-app page (session already ready), which can hide it.
- **How to verify manually:** Log in, navigate to `/en/app/chat`, then press browser refresh (F5). Expect the chat UI to blank out / show an error overlay. Check the browser console for "Rendered more hooks than during the previous render." Compare: navigating to chat via the sidebar (no refresh) works.
- **Suggested smallest safe fix:** Move `const { openProfileModal } = useProfileModal();` up to the other hooks near line 52 (before the `if (!isReady …)` early return). No behavior change; just relocates one line so hook order is stable.
- **Fix risk:** small
- **Should it block testers:** **yes**

### FIND-002 — `eslint-plugin-react-hooks` not configured
- **ID:** FIND-002
- **Severity:** P1
- **Category:** Build/release readiness (missing safety net)
- **File/path:** `eslint.config.mjs` (no `react-hooks` plugin/rules present)
- **What is wrong:** The ESLint config includes `@typescript-eslint`, `import`, and `@next/next` rules but not `eslint-plugin-react-hooks`. That is why FIND-001 passed `npm run lint` cleanly.
- **Why it matters:** Without `react-hooks/rules-of-hooks`, this exact category of crash-causing bug is undetectable by CI and can regress again.
- **How to verify manually:** `npm run lint` passes today despite FIND-001. After adding the plugin, lint should flag `chat-screen.tsx:232`.
- **Suggested smallest safe fix:** Add `eslint-plugin-react-hooks` to the web ESLint block with `rules-of-hooks: error` (and optionally `exhaustive-deps: warn`). Do this alongside/after FIND-001 so the build doesn't turn red on the existing violation.
- **Fix risk:** small (may surface a few `exhaustive-deps` warnings — keep those as `warn`, not `error`)
- **Should it block testers:** no (but strongly recommended before the next round)

### FIND-003 — Silent `catch {}` in main data loads hides API errors
- **ID:** FIND-003
- **Severity:** P2
- **Category:** UX / missing error state
- **File/path:** `apps/web/components/app/chat-screen.tsx:103` and `:120`; also reported by the UI sweep in `apps/web/components/app/customer-dashboard.tsx` (needs/bids loads) and `apps/web/components/app/services-screen.tsx` (services list).
- **What is wrong:** On fetch failure the catch block is empty and the code falls through to the empty/`[]` state.
- **Why it matters:** A backend hiccup during testing looks identical to "there's nothing here," making tester bug reports ambiguous and masking real API problems.
- **How to verify manually:** Temporarily block the API (e.g. stop the API or throttle offline in devtools), open Chat / dashboard; observe it shows "no conversations / nothing" instead of an error.
- **Suggested smallest safe fix:** Set an error flag in the catch and render the existing error/empty component variant with a retry.
- **Fix risk:** small
- **Should it block testers:** no

### FIND-004 — No route-level error boundaries in the web app
- **ID:** FIND-004
- **Severity:** P2
- **Category:** UX / resilience
- **File/path:** `apps/web/app/**` (no `error.tsx` / `global-error.tsx` present)
- **What is wrong:** There are no App Router error boundaries, so an uncaught render error (e.g. FIND-001 before it's fixed) surfaces Next.js's raw error UI.
- **Why it matters:** Determines whether a crash is a friendly "something went wrong, retry" or a scary raw page for testers.
- **How to verify manually:** Trigger FIND-001; note the raw error overlay/page rather than a branded fallback.
- **Suggested smallest safe fix:** Add a minimal `apps/web/app/[locale]/app/error.tsx` client error boundary with a retry button.
- **Fix risk:** small
- **Should it block testers:** no

### FIND-005 — `/app/projects` reachable only by URL (not in nav)
- **ID:** FIND-005 · **Severity:** P2 · **Category:** Navigation/UX
- **File/path:** route `apps/web/app/[locale]/app/projects/page.tsx`; sidebar `apps/web/components/app/app-sidebar.tsx` (no `projects` entry).
- **What is wrong / why it matters:** The route exists and renders (for customers it shows an informational line) but has no nav entry, so testers won't discover it and may report "missing feature."
- **How to verify manually:** Load `/en/app/projects` directly (renders) vs. look for it in the sidebar (absent).
- **Suggested smallest safe fix:** Either add a nav item or leave it out of the tester script.
- **Fix risk:** small · **Should it block testers:** no

### FIND-006 — `/app/settings` and `/app/profile` render the same component
- **ID:** FIND-006 · **Severity:** P2 · **Category:** UX/navigation
- **File/path:** `apps/web/app/[locale]/app/settings/page.tsx` and `apps/web/app/[locale]/app/profile/page.tsx` both mount `ProfileScreen`.
- **What is wrong / why it matters:** "Settings" duplicates "Profile"; testers may be confused about where account settings live (actual wallet lives at `/app/settings/wallet`).
- **How to verify manually:** Open both routes; note identical UI.
- **Suggested smallest safe fix:** Out of scope for release; document in tester script or differentiate later.
- **Fix risk:** medium (product decision) · **Should it block testers:** no

### FIND-007 — Wallet unread dot attached to the wrong nav item
- **ID:** FIND-007 · **Severity:** P2 · **Category:** UX
- **File/path:** `apps/web/components/app/app-sidebar.tsx` (indicator on `/app/settings`; wallet page is `/app/settings/wallet`).
- **What is wrong / why it matters:** The wallet "unread"/new-activity dot shows on Settings, and is cleared by visiting the wallet page — mildly misleading, not functional.
- **How to verify manually:** Trigger a wallet event; observe the dot on Settings rather than on the wallet entry.
- **Suggested smallest safe fix:** Move the indicator to the wallet nav entry.
- **Fix risk:** small · **Should it block testers:** no

### FIND-008 — `NEXT_PUBLIC_PAYMOB_ENABLED` is a dead flag
- **ID:** FIND-008 · **Severity:** P2 · **Category:** Config clarity
- **File/path:** declared `apps/web/.env.example:25`; **referenced nowhere** in `apps/web` code (verified). Paymob is gated server-side by `paymentMethodsEnabled` + `PAYMOB_DEPOSITS_ENABLED=false`.
- **What is wrong / why it matters:** Setting this env var does nothing; a QA/ops person could believe they enabled/disabled Paymob when they did not. (Contrast `NEXT_PUBLIC_NOWPAYMENTS_FIAT_ENABLED`, which *is* wired at `apps/web/components/app/wallet-deposit-modal.tsx:33`.)
- **How to verify manually:** Grep the web app for `NEXT_PUBLIC_PAYMOB_ENABLED` — only the `.env.example` line matches.
- **Suggested smallest safe fix:** Remove the line from `.env.example` or wire it. Not a blocker because Paymob is disabled anyway.
- **Fix risk:** small · **Should it block testers:** no

### FIND-009 — Hard-coded English strings in a few wallet/services sub-sections
- **ID:** FIND-009 · **Severity:** P2 · **Category:** i18n
- **File/path:** e.g. `apps/web/components/app/wallet-settings-screen.tsx` ("Withdraw", "Withdrawal history", "Create withdrawal"); `apps/web/components/app/services-screen.tsx` ("Coupon campaigns" block). (Reported by the UI sweep; these are provider-only/secondary sections.)
- **What is wrong / why it matters:** Arabic/RTL testers see English labels in those specific sub-panels. Core auth/onboarding/needs/chat flows are fully localized; these are edge panels.
- **How to verify manually:** Switch to Arabic, open the provider wallet/withdraw section and the services coupon panel; note English labels.
- **Suggested smallest safe fix:** Move the literals into `en.ts`/`ar.ts`. Non-blocking.
- **Fix risk:** small · **Should it block testers:** no

### FIND-010 — Disputes nav shown to all roles
- **ID:** FIND-010 · **Severity:** P2 · **Category:** UX
- **File/path:** `apps/web/components/app/app-sidebar.tsx` (Disputes item has no role filter); `apps/web/components/app/disputes-screen.tsx` shows "No dispute cases yet."
- **What is wrong / why it matters:** A plain customer sees a Disputes tab that is always empty for them. Harmless, mildly confusing.
- **How to verify manually:** Log in as a customer; the Disputes tab is visible but empty.
- **Suggested smallest safe fix:** Role-gate the nav item, or leave and mention in the tester script.
- **Fix risk:** small · **Should it block testers:** no

### FIND-011 — CSP is report-only (not enforced)
- **ID:** FIND-011 · **Severity:** P3 · **Category:** Security hardening
- **File/path:** `apps/api/src/app.ts:33` (`reportOnly: true`); `apps/web/next.config.ts:67` (`Content-Security-Policy-Report-Only`). Both also allow `'unsafe-inline'`/`'unsafe-eval'` in `script-src`.
- **What is wrong / why it matters:** CSP is observe-only, so it won't block injection. Not a tester blocker; a hardening item for later. Note: enforcing it later needs care because of `unsafe-inline`/`unsafe-eval`.
- **How to verify manually:** Inspect response headers — only the `-Report-Only` variant is present.
- **Suggested smallest safe fix:** Defer; enforce post-tester after removing inline/eval needs.
- **Fix risk:** medium · **Should it block testers:** no

### FIND-012 — Dead "coming soon" code
- **ID:** FIND-012 · **Severity:** P3 · **Category:** Cleanup
- **File/path:** `apps/web/components/app/coming-soon-page.tsx` (`ComingSoonPage` never imported); `common.comingSoon` in `en.ts:7`/`ar.ts:7` only consumed by it.
- **What is wrong / why it matters:** Unused; no route renders it. No tester impact. (`companyUploadComingSoon` is separate — it's descriptive onboarding copy, not a blocked feature.)
- **How to verify manually:** Grep for `ComingSoonPage` — only its own definition matches.
- **Suggested smallest safe fix:** Remove later.
- **Fix risk:** small · **Should it block testers:** no

### FIND-013 — Per-request DB lookup in `authenticate`
- **ID:** FIND-013 · **Severity:** P3 · **Category:** Performance (note only)
- **File/path:** `apps/api/src/middleware/authenticate.ts:79-112`
- **What is wrong / why it matters:** Every authenticated request runs a `SELECT` on `users` to re-check active/role/admin/email-verified. This is a deliberate security choice (revocations take effect immediately) and is fine at tester scale; flagging only so it's on the radar for load later. A `user-status-cache` exists in the codebase but is not used by this path.
- **How to verify manually:** N/A (design note).
- **Suggested smallest safe fix:** None for release.
- **Fix risk:** n/a · **Should it block testers:** no

### FIND-014 — Admin update endpoint still accepts `primaryRole`
- **ID:** FIND-014 · **Severity:** P3 · **Category:** Data consistency / defense-in-depth
- **File/path:** `apps/api/src/modules/admin/admin.service.ts:161`, `admin.validation.ts:27`, `admin.controller.ts:284`. UI no longer sends it (see "Admin role edit status" below).
- **What is wrong / why it matters:** The API still lets an admin change `primary_role` without provisioning the matching role profile, which could create a role/profile mismatch. The web UI has already disabled this (field is read-only and not sent), so a normal admin cannot trigger it. Only a hand-crafted API call by an authenticated admin with `manage_users` could. This matches the stated intent ("disabled, not fully migrated").
- **How to verify manually:** In the admin user modal the Role field is read-only (`admin-user-detail-modal.tsx:851`) and `handleSaveAccount` (`:360`) omits `primaryRole`.
- **Suggested smallest safe fix:** Optionally reject `primaryRole` server-side too; not required for tester release.
- **Fix risk:** small · **Should it block testers:** no

---

## Things I Checked And Found Acceptable

- **Resend integration status — GOOD.** `apps/api/src/utils/resend-email.ts` uses the official `resend` SDK, requires `RESEND_API_KEY` + `EMAIL_FROM`, and throws on missing config or send error. Used by OTP (`otp.provider.ts` `ResendEmailSender`), password reset (`auth.service.ts`), and shared transactional email (`send-transactional-email.ts`). Provider is selected by `OTP_EMAIL_PROVIDER`.
- **OTP/email verification status — GOOD.** 6-digit crypto-random codes (`randomInt`), SHA-256 hashed at rest, 10-min TTL, max 5 sends/hour/user/channel, attempt limiting with family invalidation, destination masking. Production env validation forbids the `console` provider (`env.ts:233`).
- **Forgot-password/reset-password status — GOOD.** Generic non-enumerating response, hashed 32-byte token with 2h expiry, expiry enforced in SQL (`password_reset_expires > now()`), all sessions revoked on reset. Dev reset link only leaked when `NODE_ENV!=production` AND `OTP_EMAIL_PROVIDER=console`.
- **Auth/session status — GOOD.** Bcrypt (cost 12), rotating opaque refresh tokens hashed with a separate secret, token-family reuse detection, disabled/deleted accounts rejected on refresh and on every authenticated request.
- **Protected route/middleware status — GOOD.** Web middleware soft-gates `/[locale]/app/*` on the session cookie and redirects to `/auth`; real enforcement is server-side via Bearer JWT. Locale handling and `x-mohandishub-locale` header are consistent.
- **API auth middleware status — GOOD.** `authenticate` verifies JWT then re-validates the user row (active/role/admin/email-verified). `require-trusted-auth-origin` protects `/refresh` and `/logout` against CSRF by checking Origin/Referer against the CORS allowlist.
- **Admin role edit status — GOOD (as intended).** UI Role field is read-only and not submitted; see FIND-014 for the residual API-only note.
- **`/app/browse` status — GOOD.** It now `redirect()`s to `/${locale}/app/services` (`browse/page.tsx:12`); no placeholder shown.
- **Private upload logging status — GOOD.** No debug `console.*` remain in the web app (only a code comment in `toast.tsx`) or in the private-upload proxy/API path. API `console.*` are limited to dev/console email+OTP senders and a migration script.
- **Supabase storage / private preview status — GOOD.** Two buckets created by migration `20260316000000_storage_buckets.sql` (`uploads` public, `verification-docs` private) matching the code constants. Private files are served only via authorized, short-lived (15 min) signed URLs; access is limited to the owner, permissioned admins, job owners of a CV application, or money-proof viewers (`upload.routes.ts:281-334`). The Next proxy (`private-upload-proxy.ts`) is SSRF-safe (host is always the configured API base; client origin is discarded).
- **Arabic/i18n status — GOOD.** `node scripts/validate-i18n.mjs` passes (required snippets present, no mojibake in dictionaries or source). Any previously corrupted Arabic fallback/source text is resolved. (Minor untranslated sub-panels: FIND-009.)
- **Build/test script status — GOOD.** `npm run typecheck`, `npm run lint`, and `npm run test` all pass (shared 10, api 135, web 40 = 185 tests). Scripts are real and correctly wired in `package.json`.
- **Render/Vercel config status — GOOD.** `render.yaml` defines API (`/health/ready` health check present and implemented) + worker; production env vars use `sync:false` for secrets. `apps/web/vercel.json` builds shared then `next build`; the Windows-only `fix-next-server-chunks.mjs` step is correctly omitted on Vercel (Linux). Env validation (`env.ts`) hard-fails production startup on missing/placeholder secrets, wrong email provider, missing Supabase keys, etc.
- **Disabled payment/provider status — GOOD.** Stripe unused in active flows; NOWPayments `NOWPAYMENTS_LIVE_REQUIRED=false`; Paymob `PAYMOB_DEPOSITS_ENABLED/WITHDRAWALS_ENABLED=false`; card deposits disabled by launch-default migration. Deposit UI degrades gracefully to "no methods available" rather than breaking.
- **Release script status — GOOD.** `scripts/ship.mjs` is clean (no corrupted symbols), requires `SHIP_CONFIRM=YES`, and refuses to migrate without it.
- **Secrets status — GOOD.** Only `*.env.example` files are tracked; `.env`/`.env.local` are git-ignored; env examples contain placeholders only.

---

## Manual Dashboard Checklist

_These cannot be proven from the repo — confirm in the provider dashboards._

- **Vercel (web):** `NEXT_PUBLIC_API_URL=https://api.mohandishub.app` is set (needed for cross-origin API + private-upload proxy). Domain `mohandishub.app` (and `www`) resolve; production build succeeds. `NEXT_PUBLIC_AGORA_APP_ID` set only if calls are in tester scope.
- **Render API:** service healthy at `/health/ready` (200). All `sync:false` secrets set: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (must differ), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `SENTRY_DSN`, and — because `VERIFICATION_PROVIDER=didit` in the blueprint — `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET`, `DIDIT_WORKFLOW_ID` (missing any of these will hard-fail startup). `TRUST_PROXY=1`, `CORS_ORIGIN` includes the real web origin(s).
- **Render worker:** running; same DB/Supabase/Resend/Sentry env as API (worker also runs env validation and will fail without them). Retention env vars sane.
- **Supabase:** project is active (not paused); all migrations applied; buckets `uploads` (public) and `verification-docs` (private) exist with correct visibility.
- **Resend:** sender domain/address for `EMAIL_FROM` verified; API key valid; quota sufficient for a testing cohort. (Production OTP send was reportedly verified manually.)
- **Didit (if KYC is in tester scope):** workflow ID valid, webhook URL registered/reachable, secret matches env.
- **NOWPayments / Paymob / Stripe:** confirm they remain **disabled** (flags off). If any deposit method is intended for testers, verify IPN/webhook secrets + callback URLs; otherwise leave off.
- **Agora (if calls in scope):** App ID + certificate set on API; `NEXT_PUBLIC_AGORA_APP_ID` on web.
- **Sentry:** errors from both API and worker are actually arriving (do a test throw).
- **DNS/callback URLs:** `api.mohandishub.app` and `mohandishub.app` certificates valid; refresh cookie works cross-site (login persists after refresh).

---

## Exact Manual Self-Test Order

> Run against production (or a prod-like staging) with Resend live. Watch Render logs + Sentry throughout. **Do FIND-001 first** or chat refresh will crash.

1. **Signup with a fresh email** — _Role: new customer._ Go to `/en/auth?mode=register`, complete the form (accept terms). **Expect:** account created, redirected toward email verification, 201 from `/api/auth/register`. **Failure signs:** 500s, stuck spinner, no OTP triggered.
2. **OTP verification** — _customer._ Enter the 6-digit code from the Resend email. **Expect:** email marked verified, access to app. **Failure:** no email arrives (check Resend logs), "OTP_SEND_FAILED", code rejected despite being correct.
3. **Login** — _customer._ Log out then log in with the new credentials. **Expect:** 200, lands on the app home. **Failure:** 401 on valid creds, `LOGINS_LOCKED`.
4. **Refresh page while logged in** — on the app home **and specifically on `/en/app/chat`**, press F5. **Expect:** session persists, page re-renders fully. **Failure:** logged out (refresh-cookie/SameSite issue) or **chat white-screens (FIND-001 — must be fixed)**.
5. **Logout** — **Expect:** redirected to auth, refresh cookie cleared, protected routes redirect to login. **Failure:** still authenticated after logout.
6. **Forgot password / reset password** — request reset for the test email, open the Resend link, set a new password. **Expect:** generic "if registered…" message, working reset link, all sessions invalidated, login works with the new password. **Failure:** no email, expired-token error on a fresh link, old password still works.
7. **Customer onboarding** — _customer._ Complete any customer onboarding/profile step. **Expect:** reaches dashboard. **Failure:** stuck loop.
8. **Expert / craftsman / business onboarding** — _one account per role._ Register each, complete onboarding; note these roles are pushed to `/onboarding/<role>` until verified (`app-shell.tsx`). **Expect:** onboarding renders, verification state respected. **Failure:** redirect loop, blank onboarding, verification never satisfiable.
9. **Create need/project** — _customer._ Post a need (title, description, budget, timeline). **Expect:** appears in the customer's needs list. **Failure:** silent failure that looks like an empty list (FIND-003).
10. **Provider bid/respond flow** — _expert or craftsman._ Find the need, submit a bid (amount + message). **Expect:** bid recorded and visible to the customer. **Failure:** bid not shown, 4xx/5xx.
11. **Service booking/reservation** — _customer books a provider's service._ Create a service as a provider, then book it as a customer. **Expect:** reservation created with correct status transitions. **Failure:** stuck status, missing slot.
12. **Chat / attachment flow** — _both parties._ Open the conversation from a bid/booking, send text, an image, a link, and a location. **Expect:** realtime delivery, attachments preview, no crash on refresh (recheck FIND-001). **Failure:** messages don't arrive, attachment preview fails, page crashes.
13. **Verification/KYC flow (if in tester scope)** — _expert/business._ Start Didit verification. **Expect:** provider flow launches, webhook updates status. **Failure:** provider error, status never updates. _(If Didit is out of scope, use `VERIFICATION_PROVIDER=manual` / admin verification and skip.)_
14. **Wallet/deposit/withdrawal (only if enabled)** — payment rails are disabled by default, so a tester **cannot** self-fund. To exercise escrow/bid-payment, have an **admin credit the wallet** (admin wallet-rails tab) then test bid payment/release. **Expect:** balance updates, escrow holds/releases correctly. **Failure:** negative balance, double-credit, stuck escrow. _(Skip real deposits/withdrawals.)_
15. **Admin review/settings flow** — _admin account._ Review users, verifications, disputes, settings toggles. **Expect:** lists load, permission gating works, role field is read-only. **Failure:** unauthorized access, 500s.
16. **Arabic smoke test** — switch to Arabic (`/ar/...`), walk signup → onboarding → need → chat. **Expect:** RTL layout, Arabic copy in core flows (some provider wallet/services sub-panels remain English — FIND-009). **Failure:** broken RTL, mojibake, missing keys.
17. **Mobile smoke test** — on a phone (or devtools device mode), repeat signup → dashboard → create need → chat. **Expect:** usable layout, tables scroll horizontally. **Failure:** overflow, unreachable buttons.
18. **Check Render logs / Sentry after testing** — confirm no unhandled 5xx, no repeated env/startup warnings, and that Sentry captured any errors you intentionally triggered.

---

## External Tester Script (for non-technical testers)

You'll get a login (or sign up with your own email). Please try to actually *use* the app like a real customer/provider and tell us what happens.

**Do this, in order:**
1. Sign up with your email and verify the code we email you.
2. Log in, then **refresh the page** on a couple of screens (especially **Chat**).
3. Fill in your profile / onboarding.
4. Post a need (as a customer) **or** create a service and place a bid (as a provider).
5. Open a chat and send a message, a photo, and a location.
6. Switch the language to Arabic and click around.
7. Try it on your phone.

**For anything odd, please report:**
- What confused you (where you didn't know what to do next).
- What broke (error message, blank page, spinning forever).
- What looked unfinished or "empty" when you expected content.
- What felt slow.
- **Screenshots or a screen recording** of the problem.
- Your **browser and device** (e.g. "iPhone 14, Safari" / "Windows, Chrome").
- **What you expected vs. what actually happened.**

Please **do not** test payments/deposits/withdrawals — those are turned off on purpose.

---

## Final Recommendation

**Fix P0 first, then self-test.** — Fix the one chat hooks bug (FIND-001, a one-line move), then run the self-test order above. Everything else is green and safe.

### 1) Top 5 fixes (only P0/P1 exist here)
1. **FIND-001 (P0):** Move `useProfileModal()` above the `if (!isReady || !authUser) return` early return in `apps/web/components/app/chat-screen.tsx`. Prevents the chat page from crashing on refresh/deep-link.
2. **FIND-002 (P1):** Add `eslint-plugin-react-hooks` (`rules-of-hooks: error`) so this class of bug can't ship again.
   _(Recommended-but-optional polish before external testers: FIND-003 surface errors instead of silent-empty; FIND-004 add a route `error.tsx`.)_

### 2) Exact manual self-test order
Use the 18-step "Exact Manual Self-Test Order" section above, in that order, starting with a fresh-email signup and paying special attention to step 4 (refresh, including on Chat) and step 12 (chat + attachments).

### 3) Should you send to external testers after self-testing?
**Yes — after** FIND-001 is fixed and your self-test passes through at least steps 1–12 and 15–17 without a crash. The security, auth, email, and deployment foundations are solid; the remaining P2/P3 items are cosmetic/UX and do not need to block an external tester round (just list the known gaps — orphaned `/app/projects`, Settings≈Profile, a few English strings in Arabic, disputes tab for customers — in the tester notes so they aren't reported as new bugs).
