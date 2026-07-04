# MohandisHub Publish-Ready Fix Checklist

This checklist tracks the production-readiness work required before public launch.
Each item should be fixed with regression coverage where practical, then verified
with the phase gates listed in the implementation plan.

## P0 - Launch Blockers

- [x] Production env fails fast for missing `DATABASE_URL`, public URLs, Resend, Didit, Supabase storage, Sentry, unsafe retention, and enabled payment-provider credentials.
- [x] Render API/worker config uses real production-safe settings, shared manual JWT secrets, `TRUST_PROXY=1`, worker Sentry, and non-free production plans.
- [x] Manual migration script requires explicit production confirmation.
- [x] Login/register enforce `lockLogins` and `signupsLocked`.
- [x] Admin model uses explicit `super_admin`; empty `adminPermissions` means no scoped access.
- [x] Admin demotion/permission changes invalidate existing sessions and stale access.
- [x] Dispute resolution moves money through audited refund/release/split settlement.
- [x] Pending reservation expiry cannot overwrite accepted/booked reservations.
- [x] Paymob withdrawals have a completion path that captures/release holds correctly.
- [x] Supabase RLS/storage policies reflect backend-only access.

## P1 - Pre-Public Launch

- [x] Refresh/logout CSRF or origin protection is enforced.
- [x] Forgot-password/login/email-change flows resist enumeration and brute force.
- [x] Admin settings/stats and private-file reads require scoped permissions.
- [x] WebSocket auth re-checks active user state.
- [x] Reservation fee/hold/cancellation money behavior is atomic and audited.
- [x] Ad cancellation refunds prepaid wallet value where applicable.
- [x] Plan subscription prevents accidental duplicate charges.
- [x] Reservation create idempotency is race-safe.
- [x] Crypto deposits cap overpayment credits and record under/overpayment metadata.
- [x] Admin transaction reversal respects debit/credit direction and non-negative balances.
- [x] Job notification deep links open an implemented workflow.
- [x] `/[locale]/app/*` has server/edge protection, not only client redirects.
- [x] E2E runs against both web and API, including wallet/reservation/admin flows.

## P2 - Hardening

- [x] DB constraints prevent negative wallet balances and inconsistent payment states.
- [x] Missing operational indexes are added.
- [x] Migration reset/idempotency issues are documented or fixed.
- [x] Security headers and image host restrictions are tightened.
- [x] Socket refresh/logout behavior is correct.
- [x] Shared API clients consistently retry after access-token refresh.
- [x] Notification query params are consumed by destination screens.
- [x] i18n parity, Arabic surfaces, and stale "coming soon" copy are fixed.

## P3 - Polish

- [x] Password max length, reset-token URL handling, JWT placeholder guard, refresh-token hashing, and maintenance-mode edge cases are hardened.
- [x] RTL/a11y polish and orphan routes are cleaned up.
- [x] CI/tooling versions, pool sizing, and observability duplication are reviewed.
- [x] PII storage comments match the implemented masking/encryption posture.
