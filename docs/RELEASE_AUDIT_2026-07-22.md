# MohandisHub final pre-production release audit

Audit date: 2026-07-22

Repository: `D:\MohandisHub`

Baseline: `3ab7776` (`origin/main`)

Audit branch: `codex/release-audit-20260722`

Audited head before this report: `b659b22`

## 1. Executive summary

**Overall status:** the audited branch is suitable for controlled external self-testing, but it is not approved for an official public launch.

**Finding count:** P0: **0**; P1: **17** (all fixed and regression-tested on this branch); P2: **24** (13 fixed, 11 unresolved or needing a product/operations decision); P3: **1** (fixed).

The highest-risk areas were authorization and verification trust boundaries, escrow and commission conservation, asynchronous payment/provider failure handling, upload ownership, and production configuration. The branch now fixes the verified launch blockers, including several defects found only during the final calculation cross-check: custom dispute settlements could destroy or mint escrow value, funded commission terms could change before settlement, and a provider-funded coupon could produce a negative reservation price.

The application is **safe for external self-testing** only with advertisements and live payment flags disabled, test accounts, no production data, and the production environment checks satisfied. It is **not safe for official public launch** until hosted Supabase migrations/RLS and provider configuration are verified, the four skipped money E2E journeys are exercised in approved sandboxes, and the concrete unresolved P2 items below are dispositioned.

**Launch verdict: `APPROVED_FOR_EXTERNAL_TESTING`**

## 2. Architecture understood

MohandisHub is an npm-workspace monorepo:

- `apps/web` is a Next.js 15 App Router application deployed to Vercel. It serves Arabic and English UI, manages client auth state, and proxies private-upload reads to the API.
- `apps/api` is an Express/Socket.IO API deployed to Render. It issues short-lived JWT access tokens and opaque, hashed, rotating refresh tokens; reloads account/admin state from PostgreSQL; owns authorization, business logic, external-provider calls, and asynchronous lifecycle workers.
- `packages/shared` contains shared contracts and monetary/business helpers used by both applications.
- `apps/e2e` contains Playwright browser journeys.
- `supabase/migrations` defines PostgreSQL tables, constraints, functions, RLS/storage policy, audit records, wallet/escrow structures, and feature evolution. The API normally accesses PostgreSQL through `pg`; Supabase service-role access is separately used for object storage.

The principal trust boundaries are browser-to-API bearer/cookie auth, API-to-PostgreSQL, API-to-Supabase Storage, signed provider webhooks, and outbound calls to Resend, Didit, Agora, NOWPayments, and Paymob. Stripe code is an unused stub and has no reachable charging path. Reservation, job, need, coupon, deposit, and withdrawal money movements are server-owned; the client supplies requests, never authoritative totals.

Background/asynchronous work includes Socket.IO chat/call state, reservation lifecycle sweeps, retention sweeps, notification/email delivery, payment webhooks, and identity-verification webhooks. Vercel and Render configuration are fail-closed for production API/TLS/CORS requirements on this branch.

## 3. Findings

### RA-001 — Admin-controlled primary-role escalation

**Severity:** P1. **Status:** fixed. **Category:** authorization / mass assignment.

**User impact:** an administrator-controlled payload could previously attempt to change the account's primary role, violating the fixed-role auth model.

**Reproduction:** submit `primaryRole: "business"` through generic admin user update or the dedicated role endpoint.

**Root cause:** the admin DTO/service boundary admitted a role-changing field/path.

**Evidence:** `apps/api/src/modules/admin/admin.validation.ts:22-29`; `apps/api/src/modules/admin/admin.service.ts:176-237`.

**Fix made:** `primaryRole` is rejected by validation and the service; the dedicated role-change service fails closed.

**Tests:** `apps/api/src/tests/admin-release-blockers.test.ts:12-30`; full API suite passed.

**Remaining risk:** none in the audited admin paths.

### RA-002 — Delegated administrators could mutate higher-privilege/system accounts

**Severity:** P1. **Status:** fixed. **Category:** privilege escalation.

**User impact:** a scoped `manage_users` administrator could deactivate, delete, change email, or revoke sessions for a super-admin/platform account.

**Reproduction:** call a guarded user mutation as a non-super delegated admin against an admin or platform UUID.

**Root cause:** controller permissions protected the operation type but not the target-account hierarchy.

**Evidence:** `apps/api/src/modules/admin/admin.service.ts:83-119`; `apps/api/src/modules/admin/admin.controller.ts:144-169,287-459`.

**Fix made:** all material mutations call a target hierarchy guard; generic mutation of the platform account is prohibited and admin targets require `super_admin`.

**Tests:** `apps/api/src/tests/admin-release-blockers.test.ts:49-82`.

**Remaining risk:** direct database operations remain outside application controls and require operational access governance.

### RA-003 — Verification evidence ownership and approved-record integrity

**Severity:** P1. **Status:** fixed. **Category:** IDOR / data integrity.

**User impact:** a user could reference another user's private upload as identity/academic evidence or replace evidence after approval.

**Reproduction:** submit a valid private-upload URL owned by another user, or update an approved academic row.

**Root cause:** evidence URLs and approved-row state were not consistently checked at both service and repository boundaries.

**Evidence:** `apps/api/src/modules/profiles/profiles.service.ts:59-74,510-551,637-706`; `apps/api/src/modules/profiles/profiles.repository.ts:404-469`.

**Fix made:** all evidence must resolve to a private upload owned by the actor; approved academic records are immutable.

**Tests:** `profiles-document-security.test.ts:15-76`, `verification-security.test.ts`, and `verification.repository.test.ts`.

**Remaining risk:** webhook/profile updates still have the separate atomicity risk in RA-037.

### RA-004 — Didit webhook identity, replay, and state-transition trust

**Severity:** P1. **Status:** fixed. **Category:** authentication / webhook security.

**User impact:** untrusted payload identity, stale signed bodies, duplicate/conflicting terminal events, or rejection handling could corrupt verification state.

**Reproduction:** pair an old signed body with a fresh header timestamp, replay a terminal event, or supply a payload identity different from the stored session owner.

**Root cause:** provider payload fields and non-atomic status transitions were over-trusted.

**Evidence:** `apps/api/src/modules/verification/verification.provider.ts:156-290`; `verification.service.ts:197-285`; `verification.repository.ts:132-193`.

**Fix made:** the stored session owns identity; timestamp/body freshness is strict; terminal transitions are conditional; rejection clears identity flags; provider response bodies are sanitized.

**Tests:** `verification-security.test.ts:12-138` and `verification.repository.test.ts:11-45`.

**Remaining risk:** profile writes after the terminal request transition are not one transaction; see RA-037.

### RA-005 — Password-reset token reuse race

**Severity:** P1. **Status:** fixed. **Category:** authentication / concurrency.

**User impact:** two concurrent reset submissions could consume the same token and race password updates.

**Reproduction:** submit the same valid reset token concurrently before either request marks it used.

**Root cause:** token validation, password update, and token consumption were separate operations.

**Evidence:** `apps/api/src/modules/auth/auth.repository.ts:428-469`; `auth.service.ts:331-344`.

**Fix made:** one conditional repository operation updates the password and consumes the token atomically; failures return a generic invalid/expired response.

**Tests:** `auth.repository.test.ts:61-83` and `auth.service.test.ts:44-151`.

**Remaining risk:** none found in the reset-token path.

### RA-006 — Cross-user public-media deletion

**Severity:** P1. **Status:** fixed. **Category:** IDOR / destructive storage action.

**User impact:** an arbitrary referenced public URL could cause a service-role physical delete of another user's object.

**Reproduction:** place another object's public URL in a mutable reference, then trigger moderation/retention cleanup.

**Root cause:** storage deletion was inferred from URL shape without a durable ownership record.

**Evidence:** `apps/api/src/modules/moderation/moderation.service.ts:10-96`; `retention.service.ts:160-211`.

**Fix made:** moderation and public-reference retention now clear database references without performing unowned physical deletes.

**Tests:** `public-media-deletion-safety.test.ts:5-19`.

**Remaining risk:** conservative deletion can orphan public objects; RA-036 tracks the required ownership/cleanup design.

### RA-007 — OTP replacement invalidated a still-valid delivered code

**Severity:** P1. **Status:** fixed. **Category:** authentication reliability / secret handling.

**User impact:** a failed resend could destroy the last usable OTP and charge delivery quota; console SMS could expose an OTP in production logs.

**Reproduction:** request a replacement while the provider fails, then try the previously delivered code.

**Root cause:** older codes/quota were updated before successful delivery.

**Evidence:** `apps/api/src/modules/otp/otp.service.ts:32-125`; `otp.repository.ts:72-92`; `otp.provider.ts:90-282`.

**Fix made:** the candidate is created and delivered first; failure expires only the candidate, success then retires older codes and charges quota; console SMS is rejected in production.

**Tests:** `otp.service.test.ts:24-76` and `provider-log-redaction.test.ts`.

**Remaining risk:** launch still requires a configured real SMS provider if phone OTP is part of scope.

### RA-008 — Retention webhook SSRF

**Severity:** P1. **Status:** fixed. **Category:** SSRF.

**User impact:** a stored arbitrary webhook URL could make the worker access internal/cloud metadata destinations.

**Reproduction:** configure `http://169.254.169.254/...` as the retention alert destination and run the sweep.

**Root cause:** an administrator-controlled URL was fetched without a destination allowlist.

**Evidence:** `apps/api/src/modules/retention/retention.admin.validation.ts:15-22`; `retention.alerts.ts:6-37`.

**Fix made:** arbitrary destinations are no longer accepted or fetched; legacy non-empty values are ignored with a safe warning.

**Tests:** `retention-alert-security.test.ts:9-39`.

**Remaining risk:** outbound retention webhooks remain unavailable until an approved allowlist design exists.

### RA-009 — Unbounded in-memory upload pressure

**Severity:** P1. **Status:** fixed. **Category:** availability / resource exhaustion.

**User impact:** concurrent large multipart uploads could exhaust API memory or allow account-level request abuse.

**Reproduction:** open many simultaneous uploads at the previous configurable size.

**Root cause:** memory-backed Supabase upload handling lacked concurrency/account throttles and a hard production ceiling.

**Evidence:** `apps/api/src/modules/upload/upload.routes.ts:45-67,105-236`; `middleware/rate-limit.ts:85-91`.

**Fix made:** default/ceiling is 15 MB, at most two in-memory uploads are active, and uploads are limited to ten per account per hour.

**Tests:** `upload-abuse-hardening.test.ts:9-29`.

**Remaining risk:** MIME content is still declaration-based; see RA-035.

### RA-010 — Daily withdrawal limit race

**Severity:** P1. **Status:** fixed. **Category:** financial concurrency.

**User impact:** parallel withdrawals could each pass a pre-transaction daily total and exceed the configured cap.

**Reproduction:** issue two withdrawals that individually fit but jointly exceed the cap.

**Root cause:** the aggregate was read before the wallet-locked transaction.

**Evidence:** `apps/api/src/modules/wallet/wallet.service.ts:836-1078`; `wallet.repository.ts:1230-1305`.

**Fix made:** the daily aggregate is recalculated after the wallet lock and before insertion in the same transaction.

**Tests:** `withdrawal-limit-atomicity.test.ts:8-26`.

**Remaining risk:** no live-PostgreSQL concurrency test was available locally; the day boundary is UTC (RA-042).

### RA-011 — Monetary precision and duplicated commission arithmetic

**Severity:** P1. **Status:** fixed. **Category:** financial correctness.

**User impact:** floating-point commission/application splits and over-precision wallet inputs could lose cents, produce negative payouts, or fail as database 500s.

**Reproduction:** use 1 EGP at 2.5%, an amount with three decimals, or `NUMERIC(12,2)` overflow.

**Root cause:** several paths duplicated percentage arithmetic and accepted raw numbers.

**Evidence:** `packages/shared/src/wallet.ts:198-225`; `apps/api/src/modules/wallet/wallet.amount.ts:1-17`; `jobs.service.ts:185-279`; `wallet.controller.ts:36-344`.

**Fix made:** one integer-piastre commission helper owns rounding and remainder; wallet HTTP paths enforce positive, two-decimal, bounded EGP values; job application splits reuse the helper.

**Tests:** `packages/shared/src/wallet.test.ts:5-63`, `wallet.amount.test.ts:7-36`, and `jobs.service.test.ts:149-234`.

**Remaining risk:** some lower-risk plan/service/negotiation price schemas still rely on database rounding and should be standardized before public launch.

### RA-012 — Coupon-funded reservation totals could overcharge or become negative

**Severity:** P1. **Status:** fixed. **Category:** pricing / financial correctness.

**User impact:** embedded commission was added back after discount, increasing customer price; a provider-funded `both` coupon could exceed subtotal and create a negative reservation price.

**Reproduction:** subtotal 100, commission 10, provider-funded fixed coupon 110 targeting both previously returned `finalAmount = -10`; a 5 EGP service coupon previously risked an incorrect total.

**Root cause:** the commission is carved from the subtotal at payout but was treated as additive/eligible twice in preview.

**Evidence:** `apps/api/src/modules/coupons/coupons.service.ts:281-337`; `reservations.service.ts:653-731`.

**Fix made:** final customer amount is subtotal minus discount, discount is capped at subtotal, and platform-funded discount cannot exceed available commission.

**Tests:** `product-value.logic.test.ts:57-153`.

**Remaining risk:** coupon activation remains disabled with ads; complex coupon/provider accounting still needs sandbox E2E.

### RA-013 — Custom dispute settlement failed to conserve escrow

**Severity:** P1. **Status:** fixed. **Category:** escrow / financial integrity.

**User impact:** a 100 EGP hold split as 40/40 captured 100 but credited 80 (destroying 20); the prior tolerance could also allocate 100.01.

**Reproduction:** resolve a held reservation with a partial allocation or fractional-piastre values.

**Root cause:** only over-allocation above `hold + 0.01` was rejected, and derived reservation totals—not the actual locked hold—were authoritative.

**Evidence:** `apps/api/src/modules/reservations/reservations.money.ts:1-50`; `reservations.service.ts:3810-4004`.

**Fix made:** positive partial amounts must have at most two decimals and sum exactly to the actual wallet hold in integer piastres; full refund/release use their explicit outcomes; event metadata records gross release, net provider payout, and commission.

**Tests:** `reservations.money.test.ts:5-47` and `phase4-marketplace-money.test.ts:32-46`.

**Remaining risk:** fee/coupon allocation within a genuinely partial dispute requires an explicit policy decision (RA-042).

### RA-014 — Funded commission terms changed before settlement

**Severity:** P1. **Status:** fixed. **Category:** financial contract integrity.

**User impact:** changing global commission settings after funding could change the provider/platform split at milestone or reservation settlement.

**Reproduction:** fund at 10%, change settings to 90%, then approve/release.

**Root cause:** milestone settlement recomputed despite stored values; reservation funding did not snapshot percent/minimum.

**Evidence:** `apps/api/src/modules/jobs/jobs.service.ts:696-775,875-1008`; `reservations.service.ts:653-731,4016-4091`; `reservations.money.ts:52-104`.

**Fix made:** milestone settlement consumes and cent-validates stored amounts; reservations snapshot commission percent/minimum in the policy JSON and payout prefers that snapshot.

**Tests:** `jobs.service.test.ts:425-548` deliberately changes approval-time settings; `reservations.money.test.ts:42-86` verifies snapshot precedence and conservation.

**Remaining risk:** pre-patch funded reservations lack snapshot fields and use the current-settings compatibility fallback; inventory/reconciliation is required before public launch (RA-042).

### RA-015 — Verification revocation remained valid until JWT expiry

**Severity:** P1. **Status:** fixed. **Category:** authorization freshness.

**User impact:** a revoked expert/business/craftsman could keep using verification-gated routes until the access token expired.

**Reproduction:** issue a verified JWT, revoke profile verification in the database, then call a `requireVerified` route.

**Root cause:** authentication refreshed account/admin/email state but retained `verified` from the JWT.

**Evidence:** `apps/api/src/middleware/authenticate.ts:68-123`; `require-verified.ts:30-45`.

**Fix made:** authentication joins the current role profile and reloads `verification_status` on every authenticated request.

**Tests:** `phase2-money-controls.test.ts:205-237` plus full API tests/type checks.

**Remaining risk:** effective image completeness and terminal webhook atomicity remain separate concerns.

### RA-016 — Production database/CORS/API targets could fail open

**Severity:** P1. **Status:** fixed. **Category:** deployment security / availability.

**User impact:** production could start with an unencrypted database URL, loopback/insecure CORS origin, or unsafe/missing Next API rewrite target.

**Reproduction:** parse production env with `sslmode=disable`, HTTP/loopback CORS, or a non-public API target.

**Root cause:** environment validation checked syntax/config presence but not secure production semantics.

**Evidence:** `apps/api/src/config/env.ts:203-283`; `apps/web/next.config.ts:4-31`; `render.yaml`.

**Fix made:** production requires a TLS PostgreSQL URL, explicit HTTPS public origins including `WEB_PUBLIC_URL`, and a public HTTPS API target.

**Tests:** `env-production.test.ts` and `apps/web/tests/env.test.ts`.

**Remaining risk:** `sslmode=require` encrypts but does not authenticate the server certificate; hosted configuration should prefer `verify-full` with the Supabase CA.

### RA-017 — Critical/high dependency advisories

**Severity:** P1. **Status:** fixed. **Category:** supply-chain security.

**User impact:** the baseline dependency graph contained two critical and eleven high advisories (nine high in production).

**Reproduction:** run baseline `npm audit` / `npm audit --omit=dev`.

**Root cause:** transitive HTTP/multipart/WebSocket/image packages were behind safe patched versions.

**Evidence:** `package-lock.json`; root `overrides` in `package.json:37-40`.

**Fix made:** safe non-breaking audit updates plus `sharp` 0.35.3 override; full builds and browser tests passed.

**Tests:** final audits show no high/critical; production and Vercel/Render-equivalent builds passed.

**Remaining risk:** 19 moderate production advisories require a breaking Sentry/OpenTelemetry upgrade (RA-040).

### RA-018 — Hidden reviews remained in displayed aggregates

**Severity:** P2. **Status:** fixed. **Category:** ratings.

**User impact:** moderated reviews could continue affecting rating/count.

**Reproduction:** hide a review and query average/count.

**Root cause:** aggregate queries did not consistently apply the hidden predicate.

**Evidence:** `apps/api/src/modules/reviews/reviews.repository.ts:57-79,115-138`.

**Fix made:** both count and average exclude hidden rows.

**Tests:** `reviews.repository.test.ts:11-29`.

**Remaining risk:** cached service aggregates remain stale (RA-032).

### RA-019 — Conversion ratio displayed as a raw number

**Severity:** P2. **Status:** fixed. **Category:** analytics display.

**User impact:** a 0.25 conversion ratio was shown as 0.3% instead of 25.0%.

**Reproduction:** render dashboard conversion with `rate=0.25`.

**Root cause:** UI appended `%` without multiplying the ratio.

**Evidence:** `apps/web/lib/analytics/format.ts:1-4`; `expert-dashboard.tsx`.

**Fix made:** a bounded formatter converts ratios to percentages and handles invalid values.

**Tests:** `analytics-format.test.ts:5-18`.

**Remaining risk:** backend numerator/denominator semantics are unresolved (RA-038).

### RA-020 — Impossible calendar dates passed registration validation

**Severity:** P2. **Status:** fixed. **Category:** input validation / dates.

**User impact:** dates such as 2025-02-31 could satisfy format/age checks and later normalize inconsistently.

**Reproduction:** register with an impossible but formatted date.

**Root cause:** format and age were checked without round-trip calendar validity.

**Evidence:** `apps/api/src/modules/auth/auth.validation.ts:7-23,55-63`; `apps/web/components/auth/auth-form.tsx:70-90`.

**Fix made:** API and web validate real calendar dates, including leap-year boundaries.

**Tests:** `auth.validation.test.ts` and `release-audit-ui.test.ts`.

**Remaining risk:** other date-range semantics are listed in RA-042.

### RA-021 — Provider response bodies leaked through errors/logs

**Severity:** P2. **Status:** fixed. **Category:** sensitive information exposure.

**User impact:** third-party response bodies can contain internal/provider data and were exposed on failures.

**Reproduction:** return an error body from OTP/Didit/transactional email providers.

**Root cause:** raw body text was included in error messages/log metadata.

**Evidence:** `verification.provider.ts:125-146`; `otp.provider.ts:90-282`; `utils/resend-email.ts`; `utils/send-transactional-email.ts`.

**Fix made:** logs retain status/category only; client errors are generic.

**Tests:** `provider-log-redaction.test.ts`.

**Remaining risk:** provider observability must rely on request IDs/status codes, not bodies.

### RA-022 — Legacy seeded user/debug surfaces

**Severity:** P2. **Status:** fixed. **Category:** sensitive endpoint exposure.

**User impact:** legacy seeded-user routes could expose non-production behavior; notification demo behavior needed a production guard.

**Reproduction:** request the removed legacy `/api/users` seeded paths or production notification demo.

**Root cause:** development-era routes remained mounted.

**Evidence:** `apps/api/src/modules/users/users.routes.ts:8-26`; `notifications.controller.ts:165-182`.

**Fix made:** legacy routes were removed and production demo returns 404.

**Tests:** `users.test.ts` and launch-surface tests.

**Remaining risk:** none found among mounted routes after repository-wide route inspection.

### RA-023 — Missing anti-framing policy

**Severity:** P2. **Status:** fixed. **Category:** clickjacking.

**User impact:** the application could be embedded in a hostile frame to trick users.

**Reproduction:** frame a route from another origin.

**Root cause:** no explicit `frame-ancestors`/legacy header.

**Evidence:** `apps/web/next.config.ts:80-94`.

**Fix made:** `frame-ancestors 'none'` and `X-Frame-Options: DENY`.

**Tests:** `security-headers.test.ts`.

**Remaining risk:** none for framing; CSP can be expanded separately only with tested requirements.

### RA-024 — Unfinished advertising journey was reachable

**Severity:** P2. **Status:** fixed. **Category:** incomplete feature / launch scope.

**User impact:** users could enter an unfinished route with missing dynamic CTA destinations.

**Reproduction:** navigate to advertisements or enable server controls under baseline behavior.

**Root cause:** UI/API visibility was not tied to a hard launch feature flag.

**Evidence:** `advertisements.service.ts:24-34,242-255`; `apps/web/lib/advertisements/feature.ts:1`; `render.yaml:102-104`.

**Fix made:** API and web ads default off; lists return empty; sidebar/slideshow/page/admin entry points fail closed. `/app/browse` redirects to services at `apps/web/app/[locale]/app/browse/page.tsx:12`.

**Tests:** `advertisement-launch-gate.test.ts` and `advertisement-feature.test.ts`.

**Remaining risk:** enabling ads is still blocked by RA-041.

### RA-025 — Factory-reset UI exposed to scoped admins

**Severity:** P2. **Status:** fixed. **Category:** authorization UX / destructive action.

**User impact:** a scoped admin saw a destructive control they could not use, increasing social-engineering/confusion risk.

**Reproduction:** open admin settings without `super_admin`.

**Root cause:** UI checked generic admin access instead of the exact permission.

**Evidence:** `apps/web/components/admin/admin-panel.tsx:275-286`; `admin-settings-tab.tsx:987-1021`.

**Fix made:** factory reset is rendered only for `super_admin`. API still requires `super_admin`, exact strict `{confirm:"FACTORY RESET"}`, and production `ALLOW_FACTORY_RESET=true` (`admin.routes.ts:48-52`, `admin.validation.ts:34-38`, `admin.controller.ts:879-890`).

**Tests:** `admin-release-blockers.test.ts` and `release-audit-ui.test.ts`.

**Remaining risk:** production opt-in must remain unset unless an approved incident procedure requires it.

### RA-026 — Shared-package lint was not an enforced root/CI gate

**Severity:** P2. **Status:** fixed. **Category:** quality gate.

**User impact:** shared money/auth code could bypass lint even while root lint passed.

**Reproduction:** introduce a shared lint error and run the previous root `npm run lint`.

**Root cause:** root script invoked only API and web; ESLint project service also excluded shared tests.

**Evidence:** `package.json:21`; `eslint.config.mjs:20-48`.

**Fix made:** shared test files are part of ESLint's project service and root/CI lint runs shared, API, and web.

**Tests:** final `npm run lint` passed all three workspaces with zero warnings.

**Remaining risk:** `react-hooks/rules-of-hooks` is enforced; `react-hooks/exhaustive-deps` is not explicitly enabled.

### RA-027 — Public verification badge used the wrong source of truth

**Severity:** P2. **Status:** fixed. **Category:** trust indicator / derived value.

**User impact:** identity-verified users with no qualifying deposits could publicly display the profile-plus-1000-EGP badge; earned badges could disappear inconsistently.

**Reproduction:** public profile with `verification_status='verified'` and `platform_verified_at=NULL`.

**Root cause:** private and public profile methods used different definitions.

**Evidence:** `apps/api/src/modules/profiles/profiles.service.ts:78-114,179-217,360-396,1075-1193`.

**Fix made:** earning still requires profile completeness plus completed deposits >=1000 EGP; `users.platform_verified_at` is the durable source for all public/private responses.

**Tests:** `profiles-badge-source.test.ts:36-66`.

**Remaining risk:** badge earning is currently evaluated when profile reads occur, not by a database trigger/event worker.

### RA-028 — Privileged money writes and deposit ranges lacked database-precision invariants

**Severity:** P2. **Status:** fixed. **Category:** financial validation / configuration.

**User impact:** admin adjustments/manual credits could admit fractional piastres/overflow, and `maxDeposit < minDeposit` could make every deposit fail.

**Reproduction:** adjust 0.001 EGP or configure minimum 100 / maximum 10.

**Root cause:** privileged schemas used only `positive()` and settings wrote independent partial values.

**Evidence:** `admin.validation.ts:119-135,187-198,240-244`; `settings.service.ts:142-177`.

**Fix made:** privileged amounts reuse EGP precision rules; partial/full deposit-range updates are validated against the resulting pair.

**Tests:** `admin-release-blockers.test.ts` and `settings.service.test.ts`.

**Remaining risk:** existing hosted settings could not be inspected locally.

### RA-029 — Private-upload IDs appeared in generic request logs

**Severity:** P2. **Status:** fixed. **Category:** sensitive logging.

**User impact:** every `/api/upload/private/:id` read logged the private object UUID even though the proxy itself had no debug logs.

**Reproduction:** read a private upload and inspect generic request metadata.

**Root cause:** request logging stored `req.path` verbatim.

**Evidence:** `apps/api/src/middleware/request-logging.ts:5-28`.

**Fix made:** private-upload path identifiers are replaced with `:id` before logging.

**Tests:** `request-logging.test.ts:5-17`; source scan found no private-upload debug logging.

**Remaining risk:** authenticated request logs intentionally contain an opaque actor ID for audit correlation.

### RA-030 — Awarded-bid commission ignored configured receiver

**Severity:** P2. **Status:** fixed. **Category:** financial routing.

**User impact:** need/bid commissions could be credited to the platform UUID while other rails used the configured commission receiver.

**Reproduction:** set a non-default receiver and pay an awarded bid.

**Root cause:** percentage settings were read, but wallet routing remained hard-coded.

**Evidence:** `apps/api/src/modules/needs/needs.service.ts:583-651`.

**Fix made:** bid settlement consistently uses `commissionReceiverId`; need/bid amounts also reject fractional piastres.

**Tests:** `needs.service.test.ts:148-212`.

**Remaining risk:** whether receiver changes should affect already-funded jobs/reservations is an accounting policy decision.

### RA-031 — Arabic/a11y release polish

**Severity:** P3. **Status:** fixed. **Category:** localization / accessibility.

**User impact:** InstaPay fallback labels could appear in English; toasts/location controls lacked complete assistive semantics.

**Reproduction:** open Arabic deposit/chat and trigger a toast.

**Root cause:** missing dictionary keys and ARIA/RTL metadata.

**Evidence:** `apps/web/lib/i18n/dictionaries/ar.ts:1362-1363`; `toast.tsx:32-33`; `chat-screen.tsx:631-676`.

**Fix made:** localized labels, live-region toast semantics/RTL handling, and location-button accessible name.

**Tests:** `release-audit-ui.test.ts`; `npm run validate:i18n` passed; mojibake scan found no corrupted Arabic fallback text.

**Remaining risk:** full assistive-technology/manual Arabic QA remains advisable.

### RA-032 — Cached service rating/order aggregates have no updater

**Severity:** P2. **Status:** unresolved. **Category:** data integrity / ranking.

**User impact:** catalog filtering/ranking can disagree with live reviews/completed reservations.

**Reproduction:** add/hide a review or complete an order, then sort by rating/orders.

**Root cause:** `services.avg_rating` and `order_count` are read widely, but no trigger/updater was found; only views increment.

**Evidence:** `supabase/migrations/20240101000009_services.sql:69-71`; `services.repository.ts:128-230`.

**Fix made:** none; a query/trigger/materialized-aggregate strategy changes database behavior and needs approval.

**Tests:** repository-wide updater/trigger search; live review aggregates themselves are covered.

**Remaining risk:** stale ranking and misleading counts until resolved.

### RA-033 — Pagination accepts negative/invalid values

**Severity:** P2. **Status:** unresolved. **Category:** API reliability.

**User impact:** negative page/limit or `NaN` can produce negative offsets, database errors, or inconsistent response metadata.

**Reproduction:** request `?page=-2&limit=-5` or nonnumeric values on affected controllers.

**Root cause:** ad hoc `parseInt(...) || default` and upper-bound-only `Math.min`.

**Evidence:** `needs.controller.ts:79-87,133-134`; `services.controller.ts:44-58,106-107`; `reviews.controller.ts:59-60`; `users.controller.ts:126-127`.

**Fix made:** none; should be centralized without changing existing response contracts.

**Tests:** static route/controller audit.

**Remaining risk:** malformed pagination can remain a low-cost availability/error-noise vector.

### RA-034 — External checkout succeeds before local persistence

**Severity:** P2. **Status:** unresolved. **Category:** idempotency / partial failure.

**User impact:** provider invoice creation followed by a database failure can orphan an invoice the application cannot reconcile; timestamp IDs can collide.

**Reproduction:** make provider invoice creation succeed, then fail `createDepositRequest`.

**Root cause:** provider-first ordering and `Date.now()` order identifiers.

**Evidence:** `apps/api/src/modules/wallet/wallet.service.ts:236-365,400-438`.

**Fix made:** none; a durable outbox/idempotency-key design requires contract/provider coordination.

**Tests:** provider client/unit tests cover responses, not this cross-system failure.

**Remaining risk:** orphaned provider sessions and manual reconciliation.

### RA-035 — Upload MIME validation trusts the multipart declaration

**Severity:** P2. **Status:** unresolved. **Category:** file upload security.

**User impact:** a file with spoofed `Content-Type` can pass extension/MIME allowlists.

**Reproduction:** upload non-image bytes declared as an allowed image MIME.

**Root cause:** checks use `req.file.mimetype` without magic-byte/content decoding.

**Evidence:** `apps/api/src/modules/upload/upload.routes.ts:45-54,110-178,226-253`.

**Fix made:** size/rate/concurrency hardening was implemented; content sniffing was not added during release hardening.

**Tests:** `upload-abuse-hardening.test.ts` covers bounds, not content.

**Remaining risk:** stored content spoofing; keep downloads non-executable and add a vetted detector before public launch.

### RA-036 — Storage deletion and database cleanup are not atomic

**Severity:** P2. **Status:** unresolved. **Category:** data lifecycle / partial failure.

**User impact:** private cleanup can delete one side but fail the other; conservative public cleanup leaves orphaned objects/direct URLs.

**Reproduction:** force Supabase deletion failure during a retention batch or clear a public reference.

**Root cause:** PostgreSQL and object storage have no shared transaction/outbox, and public objects lack durable ownership metadata.

**Evidence:** `apps/api/src/modules/retention/retention.service.ts:21-51,195-245`; `moderation.service.ts:10-96`.

**Fix made:** the cross-user destructive path was removed (RA-006); no unsafe compensating delete was introduced.

**Tests:** public-media and retention security tests.

**Remaining risk:** orphaned objects/metadata and manual cleanup until an ownership-backed reconciliation worker exists.

### RA-037 — Didit terminal transition and profile updates are not one transaction

**Severity:** P2. **Status:** unresolved. **Category:** webhook reliability / partial failure.

**User impact:** if the request becomes terminal and a later profile update fails, a retry can be ignored as duplicate, leaving inconsistent verification state.

**Reproduction:** fail the database after `transitionStatus` but before `markIdentityApproved`/profile status write.

**Root cause:** repository methods use separate transactions/connections.

**Evidence:** `apps/api/src/modules/verification/verification.service.ts:217-262`; `verification.repository.ts:132-193`.

**Fix made:** transitions are race-safe and duplicates fail closed, but end-to-end transactional application was not implemented.

**Tests:** transition/replay tests; no injected database partial-failure integration test.

**Remaining risk:** manual reconciliation for rare partial failures; schema/repository transaction design needs approval.

### RA-038 — Provider/admin financial analytics mix incompatible quantities

**Severity:** P2. **Status:** unresolved. **Category:** analytics / business semantics.

**User impact:** earnings can include returned holds, conversion mixes lifetime views with range reservations/all statuses, payout forecast counts provider-owned outgoing holds, and admin “revenue” is deposits.

**Reproduction:** fail/release a withdrawal hold and observe earnings; compare a 30-day conversion numerator to lifetime views.

**Root cause:** ledger types and time/status dimensions are aggregated without an authoritative metric definition.

**Evidence:** `analytics.repository.ts:27-74,119-147`; `analytics.service.ts:60-78`; `admin.repository.ts:36-54`; `admin.service.ts:123-143`.

**Fix made:** only ratio rendering was corrected (RA-019); formulas were not guessed.

**Tests:** formatter tests; no semantic ledger fixture suite.

**Remaining risk:** misleading business dashboards until product/accounting definitions are approved.

### RA-039 — External calls lack bounded timeouts; FX has a hard-coded fallback

**Severity:** P2. **Status:** unresolved. **Category:** external integration reliability / pricing.

**User impact:** hung provider calls can tie up requests; a failed FX lookup can use 48.5 EGP/USD regardless of market conditions.

**Reproduction:** stall NOWPayments/Paymob/FX endpoints or make both FX providers fail.

**Root cause:** raw `fetch` calls lack `AbortSignal.timeout`; fallback is a literal.

**Evidence:** `wallet-fx.service.ts:14-50,172-204`; `lib/nowpayments.client.ts:156-288`; `lib/paymob.client.ts:114-270`.

**Fix made:** none; changing financial fallback behavior needs an operations/product decision.

**Tests:** client response tests exist, but timeout/fallback tests are incomplete.

**Remaining risk:** latency exhaustion and stale conversion quotes.

### RA-040 — Moderate dependency advisories remain

**Severity:** P2. **Status:** unresolved. **Category:** supply chain.

**User impact:** OpenTelemetry baggage parsing can allocate unbounded memory; Windows dev-server esbuild has a low-severity arbitrary-read advisory.

**Reproduction:** final `npm audit --omit=dev` / `npm audit`.

**Root cause:** production fix requires a breaking `@sentry/node` 8 to 10 upgrade; dev fix was not selected by the safe audit update.

**Evidence:** `package-lock.json`; npm advisory `GHSA-8988-4f7v-96qf` and `GHSA-g7r4-m6w7-qqqr`.

**Fix made:** all safe non-breaking high/critical fixes were applied.

**Tests:** final audit: 19 moderate production; full graph: 19 moderate + 1 low; zero high/critical.

**Remaining risk:** plan and test the Sentry major upgrade before public launch.

### RA-041 — Advertising cannot safely be enabled yet

**Severity:** P2. **Status:** needs decision. **Category:** incomplete feature.

**User impact:** explicitly enabling ads would surface CTA paths for absent dynamic destinations and incomplete money/click-integrity journeys.

**Reproduction:** set both advertisement flags true and use slideshow/management CTAs.

**Root cause:** launch gating was completed before the full dynamic route/contracts.

**Evidence:** `apps/web/components/app/ad-slideshow.tsx`; advertisement page/client files; `render.yaml:102-104`.

**Fix made:** feature remains fail-closed by default.

**Tests:** launch-gate tests prove disabled behavior.

**Remaining risk:** keep `ADVERTISEMENTS_ENABLED=false` and `NEXT_PUBLIC_ENABLE_ADS=false` until a separate activation review.

### RA-042 — Legacy reservation snapshots and time/range semantics need policy decisions

**Severity:** P2. **Status:** needs decision. **Category:** compatibility / date and money policy.

**User impact:** reservations funded before this patch lack commission snapshot fields; partial disputes do not define how fixed fees/coupon funding are prorated; “daily” withdrawal uses UTC midnight; analytics accepts reversed ranges; negotiation hours use local-time `setHours`.

**Reproduction:** settle a legacy reservation after changing commission settings; compare partial/full release with a fixed fee; cross Cairo/UTC midnight; request `from > to`; cross DST in another deployment timezone.

**Root cause:** historical compatibility fallbacks and undocumented business-time semantics.

**Evidence:** `reservations.money.ts:52-85`; `wallet.service.ts:846-847`; `negotiations.service.ts:283-296`; `analytics.controller.ts:39-50`.

**Fix made:** new reservations snapshot commission terms and custom splits conserve actual escrow; ambiguous historical/partial/time policies were not guessed.

**Tests:** new money tests cover current records; no hosted-data inventory or policy fixture exists.

**Remaining risk:** inventory open funded reservations and approve reconciliation/time semantics before official launch.

## 4. Calculation audit

| Calculation                     | Server source of truth                                          | Edge cases exercised/reviewed                                                                                       | Result                                                          |
| ------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Commission/provider split       | `packages/shared/src/wallet.ts:198-225`                         | normal %, minimum, 0, negative, NaN/Infinity, commission > amount, 1 EGP at 2.5%, 9,999,999,999.99, exact remainder | Fixed/passed; integer-piastre conservation                      |
| Wallet/admin EGP parsing        | `wallet.amount.ts`; admin/wallet schemas                        | zero, negative, blank/null, 0.001, Infinity, numeric overflow, valid 2 decimals                                     | Fixed/passed                                                    |
| Reservation creation total      | `reservations.service.ts:653-731`; coupons service              | no coupon, 5 EGP discount, platform funding > commission, provider-funded discount > subtotal, zero total           | Fixed/passed; never negative                                    |
| Custom dispute split            | `reservations.money.ts:25-50`; actual locked hold               | 40/60, 40/40, 0/100, 100.01, 33.333, unsafe large values                                                            | Fixed/passed; exact partial split only                          |
| Reservation payout              | `reservations.money.ts:52-104`                                  | platform fee, cents, settings changed after funding, coupon snapshot, full release metadata                         | Fixed for new records; legacy decision remains                  |
| Per-second voice/video billing  | `reservations.service.ts:4160-4340,4768-4825`                   | integer cents, sub-cent carry, minimum prejoin, low balance, long duration                                          | Logic reviewed; focused boundary coverage is thin               |
| Reservation cancellation/refund | `reservations.service.ts:2650-2910`                             | customer/provider timing, full/none refund, penalty, held/captured states                                           | Logic reviewed; no verified conservation defect after fixes     |
| Job application fee             | `jobs.service.ts:175-279`                                       | 0, 1 EGP at 2.5%, business payout remainder, insufficient balance                                                   | Fixed/passed                                                    |
| Job milestone escrow            | `jobs.service.ts:696-775,875-1008`                              | settings mutation, corrupt stored split, cents, duplicate approval                                                  | Fixed/passed                                                    |
| Need/bid settlement             | `needs.service.ts:540-680`                                      | paid idempotency, invalid status, precision, configured receiver, insufficient balance                              | Fixed/passed                                                    |
| Coupon campaign funding         | `coupons.service.ts:147-161,281-385`; repository transaction    | fixed/percent, caps, service/commission/both, provider/platform split, zero, per-user limits                        | Fixed core defect; activation remains off                       |
| Paymob deposit                  | `wallet.service.ts:400-620`                                     | cents-to-EGP, underpayment, duplicate webhook/state, requested cap                                                  | Arithmetic reviewed; real sandbox E2E skipped                   |
| NOWPayments deposit             | `wallet.service.ts:236-365,668-746`                             | requested cap, one-cent tolerance, duplicate settlement, missing config                                             | Arithmetic reviewed; provider-first persistence risk remains    |
| Withdrawal methods/limits       | `wallet.service.ts:799-1117`; repository transaction            | min/max, daily cap, insufficient/frozen wallet, concurrent requests, UTC boundary                                   | Atomic fix passed; Cairo-day decision remains                   |
| FX/crypto quotes                | `wallet-fx.service.ts`                                          | provider failures, EGP rounding, 8-decimal payout floor, null config                                                | Math reviewed; hard-coded fallback/timeout unresolved           |
| Plan purchase/duration          | `plans.service.ts:23-28,286-494`; shared plan limits            | same-plan idempotency, replacement, zero usage, limit clamp, end date                                               | Tests passed; “monthly”/calendar semantics should be documented |
| Usage quotas                    | `usage-quota.service.ts:35-135`                                 | UTC month, zero/limit, row lock, missing limits                                                                     | Reviewed; concurrency structure sound                           |
| Ad charge/refund/CTR            | `advertisements.service.ts:34-245`; `adcenter.service.ts:30-85` | prepaid duration, cancellation proration, zero views/clicks, remaining days                                         | Reviewed but disabled; activation requires dedicated audit      |
| Ratings/averages                | `reviews.repository.ts:57-79,115-138`                           | 1–5 validation, zero reviews/null average, hidden rows, count                                                       | Fixed/passed; cached service fields unresolved                  |
| Pagination                      | controller parsing + repository offsets                         | zero, negative, NaN, large limit, empty result                                                                      | Unresolved RA-033                                               |
| Conversion                      | backend analytics + web formatter                               | 0, null, negative, 0.25, 0.3333, >1                                                                                 | Formatter fixed; metric semantics unresolved                    |
| Profile-completion badge        | profile fields + completed deposits + `platform_verified_at`    | incomplete, <1000, =1000, earned then identity changed, public/private                                              | Fixed/passed                                                    |
| Admin statistics                | `admin.repository.ts:36-54`                                     | zero rows, deposits, multi-leg transactions, commission                                                             | Semantics unresolved RA-038                                     |
| Dates/deadlines                 | auth/reservations/negotiations/analytics                        | leap date, impossible date, age, max reservation duration, UTC/local boundaries, reversed range                     | Registration fixed; policy items remain RA-042                  |
| Search/ranking                  | services/recommendations repositories                           | rating/order/view weighting, null rating, inactive users                                                            | Query logic reviewed; stale aggregate source is unresolved      |

## 5. Security and permission audit

- Access tokens are signed/short-lived; opaque refresh tokens are hashed, rotated, and revoked. Refresh/logout routes use trusted-origin checks. Authentication now reloads active state, primary role, admin status/permissions, email verification, and role-profile verification from PostgreSQL.
- Authorization is server-side. Admin routes use scoped permissions, super-admin hierarchy protection, self-mutation protection, and immutable platform-account controls. Hiding UI is not relied upon.
- Factory reset requires `super_admin`, an exact strict request body, and explicit production opt-in; no reset or migration/destructive database command was run.
- Ownership checks cover private verification files, wallet proof uploads, reservations/jobs/needs, and profile records. The verified public-media IDOR was removed; durable public-object ownership remains an open design item.
- Webhook controls include Didit HMAC/timestamp checks, conditional state transitions, payment HMAC/IPN validation, and idempotent state checks. Didit cross-table atomicity remains unresolved.
- Uploads are size/concurrency/account limited and private IDs are redacted from request paths. MIME magic-byte validation remains unresolved.
- Production CORS requires explicit secure public origins; checkout return URLs are restricted to configured web origins; refresh-cookie settings are environment-aware. Anti-framing headers are present.
- SQL access observed in critical paths is parameterized. No reproducible SQL injection, command injection, path traversal, open redirect, unsafe HTML-rendering, CSRF bypass, prototype pollution, or exposed committed production secret was found. This is an evidence statement, not a guarantee against untested paths.
- Hooks are called before early returns in chat components and `react-hooks/rules-of-hooks` is an error. The root lint gate now includes shared, API, and web. `exhaustive-deps` is not explicitly enabled.
- `avatarUrl` is validated (`users.validation.ts:8`), persisted (`auth.repository.ts:251-279`), and returned (`auth.service.ts:500-516`).
- Arabic dictionaries passed structural validation and mojibake scanning. `/app/browse` redirects to the supported services route. Ads remain hidden/fail-closed.
- Stripe's client stub has no imports/reachable caller. Legacy `/deposit/stripe` delegates to gated NOWPayments card checkout and confirmation never credits; all Stripe/live payment credentials and flags were blank/false during E2E. Stripe cannot process a live charge in the audited code path.

## 6. Commands and validation results

| Command                                                                           | Result                                                                                                                 |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `git switch -c codex/release-audit-20260722`                                      | PASS; dedicated audit branch                                                                                           |
| `npm ci`                                                                          | PASS; clean install (initially reported 34 advisories before remediation)                                              |
| `npm audit fix`                                                                   | Applied safe lockfile updates; command remained nonzero because breaking-only advisories remain                        |
| `npm run typecheck`                                                               | PASS; shared, API, web                                                                                                 |
| `npm run lint -w @mohandishub/shared`                                             | Initially FAIL: 5 project/import/type lint errors; fixed; final PASS                                                   |
| `npm run lint`                                                                    | Final PASS; now enforces shared + API + web, zero warnings                                                             |
| `npm run test`                                                                    | PASS: shared 3 files/13 tests; API 47/187; web 15/52; **252 tests total**                                              |
| `npm pkg get scripts`                                                             | PASS; no standalone integration-test script exists; integration-style API coverage runs under `npm run test`           |
| `npm run test:coverage`                                                           | PASS; API 18.89% statements / 11.31% branches / 12.32% functions / 19.47% lines; web 63.69% / 50.90% / 56.57% / 65.31% |
| `npm run validate:i18n`                                                           | PASS                                                                                                                   |
| `npm run format:check`                                                            | Initially FAIL on 28 audit-touched files; formatted; final PASS                                                        |
| `npm run build`                                                                   | PASS; shared/API TypeScript and optimized Next 15.5.19 production build                                                |
| `npm ci; npm run build -w @mohandishub/shared; npm run build -w @mohandishub/api` | PASS; Render-equivalent clean install/build sequence                                                                   |
| `npm run build -w @mohandishub/shared; cd apps/web; npm exec next build`          | PASS; Vercel build-command parity (Vercel install command itself is `npm install --include=dev`)                       |
| `npx playwright install chromium`                                                 | PASS                                                                                                                   |
| isolated `npm run e2e` command below                                              | PASS: 10 passed, 4 skipped, 0 failed; skipped cases are the real-money sandbox file                                    |
| `npm audit --omit=dev`                                                            | NONZERO: 19 moderate, 0 high, 0 critical                                                                               |
| `npm audit`                                                                       | NONZERO: 1 low + 19 moderate, 0 high, 0 critical                                                                       |
| `supabase --version`                                                              | PASS: 2.105.0                                                                                                          |
| `supabase db lint --local --level error --fail-on error`                          | BLOCKED: no local PostgreSQL at `127.0.0.1:54322`                                                                      |
| `docker --version`                                                                | UNAVAILABLE: Docker is not installed, so safe local Supabase startup/schema lint could not run                         |
| `git diff --check` / final `git status --short`                                   | PASS / clean before report creation                                                                                    |

The final browser run used this exact isolation pattern (all omitted credential variables in the array were set to an empty string before execution):

```powershell
$env:CI='1'; $env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:3000'; $env:BASE_URL='http://127.0.0.1:3000'; $env:E2E_API_BASE_URL='http://127.0.0.1:4000'; $env:API_BASE_URL='http://127.0.0.1:4000'; $env:NEXT_PUBLIC_API_URL='http://127.0.0.1:4000'; $env:API_INTERNAL_URL='http://127.0.0.1:4000'; $env:API_PUBLIC_URL='http://127.0.0.1:4000'; $env:WEB_PUBLIC_URL='http://127.0.0.1:3000'; $env:CORS_ORIGIN='http://127.0.0.1:3000'; $env:CORS_EXTRA_ORIGINS=''; $env:DATABASE_URL=''; $env:JWT_SECRET='e2e-local-only-access-secret-000000000'; $env:JWT_REFRESH_SECRET='e2e-local-only-refresh-secret-0000000'; $env:VERIFICATION_PROVIDER='manual'; $env:OTP_EMAIL_PROVIDER='console'; $env:OTP_SMS_PROVIDER='console'; $env:DIDIT_BASE_URL='http://127.0.0.1:9'; $env:PAYMOB_API_BASE_URL='http://127.0.0.1:9'; $env:BACKUP_SUPABASE_BASE_URL='http://127.0.0.1:9'; $env:NOWPAYMENTS_FIAT_ENABLED='false'; $env:NOWPAYMENTS_CUSTODY_ENABLED='false'; $env:NOWPAYMENTS_MASS_PAYOUTS_ENABLED='false'; $env:NOWPAYMENTS_WITHDRAWALS_ENABLED='false'; $env:NOWPAYMENTS_LIVE_REQUIRED='false'; $env:PAYMOB_DEPOSITS_ENABLED='false'; $env:PAYMOB_WITHDRAWALS_ENABLED='false'; @('E2E_CUSTOMER_EMAIL','E2E_CUSTOMER_PASSWORD','E2E_PROVIDER_EMAIL','E2E_PROVIDER_PASSWORD','E2E_ADMIN_EMAIL','E2E_ADMIN_PASSWORD','E2E_SCOPED_ADMIN_EMAIL','E2E_SCOPED_ADMIN_PASSWORD','E2E_PAID_PROVIDER_ID','E2E_PAID_SERVICE_ID','E2E_PAID_SLOT_ID','NOWPAYMENTS_API_KEY','NOWPAYMENTS_IPN_SECRET','NOWPAYMENTS_AUTH_EMAIL','NOWPAYMENTS_AUTH_PASSWORD','PAYMOB_SECRET_KEY','PAYMOB_PUBLIC_KEY','PAYMOB_HMAC_SECRET','PAYMOB_INTEGRATION_IDS','PAYMOB_PAYOUT_CLIENT_ID','PAYMOB_PAYOUT_CLIENT_SECRET','PAYMOB_PAYOUT_BASE_URL','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_PUBLISHABLE_KEY','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','DIDIT_API_KEY','DIDIT_WEBHOOK_SECRET','DIDIT_WORKFLOW_ID','AGORA_APP_ID','AGORA_APP_CERTIFICATE') | ForEach-Object { Set-Item -Path "Env:$_" -Value '' }; npm run e2e
```

The Next workspace build intentionally uses `--no-lint`; the separate final root lint passed. Local runtime was Node 24.11.1/npm 11.7.0, while CI declares Node 20; CI remains the Node-20 parity authority.

## 7. Changes made

### Commit inventory

```text
b39d439 fix: block all admin primary role changes
960c1d2 fix: protect verification evidence integrity
4708161 fix(ui): localize InstaPay deposit fields, make toasts screen-reader + RTL safe, label chat location button
ebfbde9 fix: consume password reset tokens atomically
33719ad fix: harden identity verification trust boundaries
415baef docs(ui): add UI/UX release audit report
d821eed fix: prevent cross-user public media deletion
b8463c1 fix: preserve valid OTPs on delivery failure
6d892aa fix: disable untrusted retention webhooks
2671e8b fix: bound upload memory and request abuse
aaa6652 fix: enforce daily withdrawal limits atomically
a538d45 fix: round commissions with a single money source
a568c87 fix: validate EGP precision at API boundaries
045044d fix: exclude hidden reviews from rating averages
8957c1a fix: keep unfinished advertising fail-closed
142e942 fix: enforce anti-framing headers
e621dd4 fix: reject impossible registration dates
2a5afab fix: redact provider response bodies from errors
61404b8 fix: remove legacy seeded user endpoints
e4e1ab4 fix: fail closed on insecure production targets
6eeb4c5 fix: enforce admin account hierarchy
5df83aa fix: correct coupon-funded reservation totals
aee8460 fix: round paid application splits to cents
cc9e7fb fix: validate legacy wallet amounts strictly
c6c1934 fix: render analytics conversion as a percentage
bafac28 fix: hide factory reset from scoped admins
9259f1d fix: make shared lint gate enforceable
eb8a414 style: format release audit changes
87e110f fix: resolve nonbreaking dependency advisories
7410980 fix: keep local e2e database-isolated
1e72616 fix: preserve funded payout and escrow invariants
1d6df5f fix: validate privileged EGP controls
0649a32 fix: refresh verification trust state
48ea52b fix: redact private upload request identifiers
b659b22 fix: enforce shared lint in release gate
```

### Changed-file inventory and purpose

- **Production configuration/deployment:** `apps/api/.env.example`, `apps/api/src/config/env.ts`, `apps/web/.env.example`, `apps/web/next.config.ts`, `render.yaml` — document and fail closed on secure production provider, TLS, CORS, feature, and API-target settings.
- **Authentication/authorization/security middleware:** `apps/api/src/middleware/authenticate.ts`, `rate-limit.ts`, `request-logging.ts`, `modules/admin/admin.controller.ts`, `admin.service.ts`, `admin.validation.ts`, `modules/auth/auth.repository.ts`, `auth.service.ts`, `auth.validation.ts`, `modules/users/users.routes.ts`, `modules/verification/verification.controller.ts`, `verification.provider.ts`, `verification.repository.ts`, `verification.service.ts` — current-state auth, role hierarchy, reset atomicity, input/date controls, safe webhook transitions, endpoint removal, rate limits, and log redaction.
- **Uploads/profile/retention/moderation:** `modules/upload/upload.routes.ts`, `profiles.repository.ts`, `profiles.service.ts`, `moderation.service.ts`, `retention.admin.validation.ts`, `retention.alerts.ts`, `retention.service.ts` — ownership, approved-record immutability, badge source, upload bounds, SSRF removal, and conservative public cleanup.
- **Money/business logic:** `modules/coupons/coupons.service.ts`, `jobs/jobs.service.ts`, `needs/needs.service.ts`, `needs/needs.validation.ts`, `reservations/reservations.money.ts`, `reservations/reservations.service.ts`, `reviews/reviews.repository.ts`, `settings/settings.service.ts`, `wallet/wallet.amount.ts`, `wallet/wallet.controller.ts`, `wallet/wallet.repository.ts`, `wallet/wallet.service.ts`, `otp/otp.provider.ts`, `otp/otp.repository.ts`, `otp/otp.service.ts`, `advertisements/advertisements.service.ts` — exact money, escrow, coupon, payout, withdrawal, range, OTP, rating, and feature-gate corrections.
- **Provider error handling:** `apps/api/src/utils/resend-email.ts`, `send-transactional-email.ts` — remove provider response bodies from errors/logs.
- **Shared contracts/calculations:** `packages/shared/src/auth.ts`, `jobs.ts`, `reservations.ts`, `wallet.ts`, `wallet.test.ts` — corrected contracts, commission source of truth, snapshot fields, and edge tests.
- **Web behavior/UI:** `apps/web/app/[locale]/app/advertisements/page.tsx`, `components/admin/admin-ads-tab.tsx`, `admin-panel.tsx`, `admin-settings-tab.tsx`, `components/app/ad-slideshow.tsx`, `advertisements/my-ads-screen.tsx`, `app-sidebar.tsx`, `business-dashboard.tsx`, `chat-screen.tsx`, `expert-dashboard.tsx`, `toast.tsx`, `wallet-deposit-modal.tsx`, `components/auth/auth-form.tsx`, `lib/advertisements/client.ts`, `advertisements/feature.ts`, `analytics/format.ts`, `lib/i18n/dictionaries/ar.ts`, `en.ts` — fail-closed ads, factory-reset visibility, hooks/a11y/localization, dates, and correct analytics display.
- **API regression tests:** `apps/api/src/tests/admin-release-blockers.test.ts`, `advertisement-launch-gate.test.ts`, `auth.repository.test.ts`, `auth.service.test.ts`, `auth.validation.test.ts`, `env-production.test.ts`, `jobs.service.test.ts`, `needs.service.test.ts`, `otp.service.test.ts`, `phase2-money-controls.test.ts`, `phase4-marketplace-money.test.ts`, `product-value.logic.test.ts`, `profiles-badge-source.test.ts`, `profiles-document-security.test.ts`, `provider-log-redaction.test.ts`, `public-media-deletion-safety.test.ts`, `request-logging.test.ts`, `reservations.money.test.ts`, `retention-alert-security.test.ts`, `reviews.repository.test.ts`, `settings.service.test.ts`, `upload-abuse-hardening.test.ts`, `users.test.ts`, `verification.repository.test.ts`, `verification-security.test.ts`, `wallet.amount.test.ts`, `withdrawal-limit-atomicity.test.ts` — targeted coverage for each fixed boundary.
- **Web regression tests:** `apps/web/tests/advertisement-feature.test.ts`, `analytics-format.test.ts`, `env.test.ts`, `release-audit-ui.test.ts`, `security-headers.test.ts` — disabled-feature, formatting, env/header, localization, hooks, and UI control checks.
- **Tooling/dependencies/docs:** `package.json`, `package-lock.json`, `eslint.config.mjs`, `docs/UI_UX_RELEASE_AUDIT_REPORT.md`, `docs/RELEASE_AUDIT_2026-07-22.md` — enforce all lint gates, apply safe dependency updates/overrides, and preserve both the independent UI audit and this final release record.

No production infrastructure, production data, schema, migration, live provider, real user, or live payment action was modified or invoked.

## 8. Remaining risks

1. Hosted Supabase migration state, RLS/storage policies, SSL enforcement/CA mode, and current data constraints were not verified; local schema lint was blocked by unavailable PostgreSQL/Docker.
2. Four real-money Playwright scenarios were skipped because approved sandbox credentials/fixtures were intentionally absent. There is no end-to-end proof for register/login/create need/bid/award/pay, paid reservation, settlement, withdrawal, or Didit/Resend provider delivery.
3. API coverage is only 18.89% statements. High-risk thin areas include per-second reservation billing, coupon/dispute policy combinations, payout reconciliation, quotas, ad refund/ranking, and FX/provider failure timing.
4. RA-032 through RA-042 remain concrete unresolved or decision-dependent defects/risks. In particular: stale service aggregates, malformed pagination, external-first checkout, MIME spoofing, storage reconciliation, Didit partial failure, misleading analytics, external timeouts/FX fallback, moderate dependencies, ad activation, and legacy/policy semantics.
5. Production environment values on Vercel/Render/Supabase were not read. Before any public release, verify fail-closed checks with the real secret names/URLs without exposing values; prefer PostgreSQL `sslmode=verify-full` with the Supabase CA.
6. New reservation snapshots protect newly funded records. Any already-funded record without the new optional JSON fields needs inventory/reconciliation before changing commission settings or going public.
7. SMS OTP is safely disabled when production still uses the console adapter; a real provider must be configured if phone verification is a launch requirement.
8. The local audit used Node 24, while CI uses Node 20. The repository declares Node >=20 and all CI commands should be rerun on the branch before merge.

## 9. Launch verdict

`APPROVED_FOR_EXTERNAL_TESTING`

This does not authorize live payments, ads, production-data testing, or official public release. Keep Stripe unreachable, advertisements disabled, and all payment/provider actions in approved sandboxes until the remaining risks are closed.
