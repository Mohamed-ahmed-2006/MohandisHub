# Production QA checklist — MohandisHub

Use this list for final sign-off before release. Execute on **staging** or the **release candidate** build. Record pass/fail, notes, and bug IDs per row.

**Roles in scope:** customer, expert, business, **craftsman** (provider role alongside expert), and **admin** (`is_admin` flag, separate from primary role).

**Handoff block for testers**

> Before handoff, confirm all sections below were executed, with evidence (screenshots / ticket IDs) for any failure.

---

## 1. Authentication, sessions, and account security

- [ ] Register: customer, expert, business, craftsman — validation (weak password, duplicate email, required fields).
- [ ] Login / logout; session correct after refresh and new browser tab.
- [ ] Token refresh: long session / idle behavior; no silent “stuck logged out” on navigation.
- [ ] Forgot password → email → reset → new password → login.
- [ ] Email verification flow (OTP or link, per environment).
- [ ] Phone / OTP if enabled (`docs/OTP_EMAIL_RUNBOOK.md`).
- [ ] Onboarding per role; blocked or gated steps when verification is pending.
- [ ] Non-admin cannot access admin routes; forbidden actions clearly denied.
- [ ] Email-verified gate: protected actions fail with clear messaging until verified.

---

## 2. Authorization and data isolation

- [ ] Each role sees only allowed menus and actions (customer vs provider matrix).
- [ ] Cross-user access: tampering IDs (URL/API) for needs, jobs, reservations, wallet, chat — expect deny.
- [ ] Craftsman flows consistent wherever “provider” applies (services, calendar, bids if applicable).

---

## 3. Admin

- [ ] User list: search, deactivate/suspend if present.
- [ ] Verification queue: expert, business, craftsman; KYC if Didit/manual is enabled (`docs/KYC_RUNBOOK.md`).
- [ ] Plans: assign/change; effect visible in app (limits, charges).
- [ ] Categories / services moderation (if in panel).
- [ ] Transactions / wallet oversight (audit views).
- [ ] Admin notifications broadcast (if implemented).
- [ ] Support tickets: list, assign, status (`docs/FEATURE_ROADMAP_STATUS_AND_TESTING.md`).
- [ ] Admin permission matrix: admin without specific permission cannot perform restricted actions.

---

## 4. Customer needs: post → bid → award → complete

- [ ] Create need (required fields, attachments if any).
- [ ] Expert/craftsman places bid; edit/cancel if allowed.
- [ ] Customer compares bids, awards one; other bidders see correct state.
- [ ] Complete / cancel / expire; no double-award.
- [ ] Post-completion: reviews/ratings if implemented; history correct.

---

## 5. Jobs (business): post → applicants → award → downstream

- [ ] Business creates job; correct visibility to applicants.
- [ ] Apply flow; business sees applicants; reject/shortlist if present.
- [ ] Award; status transitions for both sides.
- [ ] Job application chat: messages, real-time updates, access only for involved parties.

---

## 6. Services catalog and discovery

- [ ] Expert/business/craftsman: create/edit/publish service (categories, pricing, areas).
- [ ] Browse/search: filters (rating, price, verified, sort) and sensible results.
- [ ] Recommendations (API or UI) if shipped.
- [ ] Badges: Verified, Top rated where applicable.
- [ ] Favorites: add/remove provider or service; persists after reload.

---

## 7. Reservations / bookings (slots, online vs offline, money)

- [ ] Provider: create/edit availability; calendar/slot display sane.
- [ ] Customer: book slot; confirmation; provider calendar reflects booking.
- [ ] Online vs offline modes: correct rules (pricing, duration, flags) per product.
- [ ] Reschedule / cancel; refunds or ledger entries if applicable.
- [ ] Double-submit / idempotency: rapid confirm does not duplicate bookings.
- [ ] Complete reservation; settlement per `docs/ESCROW_AND_DISPUTES.md`.
- [ ] Dispute path: support ticket + admin handling.

---

## 8. Wallet, InstaPay, non-crypto (crypto out of scope for this pass)

- [ ] Balance display; currency formatting (e.g. EGP).
- [ ] Deposit for configured provider (InstaPay / NOWPayments per env).
- [ ] Withdrawal request (provider roles); validation; admin processing if manual.
- [ ] Receipt: from transaction list → receipt API or UI (`GET /api/wallet/me/transactions/:id/receipt`).
- [ ] Insufficient balance: paid actions fail cleanly.
- [ ] Call billing: low-balance behavior during audio/video (warning / auto-end per implementation).
- [ ] InstaPay-related proof upload and admin accept/reject if part of payout flow.

---

## 9. Calls (audio / video / Agora)

- [ ] Start call from intended entry points; browser mic/camera permissions.
- [ ] Remote join/leave; brief network drop recovery.
- [ ] End call; duration/charges reflected in wallet/history if billed.

---

## 10. Chat (main app)

- [ ] Open/start conversation from profile, need, or job context as designed.
- [ ] Send/receive text; real-time delivery; load older messages.
- [ ] Reply, attachments, link/location types if exposed in UI.
- [ ] Delete for me vs for everyone; closed conversation cannot send.
- [ ] Global chat pause: clear error if admin disables chat.

---

## 11. Plans and monetization

- [ ] View current plan; upgrade/downgrade if applicable.
- [ ] Wallet payment for plan; failure paths.
- [ ] Plan limits enforced (posting, features, allowed roles).

---

## 12. Notifications and email

- [ ] In-app notifications for key events (bid, award, booking, message, verification).
- [ ] Transactional email when applicable; no duplicate storms on retries.

---

## 13. Support

- [ ] User: create ticket, reply, view thread.
- [ ] Admin: list, assign, change status.

---

## 14. Profile, documents, verification

- [ ] Profile edit; avatar rules per role (e.g. expert/craftsman).
- [ ] Document upload; pending → approved/rejected; effect on verified badge and gated actions.

---

## 15. Internationalization and legal

- [ ] English and Arabic: RTL layout, no clipped text on critical flows.
- [ ] Terms and Privacy pages in both locales.

---

## 16. PWA / web routing

- [ ] Manifest present (`/manifest.json`); optional install behavior.
- [ ] Refresh and deep links on nested `app` routes work in production build.

---

## 17. Non-functional / production readiness

- [ ] Performance: search, chat, admin lists with realistic data.
- [ ] Security: HTTPS, cookies, CORS; no secrets in client bundle.
- [ ] Errors: user-safe messages; consistent API error shape; critical failures observable server-side.
- [ ] Post-deploy smoke: see `docs/E2E_RUNBOOK.md` (five must-pass journeys minimum).
- [ ] Accessibility: keyboard on auth forms, focus, contrast on primary flows.
- [ ] Mobile: sidebar, chat input, call UI on narrow viewports.

---

## Reference docs

| Topic | Doc |
|--------|-----|
| E2E / Playwright | `docs/E2E_RUNBOOK.md` |
| Feature testing notes | `docs/FEATURE_ROADMAP_STATUS_AND_TESTING.md` |
| Launch vs placeholder | `docs/LAUNCH_SCOPE.md` |
| Escrow / disputes | `docs/ESCROW_AND_DISPUTES.md` |
| KYC | `docs/KYC_RUNBOOK.md` |
| Agora | `docs/AGORA_RUNBOOK.md` |
| OTP / email | `docs/OTP_EMAIL_RUNBOOK.md` |
| App spec (routes, roles) | `docs/LOVABLE_APP_SPEC.md` |

---

## Spreadsheet column suggestion

| Section | Item | Build | Tester | Date | Pass/Fail | Notes | Bug ID |

Copy checklist rows into your tracker and fill the metadata columns per run.
