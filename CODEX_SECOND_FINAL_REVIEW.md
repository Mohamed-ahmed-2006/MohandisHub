# Codex Second Final Review

## Executive Summary

- Final verdict: NOT_READY_MAIN_FLOW_BROKEN
- Short reason: provider onboarding and verification can be blocked because expert/craftsman avatar uploads are sent by the web app but ignored by the API persistence layer. I also found three strong P1 risks before external testers: stale/effective verification status mismatch in auth, a destructive admin factory-reset API without server-side confirmation, and a still-writable admin primary-role API field.
- P0 count: 1
- P1 count: 3
- P2 count: 5
- P3 count: 0

Safe checks run:

- `npm run validate:i18n`: passed.
- `npm run lint`: passed.
- `npm run format:check`: failed on current workspace formatting inputs.

I did not run `typecheck`, `test`, `build`, or `e2e` because the root scripts generate workspace artifacts (`dist`, `.next`, typegen, reports) and the instruction was to create one report file only. The scripts are present and should be run after the P0/P1 fixes.

## What This App Appears To Be

MohandisHub is a bilingual Arabic/English marketplace web app with a Next.js web frontend, Express/TypeScript API, shared package, Supabase Postgres/Storage, Resend email, Didit verification, optional NOWPayments/Paymob wallet rails, Socket.IO chat, and admin operations. Main roles are customer, expert, craftsman, business, and admin. Deployment appears split between Vercel for the web app and Render for API/worker services.

Main flows include signup, OTP email verification, login/refresh/logout, role onboarding, needs/projects, provider services/bids, reservations/bookings, chat and attachments, KYC/manual verification, wallet/deposits/withdrawals, and admin moderation/settings.

## Top Risks Before External Testers

1. Provider avatars are not persisted, which can block expert/craftsman onboarding and image-required verification.
2. Auth tokens and `requireVerified` can disagree with the effective profile verification state, causing newly approved providers to be blocked or stale tokens to remain over-trusted.
3. Admin factory reset is protected only by admin permission and a client-side phrase, not server-side confirmation or a higher privilege gate.
4. Admin primary-role editing is hidden/read-only in the UI but still accepted by the API.
5. The current workspace fails `npm run format:check`; if CI is a release gate, this will block release until cleaned.

## Must Fix Before Self-Testing

- MH-F-001: Expert/craftsman avatar updates are ignored by the API repository, blocking provider onboarding/verification paths.

## Must Fix Before External Testers

- MH-F-001: Persist `avatarUrl` to `users.avatar_url`.
- MH-F-002: Make auth token `verified` and `requireVerified` use effective, image-aware verification status.
- MH-F-003: Add server-side confirmation and stronger permission/production guard for factory reset, or remove it from tester/admin scope.
- MH-F-004: Reject `primaryRole` changes at the admin API until role migration is intentionally implemented.

## Safe To Leave Until After Testers

These should not delay the first tester wave if tester scripts avoid the affected edge cases:

- MH-F-005: Formatting gate failure, unless CI is required for the release.
- MH-F-006: Open chat-start API can create conversations with arbitrary users.
- MH-F-007: Multi-tab refresh can falsely revoke the refresh-token family.
- MH-F-008: Password-reset emails always link to `/en/auth/reset-password`.
- MH-F-009: Legacy `/api/users` seed endpoints remain authenticated but stale.

## Findings

### MH-F-001

- Severity: P0
- Category: Main user-flow breakage, database consistency, verification
- File/path:
  - `apps/api/src/modules/users/users.validation.ts`
  - `apps/api/src/modules/users/users.service.ts`
  - `apps/api/src/modules/auth/auth.repository.ts`
  - `apps/web/components/onboarding/expert-onboarding-screen.tsx`
  - `apps/web/components/onboarding/craftsman-onboarding-screen.tsx`
  - `apps/web/components/profile/profile-screen.tsx`
- What is wrong: the web app uploads and sends `avatarUrl`, and `UsersService.updateAccount` forwards `fields.avatarUrl`, but `AuthRepository.updateUser` only writes `display_name`, `phone`, `phone_code`, `nationality`, and `date_of_birth`. It never writes `avatar_url`.
- Why it matters: expert and craftsman onboarding require an avatar. Verification helpers also require an avatar for effective verified status. A tester can upload a profile photo, see the local preview, continue briefly, then reload or refresh and be treated as missing the avatar. This can block provider onboarding, verified-only services/jobs/bids/reservations, and admin verification expectations.
- How to verify manually: create or log in as an expert/craftsman, upload a profile photo during onboarding or profile edit, save, refresh the page, then check whether the avatar still appears and whether `/api/auth/me` returns `avatarUrl`. Also check the DB `users.avatar_url` for that user.
- Suggested smallest safe fix: in `AuthRepository.updateUser`, accept `avatarUrl?: string | null` and map it to `avatar_url = $n`. Add a focused test that `PATCH /api/users/me` with `avatarUrl` persists and returns it, then verify `syncVerificationStatusForRequiredImage` sees the stored value.
- Fix risk: small
- Whether it should block testers: yes

### MH-F-002

- Severity: P1
- Category: Auth, session, permissions, verification
- File/path:
  - `apps/api/src/middleware/authenticate.ts`
  - `apps/api/src/middleware/require-verified.ts`
  - `apps/api/src/modules/auth/auth.service.ts`
  - `apps/api/src/modules/auth/auth.repository.ts`
  - `apps/api/src/modules/profiles/verification-image-requirements.ts`
- What is wrong: `authenticate` refreshes role/admin/email state from DB, but keeps `verified: payload.verified` from the JWT. `requireVerified` trusts that boolean. Separately, `AuthService.getVerificationStatus` reads raw role profile `verification_status` and does not use the same image-aware effective verification helpers used by profile/user flows.
- Why it matters: verified-only provider routes include services, jobs, ads, reservations, and some needs/bids flows. After admin approval or image/profile changes, the user can see one status in the UI but still get 403 until token refresh/relogin. The reverse can also happen if raw profile status says `verified` while required avatar/logo data is missing.
- How to verify manually: approve an expert/craftsman/business account in admin, then without logging out try to create a provider service or reservation slot. Also remove or fail to persist the required avatar/logo and compare `/api/verification/status`, `/api/auth/me`, and a verified-only API route.
- Suggested smallest safe fix: compute effective verification status in the auth path. Either include the role-specific profile/image join in `AuthService.getVerificationStatus`, or make `authenticate`/`requireVerified` check an effective DB status instead of trusting `payload.verified`. After approval/profile-image updates, refresh the client session.
- Fix risk: medium
- Whether it should block testers: yes

### MH-F-003

- Severity: P1
- Category: Admin, security, data corruption risk
- File/path:
  - `apps/api/src/modules/admin/admin.routes.ts`
  - `apps/api/src/modules/admin/admin.controller.ts`
  - `apps/api/src/modules/admin/admin.service.ts`
  - `apps/api/src/modules/admin/admin.repository.ts`
  - `apps/web/components/admin/admin-settings-tab.tsx`
  - `apps/web/lib/admin/client.ts`
- What is wrong: `POST /api/admin/factory-reset` requires `manage_settings`, but the API does not require a confirmation phrase, a request body, `super_admin`, or a production kill switch. The UI has a client-side phrase check, but the API directly calls `adminService.factoryReset(adminId)`.
- Why it matters: the repository method deletes users and related data except the platform user and current admin. Any admin token with `manage_settings` can invoke the endpoint directly. For admin testing, this is too easy to trigger accidentally or through a scripted request.
- How to verify manually: do not call this on production. In a local disposable database, send `POST /api/admin/factory-reset` with an admin bearer token and no body. It should currently execute if the admin has `manage_settings`.
- Suggested smallest safe fix: require a server-validated confirmation body such as `{ confirm: "FACTORY_RESET" }`, require `super_admin`, and disable the route in production unless an explicit `ALLOW_FACTORY_RESET=true` env flag is set. Hide the UI unless all server requirements are available.
- Fix risk: medium
- Whether it should block testers: yes for any admin tester

### MH-F-004

- Severity: P1
- Category: Admin, role consistency, permissions
- File/path:
  - `apps/api/src/modules/admin/admin.validation.ts`
  - `apps/api/src/modules/admin/admin.service.ts`
  - `apps/api/src/modules/admin/admin.repository.ts`
  - `packages/shared/src/admin.ts`
  - `apps/web/components/admin/admin-user-detail-modal.tsx`
- What is wrong: the admin UI shows `primaryRole` as a read-only input and normal account saves do not send it, but the shared type, API validation schema, and service still accept `primaryRole` and write `users.primary_role`.
- Why it matters: changing a user's primary role without migrating role-specific profiles, verification data, plans, and onboarding state can strand the account in an inconsistent state. It is admin-only, but admin testing is in scope.
- How to verify manually: in a local database, send `PATCH /api/admin/users/:id` with `{ "primaryRole": "business" }` as an admin with `manage_users`. The API currently accepts the field and updates the user.
- Suggested smallest safe fix: remove `primaryRole` from `AdminUpdateUserBody` and `updateUserSchema`, or reject it with a 400/403 until full role migration exists. Keep the UI read-only.
- Fix risk: small
- Whether it should block testers: yes for admin tester scope

### MH-F-005

- Severity: P2
- Category: Build/test/release readiness
- File/path:
  - `package.json`
  - `.github/workflows/ci.yml`
  - `apps/api/docs/STRIPE.md`
  - `apps/api/src/modules/retention/retention.types.ts`
  - `apps/api/src/modules/retention/retention.worker.ts`
  - `CURSOR_OPUS_FINAL_REVIEW.md`
- What is wrong: `npm run format:check` fails in the current workspace. Prettier reported formatting issues in `apps/api/docs/STRIPE.md`, two retention files, and the untracked `CURSOR_OPUS_FINAL_REVIEW.md`.
- Why it matters: CI runs `npm run format:check`. If CI is required before release, the release gate will fail even though this is not a runtime product bug.
- How to verify manually: run `npm run format:check` from the repo root.
- Suggested smallest safe fix: format the tracked files that are part of the release and remove or ignore untracked review artifacts before running CI. Do not treat this as a product blocker if deployment does not depend on CI.
- Fix risk: small
- Whether it should block testers: no, unless CI is the tester-release gate

### MH-F-006

- Severity: P2
- Category: Chat, abuse control, tester-facing scope
- File/path:
  - `apps/api/src/modules/chat/chat.routes.ts`
  - `apps/api/src/modules/chat/chat.controller.ts`
  - `apps/api/src/modules/chat/chat.service.ts`
  - `apps/api/src/modules/chat/chat.repository.ts`
- What is wrong: `POST /api/chat/conversations` accepts `otherUserId` and creates/fetches a conversation without validating that the users have a marketplace relationship, reservation, job, bid, negotiation, or support context. It also does not validate `otherUserId` with a schema before passing it to the repository.
- Why it matters: authenticated users can potentially start chats with arbitrary users if they know an ID. Existing conversation reads/writes are participant-checked, so this is not a broad data exposure, but it is an abuse/spam and product-scope issue.
- How to verify manually: in staging/local, create two unrelated users and call `POST /api/chat/conversations` from one user with the other's ID. Check whether a conversation is created.
- Suggested smallest safe fix: require a context ID or server-proven relationship for user-to-user chat, or reserve this open endpoint for support/admin only. Add UUID validation to the request body.
- Fix risk: medium
- Whether it should block testers: no if tester scripts only use chat from bids/bookings/jobs

### MH-F-007

- Severity: P2
- Category: Auth/session UX
- File/path:
  - `apps/web/lib/auth/refresh-coalesced.ts`
  - `apps/api/src/modules/auth/auth.service.ts`
  - `apps/api/src/modules/auth/auth.repository.ts`
- What is wrong: refresh rotation treats a second use of the same refresh token as reuse and revokes the whole token family. The web client coalesces refreshes only inside one browser tab, not across multiple tabs.
- Why it matters: if the same user opens multiple tabs and two tabs refresh at the same time, the second request can revoke the family and make the user appear logged out. This is a UX issue, not a security regression.
- How to verify manually: log in, open the app in two tabs, wait near access-token expiry or force both tabs to refresh, then watch whether one tab gets logged out after a concurrent refresh.
- Suggested smallest safe fix: add cross-tab refresh coordination via `BroadcastChannel`/localStorage lock, or make the server tolerate a short duplicate-refresh grace window for the immediately previous token.
- Fix risk: medium
- Whether it should block testers: no

### MH-F-008

- Severity: P2
- Category: Arabic/English UX, email
- File/path:
  - `apps/api/src/modules/auth/auth.service.ts`
  - `apps/web/app/[locale]/auth/reset-password/page.tsx`
- What is wrong: password reset emails always build the reset URL as `/en/auth/reset-password#token=...`. The reset page supports locale routes, but the API does not know or preserve the user's current locale.
- Why it matters: Arabic users can reset successfully, but the email/link drops them into the English reset page. This is a tester-facing language inconsistency, not a security issue.
- How to verify manually: from the Arabic UI, request a password reset and inspect the email link. It should currently point to `/en/auth/reset-password`.
- Suggested smallest safe fix: pass locale from the forgot-password page to the API, validate it as `en`/`ar`, and build the reset URL with that locale. Keep `/en` as fallback.
- Fix risk: small
- Whether it should block testers: no

### MH-F-009

- Severity: P2
- Category: API cleanup, stale route
- File/path:
  - `apps/api/src/modules/users/users.repository.ts`
  - `apps/api/src/modules/users/users.routes.ts`
  - `apps/api/src/modules/users/users.service.ts`
- What is wrong: `GET /api/users` and `GET /api/users/:id` still return a hardcoded `seedUsers` list. The active web app appears to use `/api/users/me` for account updates, not this seed list.
- Why it matters: authenticated, email-verified users can hit a stale endpoint that returns fake data. It does not expose real user data, but it is confusing and can mislead testers or future integrations.
- How to verify manually: call `GET /api/users` with a verified user's access token and observe the static `usr_1`, `usr_2`, `usr_3` records.
- Suggested smallest safe fix: remove these endpoints, admin-gate them, or replace them with a real paginated directory only if that is an intended product feature.
- Fix risk: small
- Whether it should block testers: no

## Things I Checked And Found Acceptable

- Resend integration status: production Render config selects `OTP_EMAIL_PROVIDER=resend`; Resend sender uses `resend.emails.send`; production env validation requires `RESEND_API_KEY` and `EMAIL_FROM` when provider is `resend`.
- OTP/email verification status: OTP service hashes codes, invalidates previous active codes, enforces send/attempt limits, and uses the configured email provider. Verify-email sends and verifies email OTP from protected routes after login/register.
- Forgot-password/reset-password status: reset tokens are random, HMAC-hashed at rest, time-limited, delivered through Resend in production, and placed in URL fragments rather than query strings. Reset clears the token and revokes refresh sessions.
- Auth/session status: access tokens are short-lived JWTs; refresh tokens are opaque, hashed, rotated, stored in HTTP-only cookies, and logout revokes the family. See MH-F-007 for the multi-tab edge case.
- Protected route/middleware status: web middleware redirects `/app` paths without the session hint, but API/page guards still perform real auth. API routes use `authenticate`, `requireEmailVerified`, `requireRole`, and `requireVerified` in the main modules sampled.
- API auth middleware status: `authenticate` checks token validity and refreshes role/admin/email active state from DB. See MH-F-002 for the verified-boolean mismatch.
- Admin role edit status: UI primary role is read-only and normal account saves do not send it. API still accepts it; see MH-F-004.
- `/app/browse` status: not a placeholder now. `apps/web/app/[locale]/app/browse/page.tsx` redirects to `/${locale}/app/services`.
- Private upload logging status: I did not find private upload debug `console.log`/`console.debug` in the private upload client/proxy/API paths.
- Supabase storage/private preview status: production requires Supabase storage; `uploads` bucket is public; `verification-docs` is private; private uploads return `/api/upload/private/:id`; API checks owner/admin/job/money-proof visibility before redirecting or streaming.
- Arabic/i18n status: `npm run validate:i18n` passed. Runtime mojibake scans did not find source corruption; terminal-rendered mojibake appears to be output encoding, not file content.
- Build/test script status: scripts exist for `validate:i18n`, `lint`, `typecheck`, `test`, `build`, `format:check`, and `e2e`. `validate:i18n` and `lint` passed. `format:check` failed. Build/typecheck/test/e2e were not run because they create artifacts or may require full environment.
- Render/Vercel config status: `render.yaml` defines API and worker services with Resend, Supabase, Didit, Sentry, CORS, and public URLs. Vercel web config builds shared then Next. The local Next server chunk fixer is explicitly a Windows workaround and is not a Vercel/Linux risk.
- Disabled payment/provider status: Stripe is present as legacy code/dependency but not the active launch rail. Paymob card/deposit/withdrawal toggles default disabled. SendGrid and Idenfy are blocked by production env validation. NOWPayments/crypto and manual InstaPay are visible only if app settings/provider config allow them; confirm dashboard values before wallet testing.

## Manual Dashboard Checklist

Only dashboard/live-state checks that cannot be proven from the repo:

- Vercel deployment/domain/env vars: confirm `mohandishub.app`, `www` handling if used, `NEXT_PUBLIC_API_URL`, and web build commit.
- Render API health/env vars: confirm `/health/ready`, `DATABASE_URL`, JWT secrets, `CORS_ORIGIN`, `API_PUBLIC_URL`, `WEB_PUBLIC_URL`, `TRUST_PROXY=1`, and Sentry DSN.
- Render worker status/env vars: confirm worker boot, DB connectivity, same provider env, and no crash loops.
- Supabase project active/migrations/storage buckets: confirm migrations applied, `uploads` public bucket exists, `verification-docs` private bucket exists, service role key is API-only, and RLS/storage policies match repo.
- Resend sender/domain/API key/quota: confirm sender domain verified, `EMAIL_FROM` matches a verified sender, API key valid, quota sufficient, and bounce/suppression state clean.
- Didit workflow/webhook if in tester scope: confirm workflow ID, API key, webhook secret, webhook URL, and callback domain match production API.
- NOWPayments/IPN if in tester scope: confirm API key, IPN secret, callback URLs, live/test mode, withdrawal flags, and dashboard payment method toggles.
- Agora app/certificate if in tester scope: confirm app ID/certificate, token generation, call routes, and allowed domains.
- Sentry error capture: confirm web/API DSNs and a test non-secret event from staging/self-test.
- domain/DNS/callback URLs: confirm API/web public URLs used in email reset, Didit callback, NOWPayments IPN, Paymob webhook, and Agora flows.
- disabled services that must remain disabled: confirm Stripe, Paymob card/payout, SendGrid, Idenfy, and any unused rails are disabled in dashboard/env and hidden from tester scripts.

## Exact Manual Self-Test Order

Use fresh accounts and a non-production or disposable tester dataset where possible. Do not test payment/KYC live providers unless that provider is explicitly configured for safe testing.

| Order | Flow                                 | Account role needed                     | Steps                                                                                                                | Expected result                                                                                        | Failure signs to watch for                                                                      |
| ----- | ------------------------------------ | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 1     | Signup with fresh email              | Customer first, then provider roles     | Open `/en/auth?mode=register`, register with a new email for customer. Repeat later for expert, craftsman, business. | Account is created, session starts, verify-email screen appears.                                       | Register 500/400, no redirect, duplicate account confusion, wrong role.                         |
| 2     | OTP verification                     | Same new account                        | Request/send OTP, enter code from Resend email.                                                                      | Email becomes verified and app continues to onboarding/app.                                            | No email, code rejected, resend throttles too early, remains unverified after refresh.          |
| 3     | Login                                | Verified account                        | Log out if needed, then log in with email/password.                                                                  | User lands in app with correct role and nav.                                                           | Invalid login for correct password, wrong role, broken redirect.                                |
| 4     | Refresh page while logged in         | Verified account                        | Hard refresh an app page and wait for auth ready state.                                                              | Session refreshes silently and user remains logged in.                                                 | Redirect to login, repeated loading, 401 loop.                                                  |
| 5     | Logout                               | Verified account                        | Use avatar/menu logout.                                                                                              | Refresh cookie/session hint cleared and app returns to login/public page.                              | Still logged in after refresh, logout error, stale chat socket.                                 |
| 6     | Forgot/reset password                | Any account                             | Use forgot password, open email link, set new password, log in with new password.                                    | Reset succeeds, old sessions revoked, new login works.                                                 | No email, token invalid, reset page wrong/broken, old password still works.                     |
| 7     | Customer onboarding                  | Customer                                | Complete profile basics and enter dashboard.                                                                         | Customer sees needs/services browsing and can create a need/project.                                   | Onboarding repeats after refresh, required fields unclear, mobile overflow.                     |
| 8     | Expert/craftsman/business onboarding | Expert, craftsman, business             | Complete each role's onboarding, including avatar/logo, manual/Didit path as in scope.                               | Provider profile persists after refresh and status makes sense.                                        | MH-F-001 avatar missing, status stuck, cannot continue, verification mismatch.                  |
| 9     | Create need/project                  | Customer                                | Create a need/project with category, budget, timeline, location/details.                                             | Need appears in customer dashboard and provider browse/search.                                         | Need missing, validation unclear, budget/currency wrong.                                        |
| 10    | Provider bid/respond flow            | Expert/craftsman/business as applicable | Browse open needs, submit bid/response, customer views and awards/responds.                                          | Bid appears to customer, notifications/messages work.                                                  | 403 verification required unexpectedly, bid not visible, wallet hold errors.                    |
| 11    | Service booking/reservation flow     | Provider plus customer                  | Provider creates service/slot if required; customer books/reserves; provider accepts/auto-accepts.                   | Reservation appears for both sides with correct status and times.                                      | Slot unavailable incorrectly, payment/hold requirement blocks unexpectedly, timezone confusion. |
| 12    | Chat/attachment flow                 | Two related accounts                    | Send text, link/location if available, upload attachment/private file.                                               | Both sides see messages; attachment opens only for allowed users.                                      | Message not delivered, attachment 403 for participant, attachment visible to unrelated user.    |
| 13    | Verification/KYC flow if enabled     | Expert/craftsman/business/admin         | Start Didit or submit manual docs; admin approves/rejects; provider retries action.                                  | Status updates and provider can use verified-only features.                                            | Approved user still blocked, missing avatar/logo keeps status confusing, webhook not received.  |
| 14    | Wallet/deposit/withdrawal if enabled | Customer/provider/admin                 | Open wallet, try only configured safe rails; for manual InstaPay use test proof; admin reviews.                      | Hidden disabled rails stay hidden; enabled rails show clear instructions; ledger updates after review. | Crypto/card shown without provider config, generic payment errors, balances wrong.              |
| 15    | Admin review/settings flow           | Admin with least needed permissions     | Review users/services/verifications/settings. Do not use factory reset except in disposable local DB.                | Permissions match role; audit logs appear; read-only role stays unchanged.                             | MH-F-003 factory reset callable, MH-F-004 role change accepted, settings save unexpected.       |
| 16    | Arabic smoke test                    | Any role                                | Switch to Arabic, repeat auth, onboarding summary, app nav, wallet/settings key pages.                               | RTL/text renders, no mojibake, labels fit.                                                             | English-only critical steps, corrupted text, clipped buttons.                                   |
| 17    | Mobile smoke test                    | Any role                                | Test on iPhone/Android widths: auth, OTP, onboarding, app nav, create need, chat, admin if in scope.                 | No horizontal scroll, buttons visible, modals usable, forms submit.                                    | Hidden submit buttons, overlapping text, unusable modals, broken nav.                           |
| 18    | Logs after testing                   | Admin/developer                         | Check Render logs and Sentry after the full pass.                                                                    | No repeated 500s, provider failures, unhandled rejections, or migration errors.                        | Auth refresh loops, upload errors, Resend/Didit/NOWPayments failures, DB constraint errors.     |

## External Tester Script

Give testers only the flows that are intentionally in scope. Exclude wallet, KYC, admin, or payments unless those are configured for safe testing.

Tester instructions:

1. Create a new account with the role you were assigned.
2. Verify your email using the code you receive.
3. Complete onboarding until the app lets you continue.
4. Try the assigned task:
   - Customer: create a need/project and contact/respond to a provider.
   - Expert/craftsman/business: complete profile, browse work, submit a bid/response, create a service if assigned.
   - Admin tester only: review pending items and settings assigned in the checklist. Do not use factory reset.
5. Use chat and attachments only in the flow where the app naturally offers them.
6. Switch to Arabic once and repeat one short task.
7. Repeat one short task on mobile.

Ask testers to report:

- What confused them.
- What broke.
- What looked unfinished.
- What was slow.
- Screenshots or screen recordings.
- Browser and device used.
- Expected result vs actual result.
- Account role and approximate time of failure.

## Final Recommendation

Fix P0 first, then self-test.

Top 5 fixes:

1. Persist `avatarUrl` to `users.avatar_url` and verify expert/craftsman onboarding after refresh.
2. Make auth/verified middleware use effective verification status, not stale/raw token status.
3. Server-gate or disable admin factory reset before any admin tester touches production/staging data.
4. Reject admin `primaryRole` updates at the API until full role migration exists.
5. Clean the `format:check` failures before relying on CI as a release gate.

Exact manual self-test order:

1. Signup with fresh email.
2. OTP verification.
3. Login.
4. Refresh page while logged in.
5. Logout.
6. Forgot password/reset password.
7. Customer onboarding.
8. Expert/craftsman/business onboarding.
9. Create need/project.
10. Provider bid/respond flow.
11. Service booking/reservation flow.
12. Chat/attachment flow.
13. Verification/KYC flow if enabled.
14. Wallet/deposit/withdrawal flow if enabled.
15. Admin review/settings flow.
16. Arabic smoke test.
17. Mobile smoke test.
18. Check Render logs/Sentry after testing.

Should you send to external testers after self-testing: no, not until the P0 is fixed and the P1 admin/auth risks are either fixed or explicitly removed from tester scope.
