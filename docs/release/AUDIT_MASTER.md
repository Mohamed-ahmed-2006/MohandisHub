# Audit Master

Single tracking table for every finding. Updated as part of each phase, not afterwards.

**Baseline:** commit `f7fda17`, 2026-07-28.
**Status values:** `Open` · `Blocked` (awaiting a decision) · `In progress` · `Fixed` ·
`Accepted` (documented in `KNOWN_LIMITATIONS.md`) · `Won't fix`.
**Severity:** 1 Launch blocker · 2 Revenue/security critical · 3 Data-safety critical ·
4 Functional defect · 5 Cleanup/tech debt.

**Evidence tags:** **V** = verified by reading code or running a command. **I** = inferred,
not proven.

---

## Summary

| Severity | Open | Blocked | Fixed | Accepted | Total |
| --- | --- | --- | --- | --- | --- |
| 1 — Launch blocker | 1 | 3 | 0 | 0 | 4 |
| 2 — Revenue/security critical | 1 | 4 | 0 | 0 | 5 |
| 3 — Data-safety critical | 3 | 1 | 0 | 0 | 4 |
| 4 — Functional defect | 4 | 2 | 0 | 0 | 6 |
| 5 — Cleanup/tech debt | 5 | 0 | 0 | 0 | 5 |
| **Total** | **14** | **10** | **0** | **0** | **24** |

No finding has been fixed. No code has been modified.

---

## MHC findings

| ID | Area | Finding | Sev | Status | Decision Needed | Fix Commit | Tests | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MHC-04 | Payments | `provider_payment_methods` and `provider_payment_disclosures` tables exist with zero application code. With escrow retired, there is no customer→provider payment path at all. | 1 | Blocked | **D5** | — | — | **V** — repo-wide search returns only migration files; `payBid` throws 410 |
| MHC-01 | Frontend | No MHC user interface anywhere. `apps/web` untouched by `f7fda17`; `customer-dashboard.tsx` handles only `status === 'awarded'`. | 1 | Open | No (needs D2–D5 settled first) | — | — | **V** — `git show --stat f7fda17`; grep of `apps/web` |
| MHC-03 | Awards | Award offers never expire. `listExpiredPendingAwards` has no caller; `worker.ts` starts only reservation + retention workers. | 1 | Blocked | **D4** | — | — | **V** — `worker.ts:1-15`; repo-wide search |
| MHC-26 | Migrations | **Neither MHC migration is applied to the dev database.** No `mhc_*` tables; `wallets` has no `account_type`/`asset_code`; `needs` has no pending-award columns; `needs_status_check` and `bids_status_check` are still the pre-MHC sets. The `f7fda17` API code therefore cannot run against this database at all — every wallet read filters on a non-existent column. | 1 | Open | No (needs confirmation to apply) | — | — | **V** — read-only DB inspection, 2026-07-28 |
| MHC-02 | Tests | Suite red: 6 failures. Session 1's own MHC tests asserted the pre-refactor contract; the frozen-wallet test did not reach the code it named. | 1 | **Fixed** | D6 applied | `step 2` | 33 files / 184 API tests green; +6 new MHC tests | **V** — `npm test` green |
| MHC-27 | Pricing | `chargeActivation` treats a missing or inactive `mhc_action_prices` row as **free** and opens the gate. Per D6 an inactive action must be disabled, not silently free. An admin who forgets to configure a price gives activations away. | 2 | Open | D6 answered — implement at step 12 | — | Test marked PROVISIONAL in `mhc.service.test.ts` | **V** — `mhc.repository.ts:662` |
| MHC-05 | Chat | `POST /api/chat/conversations` lets any verified user DM any other, with no gate and no redaction. Nullifies bid-chat redaction. | 2 | Blocked | **D2** | — | — | **V** — `chat.service.ts:173-185` |
| MHC-06 | Gate | `assertAwardActivated`, `assertBookingActivated`, `resolveDisclosureLevelForBid` have zero callers. The enforcement layer was written but never wired in. | 2 | Open | No (D3 scopes it) | — | — | **V** — repo-wide search |
| MHC-07 | Gate | Post-activation unlock keys on `needs.activated_at`, so every bid thread on the need unlocks — including losing bidders who paid nothing. | 2 | Blocked | **D3** | — | — | **V** — `needs.service.listBidMessages` |
| MHC-08 | Bookings | `activateBooking` implemented but never called; no booking route; `assertBookingActivated` unused. Bookings are a free, ungated second door to paid work. | 2 | Blocked | **S1** | — | — | **V** — repo-wide search; `mhc.routes.ts` |
| MHC-09 | Profiles | Public profiles expose `linkedinUrl`, `portfolioUrl`, `website` — working off-platform contact channels. No phone/email exposure (that part is correct). | 2 | Blocked | **D5** | — | — | **V** exposure (`profiles.service.ts:1058-1146`); **I** that it materially bypasses the gate |
| MHC-10 | Wallets | Migration freezes every EGP money wallet while all deposit and withdrawal rails are off. Any real balance is stranded. | 3 | Blocked | **D1** | — | — | **V** — `20260728160000_...sql:147-150`; **I** whether prod balances exist |
| MHC-11 | Migrations | `uq_deposit_requests_instapay_reference` spans legacy InstaPay wallet top-ups, not just MHC purchases. Duplicate historical references would abort the migration. | 3 | Open | No | — | — | **V** index definition; **I** whether duplicates exist in prod |
| MHC-12 | Purchases | `fulfillCreditPurchase` grants from any status outside paid/completed/rejected/cancelled — including `expired`, `failed`, `underpaid`. Webhook path never validates that the provider status means "settled". | 3 | Open | No | — | — | **V** — `mhc.repository.ts:379-392` vs `20260610132000_...sql:186`. Latent: webhook has no caller |
| MHC-13 | Migrations | 83 migrations, applied by hand, no runner, no per-environment record of what is applied. `20260728160000` silently no-ops if its predecessor did not run. | 3 | Open | **S2** | — | — | **V** absence of runner; **I** the manual process |
| MHC-14 | Awards | TOCTOU: state validated by an unlocked read, then `chargeActivation` updates `bids`/`needs` with unguarded `WHERE id = $1`. A re-awarded need can be overwritten. | 4 | Open | No | — | — | **V** — `mhc.service.ts:318-383`, `mhc.repository.ts:732-751` |
| MHC-15 | Validation | `updateNeedSchema` status enum omits `awarded_pending_provider_acceptance`. Low impact — it correctly prevents a customer setting it. | 4 | Open | No | — | — | **V** — `needs.validation.ts:27` |
| MHC-16 | Plans | Two divergent active-need counts: `countActiveNeedsByCustomer` includes the new status, `plans.service.ts:424` does not. | 4 | Open | No | — | — | **V** — both files |
| MHC-17 | Awards | Closing a need with a pending award leaves `pending_award_*` populated and the bid stranded in `awarded_pending`, permanently consuming a bid slot. | 4 | Open | No | — | — | **V** — `updateNeed` + `assertNeedStatusTransition` + `chk_needs_pending_award_shape` |
| MHC-18 | Awards | Losing bids are rejected and notified "not selected" at *offer* time, before acceptance. If the offer lapses, the need reopens with everyone already rejected. | 4 | Blocked | **D4** | — | — | **V** — `needs.service.awardBid` |
| MHC-19 | Ads | Paid advertisements charge the now-frozen EGP wallet and cannot work. Free ads still 402 for providers with no money wallet row. Four MHC promotion action keys seeded but unconsumed. | 4 | Blocked | **D6** | — | — | **V** — `advertisements.service.ts:41-90`; `20260728120000_...sql:127-136` |
| MHC-21 | Cleanup | Four dead duplicates of money-adjacent logic: `markAwardAcceptedInTransaction`, `releasePendingAward`, `listExpiredPendingAwards`, `grantCredits`. Two implementations of one transition is a standing hazard. | 5 | Open | No | — | — | **V** — repo-wide search |
| MHC-22 | Cleanup | `mhc_tiered_pricing_implementation_prompt.md` (850 lines) sits at repo root; it is an out-of-scope future proposal and reads like a spec. | 5 | Open | No | — | — | **V** — file present |
| MHC-23 | Cleanup | MHC wallets carry `currency = 'EGP'`; `asset_code` is the real authority. Will mislead any report grouping by currency. | 5 | Open | No | — | — | **V** — `getOrCreateCreditWallet` |
| MHC-24 | Cleanup | MHC columns are `NUMERIC(14,2)`; `transactions.amount`/`balance_delta` are `NUMERIC(12,2)`. The ledger cannot represent the full permitted MHC range. | 5 | Open | No | — | — | **V** — migration definitions |
| MHC-25 | Cleanup | `getMyCredits` creates a wallet row as a side effect of a read. | 5 | Open | No | — | — | **V** — `mhc.service.ts:80` |

---

## Platform findings

To be populated by Part B Phase 0 and subsequent phases. Reserved ID prefix: `PLT-`.

| ID | Area | Finding | Sev | Status | Decision Needed | Fix Commit | Tests | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PLT-01 | Build | Stale `.next/types` entries for deleted routes (`app/[locale]/app/providers/[providerId]`, `services/[serviceId]`) cause phantom `TS2307` typecheck failures. Cleared locally; CI needs a clean `.next` or the check is non-deterministic. | 4 | Open | No | — | — | **V** — routes absent on disk, types present in `.next` |
| PLT-02 | Lint | 6 `import/order` errors introduced by `f7fda17` broke `npm run lint`. | 4 | **Fixed** | No | `step 2` | `npm run lint` green | **V** — eslint output |

---

## Modules not yet audited

Listed so the empty platform table is not misread as a clean bill of health.

| Module | Status |
| --- | --- |
| `wallet.service.ts` (66 KB), most of `wallet.repository.ts` (70 KB) | Not read |
| Reservations / bookings lifecycle + worker | Not read |
| Jobs, hiring, interviews, milestone escrow | Not read |
| Disputes, refunds, reversals, money audit | Not read |
| Notifications and email delivery | Not read |
| Admin / super-admin permission matrix | Partially read (MHC routes only) |
| Auth, sessions, account recovery | Not read |
| `apps/web` — all 31 routes, RTL/LTR, responsiveness | Not read |
| `render.yaml`, env validation, backups, rollback | Not read |
| Coupons, business teams, support, retention, analytics, geo | Not read |
