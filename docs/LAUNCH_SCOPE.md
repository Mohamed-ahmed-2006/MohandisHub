# Launch scope

- **In scope:** Auth, onboarding (customer / expert / business), needs and bids, jobs, reservations and bookings, wallet (NOWPayments deposits + withdrawals), chat, admin (users, verification, settings, plans, notifications), profile, KYC (Didit + manual), Agora calls.
- **Placeholders (Coming soon):** Business dashboard "Orders" and "Analytics" tabs show "Coming soon." They remain in nav; no 404. Can be implemented post-launch (Orders = list of service orders; Analytics = stub or minimal metrics).
- **Out of scope for launch:** Stripe/Cryptomus/Paymob (integrate later), full company document upload (verification-docs bucket exists; UI can be added later).

## Permission audit

- Admin routes: all behind `authenticate`, `requireEmailVerified`, `loadAdminFromDb`, `requireRole('admin')`, and `requireAdminPermission(...)` per action.
- Wallet and reservations: all endpoints use `req.user.id` from `authenticate`; no cross-user access.

## Edge cases (implemented / to validate)

- **Idempotency:** Reservation create and key actions use `reservation_action_idempotency`; wallet IPN handlers should be idempotent.
- **Wallet balance:** Debit paths check/throw on insufficient balance; low-balance auto-end for calls exists.
- **Cancel-after-complete, double-submit, expired sessions, negative amounts:** Validate in QA; add explicit checks where gaps are found.
