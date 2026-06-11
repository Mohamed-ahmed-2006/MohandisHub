# Launch scope

- **In scope:** Auth, onboarding (customer / expert / business), needs and bids, jobs, reservations and bookings, wallet (NOWPayments deposits + withdrawals, Paymob code path disabled until live keys), chat, admin (users, verification, settings, plans, notifications), profile, KYC (Didit + manual), Agora calls, provider orders, provider analytics.
- **Deferred after stabilization:** Business team seats/invites, coupon redemption UI, SMS/WhatsApp delivery, and full company document upload UI.
- **Live-operation blocker:** Paymob live checkout/payout verification waits for account activation and real env keys. The integration should remain disabled until those values are present.

## Permission audit

- Admin routes: all behind `authenticate`, `requireEmailVerified`, `loadAdminFromDb`, `requireRole('admin')`, and `requireAdminPermission(...)` per action.
- Wallet and reservations: all endpoints use `req.user.id` from `authenticate`; no cross-user access.

## Edge cases (implemented / to validate)

- **Idempotency:** Reservation create and key actions use `reservation_action_idempotency`; wallet IPN handlers should be idempotent.
- **Wallet balance:** Debit paths check/throw on insufficient balance; low-balance auto-end for calls exists.
- **Cancel-after-complete, double-submit, expired sessions, negative amounts:** Covered by service checks and QA scenarios; regressions should be fixed before launch.
