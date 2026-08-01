# 09 — Prioritized Backlog

Machine-readable equivalent: `backlog.json`.

**Complexity:** S = small, M = medium, L = large. No time estimates, per instruction.
**Class** refers to `12-capability-classification.md` (1 working · 2 inconsistent · 3 cosmetic · 4 partial · 5 broken · 6 missing).

**Standing rule:** nothing classified 1 or 2 is scheduled for removal. Class 2 items get integration work.

---

## P0 — Broken or contradictory launch behaviour

### P0-01 · Header shows frozen EGP balance to every role

**Class 5/2** · **S** · deps: none

- **Current:** `app-shell.tsx:208` renders `wallet.balance + wallet.currency` from the frozen money wallet, for all roles, labelled "Balance".
- **Intended:** MHC pill for provider workspaces; nothing for customers.
- **Files:** `app-shell.tsx`, `app-shell.css`, `lib/hooks/use-api-swr.ts`
- **DB/API:** none · **UI:** header · **Permissions:** none
- **Risk:** low. `GET /api/wallet/me` stays live for history.
- **Tests:** provider sees MHC; customer sees no balance; MHC formatting has no currency symbol.

### P0-02 · Deposit modal reachable with zero deposit methods

**Class 5** · **S** · deps: P0-01

- **Current:** header `+` opens `WalletDepositModal`; all four rails false → "No deposit methods are currently available."
- **Intended:** entry point removed. Providers get "Buy credits".
- **Files:** `app-shell.tsx`, `wallet-deposit-modal.tsx` (retain, unmounted)
- **Risk:** low. Do not delete the modal — it is the re-entry point if a rail is ever reopened.

### P0-03 · Advertisement campaigns debit a frozen wallet

**Class 5** · **M** · deps: P0-07

- **Current:** `advertisements.service.ts:41-77` computes an EGP amount and calls `walletRepo.debitWalletInTransaction`. Works only because default `pricePerDay = 0`; **any non-zero price fails.**
- **Intended:** charge MHC via `mhc_action_prices.advertisement`.
- **Files:** `advertisements.service.ts`, `advertisements.repository.ts`, `mhc.service.ts`, `my-ads-screen.tsx`, `admin-ads-tab.tsx`
- **DB:** activate the `advertisement` action price; add a partial unique index on `(advertisement_id)` in the MHC charge table for idempotency. Retain `advertisement_plans.price`/`currency`, commented legacy.
- **Risk:** medium — money path. Must be idempotent and transactional.
- **Tests:** insufficient MHC → 402 and no ad created; duplicate submit → one charge; ledger row written.

### P0-04 · Plan subscription debits a frozen wallet

**Class 5** · **M** · deps: P0-07

- **Current:** `PlansService` takes `WalletRepository`; `SubscribeToPlanResponse.walletBalance` is EGP.
- **Intended:** MHC via `subscription_upgrade`, or free-with-entitlements for launch.
- **Files:** `plans.service.ts`, `plans.controller.ts`, `my-plan-screen.tsx`
- **Risk:** medium. Existing `plan_subscriptions` rows must keep working.

### P0-05 · Withdrawal UI persists for roles that cannot withdraw

**Class 5** · **S** · deps: none

- **Current:** `canRequestWithdrawal` true for all four roles; form suppressed by rail flags but section, heading, history list and `formatStatus` still render.
- **Intended:** entire section removed; `canRequestWithdrawal` returns false at launch.
- **Files:** `wallet-settings-screen.tsx`, `packages/shared/src/roles.ts`
- **Risk:** low. Server routes stay; add fail-closed guards (P0-08).

### P0-06 · Customers see a wallet section with no function

**Class 2** · **S** · deps: none

- **Current:** `getVisibleProfileSections()` returns `wallet` unconditionally.
- **Intended:** hidden for customer workspaces; becomes "Credits" for providers.
- **Files:** `profile-screen-sections.ts`, `profile-screen.tsx`, `tests/profile-screen-sections.test.ts`
- **Note:** this file is already modified in the working tree — reconcile before editing.

### P0-07 · Generalise MHC charging beyond activation

**Class 4** · **M** · deps: none · **blocks P0-03, P0-04, P1-01**

- **Current:** only `award_activation` and `booking_activation` charge MHC. Five seeded action keys unused.
- **Intended:** a reusable `chargeAction({ userId, actionKey, referenceType, referenceId, client, idempotencyKey })` extending `MhcRepository.chargeActivation`.
- **DB:** generic `mhc_action_charges` table with a unique index on `(action_key, reference_type, reference_id)`.
- **Risk:** medium. **Must not alter the existing activation path** — extend around it.
- **Tests:** concurrent identical charges → exactly one debit; insufficient balance → 402, no partial state.

### P0-08 · Fail-closed guards on retired money routes

**Class 5** · **S** · deps: none

- **Current:** deposit and withdrawal routes reachable and rely on rail flags.
- **Intended:** explicit `410` following the `payBid` pattern (`needs.service.ts:601`), using `isPaymentMethodEnabledStrict`.
- **Keep open:** `GET /wallet/me`, `/me/transactions`, `/receipt`, and **all webhooks** (an in-flight deposit may still settle).
- **Risk:** low if the keep-open list is respected. **Do not delete handlers.**

### P0-09 · MHC screen has no navigation entry

**Class 2** · **S** · deps: none

- **Current:** `MhcCreditsScreen` mounted at `profile-screen.tsx:928`; absent from the sidebar. The launch revenue mechanism is unreachable by navigation while the frozen EGP balance has a header pill.
- **Intended:** `/app/credits` route + sidebar item for providers; added to `MANAGED_SIDEBAR_HREFS`.

### P0-10 · Reviews impossible after a need-job

**Class 5** · **M** · deps: P1-04

- **Current:** `reviews.service.ts:58` branches only on `reservationId || bookingId`. A need-job produces no reviewable entity.
- **Intended:** third branch for a completed, activated need-job; bidirectional.
- **DB:** `reviews.need_id` + partial unique index `(need_id, reviewer_id)`.
- **Risk:** low-medium — touches the `reviews_target_type_check` constraint.

### P0-11 · Notification deep links point at a 2,430-line screen

**Class 2** · **S** · deps: none

- **Current:** all five `need_bid_*` → `/app`; five `wallet_*` → a retiring screen.
- **Intended:** entity-specific targets; interim query params matching the existing `?post=1` pattern.

### P0-12 · Team members cannot view their own team

**Class 5** · **S** · deps: none

- **Current:** `GET /api/business-teams/me` → `ensureOwnerTeam` → 403 unless `role==='business'`.
- **Intended:** split read from provision; any `business_members` row grants read.
- **Also:** add `uq_business_teams_business` — concurrent first reads can create two teams.

### P0-13 · Support and disputes are three disconnected systems

**Class 6** · **M** · deps: none

- **Intended:** one entry point; system routes by subject + entity state. Additive columns on `support_tickets` (see `05` §2.3).
- **Risk:** low in phase 1 — purely additive, `NOT VALID` constraint, `reservation_disputes` untouched.

### P0-14 · Business analytics has no route

**Class 2** · **S** · deps: none

- **Current:** tab inside the business dashboard. API (`GET /api/analytics/me`) is class 1 and correct.
- **Intended:** `/app/analytics` with a matching route guard.

### P0-15 · Misleading navigation labels

**Class 2** · **S** · deps: none

- `/app/projects` = employment jobs → "Hiring", add to sidebar.
- `/app/services` = own catalogue → "My Catalogue".
- `/app/browse` → delete the dead redirect.

---

## P1 — Core marketplace workflow

### P1-01 · MHC fee on bid submission

**Class 6** · **M** · deps: P0-07

- **Current:** bidding is free. Step 3 of the product objective is unimplemented.
- **Intended:** charge `bid_submission` on `POST /api/needs/:needId/bids`, after quota checks, inside the same transaction.
- **Must include:** fee shown pre-submission with resulting balance; free edit of an existing bid; **refund when the customer never awards** (see `03` §5.2); no refund on a normal loss.
- **Risk:** medium — a badly priced fee suppresses bid volume. Ship with the price at 0 and raise it deliberately.

### P1-02 · Businesses cannot post needs or procure

**Class 6** · **L** · deps: P1-03

- **Current:** `requireRole('customer')` on all four need-management routes.
- **Intended:** workspace-gated. **Do not simply add `'business'` to `requireRole`** — a business would then see its own needs in its own opportunity feed with no way to distinguish hats.

### P1-03 · Workspace model

**Class 6** · **L** · deps: none · \*_blocks P1-02, P1-09, P2-_

- Schema, backfill, `resolveWorkspace` middleware, `requireWorkspaceKind` guard — see `02` §4.
- **Critical:** `X-Workspace-Id` optional with fallback to `primary_role`; `primary_role` retained throughout.
- **Rollback:** null the FKs, drop two new tables. No existing column modified.

### P1-04 · Milestones, deliverables, completion for need-jobs

**Class 6** · **L** · deps: none · **blocks P0-10**

- `need_milestones`, `need_deliverables`, mutual completion timestamps — see `04` §2.
- **No money columns.** Coordination and evidence only.
- Every deliverable read passes `ActivationGateService.assertAwardActivated`.

### P1-05 · P0 notifications

**Class 6** · **M** · deps: none

- `mhc_purchase_approved`, `mhc_purchase_rejected`, `award_activated` (→ customer), `activation_reminder`, `mhc_low_balance`.
- `describePurchaseState()` already produces the correct bilingual copy and is tested — reuse it.

### P1-06 · Proposal comparison surface

**Class 6** · **M** · deps: none

- Side-by-side bids: price, delivery, rating, verification, completed projects, portfolio.

### P1-07 · Customer trust signals for providers

**Class 4** · **M** · deps: none

- Phone verification before awarding (OTP infra is class 1 — wiring only); customer history on the award offer; flag serial abandoners. See `04` §7.

### P1-08 · Enforce business team permissions

**Class 3** · **M** · deps: P0-12

- Seven permissions defined, zero enforcement. Add `requireTeamPermission` alongside `requireRole`.
- **Invariant:** team permissions are additive to identity; never mutate `primary_role`.

### P1-09 · Central entitlement service

**Class 4** · **M** · deps: P1-03

- Checks are scattered across `needs.service`, `jobs.service`, `auth.service`. Single `EntitlementService.can(userId, workspace, capability)`.
- **Never apply a plan benefit in the frontend only.** `canProBadge` / `canTrustedBusinessBadge` are currently computed server-side (correct) but are **plan-purchased, not verification-backed** — see P2-06.

### P1-10 · Team invitation flow end-to-end

**Class 4** · **S** · deps: P0-12

- Raw token emailed as body text; no accept page. Endpoint works, nothing calls it.

### P1-11 · Tag filtering in search

**Class 6** · **S** · deps: none

- `tags TEXT[]` with a GIN index exists and is unused by search. Cheapest high-value search win available.

### P1-12 · Surface AwardOfferCard on the provider dashboard

**Class 2** · **S** · deps: none

- A 222-line working component for the single most important, time-limited provider action, not shown on the dashboard.

---

## P2 — Differentiation

| ID    | Item                                                             | Class | Cx  | Deps  |
| ----- | ---------------------------------------------------------------- | ----- | --- | ----- |
| P2-01 | Extract `ResultCard` + search panel from the 2,430-line monolith | 2     | M   | —     |
| P2-02 | Capability-driven navigation + route guards                      | 4     | M   | P1-03 |
| P2-03 | Admin work-queue home (additive; keep all tabs)                  | 2     | M   | P0-13 |
| P2-04 | Portfolio case studies, before/after media                       | 6     | M   | —     |
| P2-05 | Engineering project metadata (discipline, area, drawings)        | 6     | M   | —     |
| P2-06 | Verification-backed trust badges                                 | 4     | M   | —     |
| P2-07 | BoQ generator, cost estimator, contract templates (MHC-priced)   | 6     | L   | P0-07 |
| P2-08 | Profile spotlight via `featured_provider`                        | 3     | S   | P0-07 |
| P2-09 | Verified-completion MHC rewards                                  | 6     | M   | P1-04 |
| P2-10 | Extend calendar with proposal/milestone/award deadlines          | 2     | M   | P1-04 |
| P2-11 | Negotiations on bids and change requests                         | 4     | M   | —     |
| P2-12 | Notification deduplication + delivery-failure logging            | 6     | S   | —     |
| P2-13 | Member removal + ownership transfer                              | 6     | M   | P0-12 |
| P2-14 | Remove `'admin'` from `UserRole` (own PR, full typecheck)        | 2     | S   | —     |

`backlog.json` carries full metadata for all P0 and P1 items plus P2-01, P2-02, P2-03, P2-06, P2-09, P2-14 and the two deferred entries — 35 items. The remaining P2 rows above are summarised here only; expand them into the JSON when they are scheduled.

**P2-06 note:** never display a badge the backend does not genuinely verify. `canProBadge` is granted by _plan purchase_. Presenting a paid badge next to identity-verification badges implies verification that has not occurred. Either rename it explicitly ("Pro plan") or back it with real signals.

**P2-09 note:** total MHC rewarded per job must be strictly less than MHC charged for that job, enforced in code and tested. See `03` §6.

---

## Deferred modules

| Module                                 | Class               | Rationale                                                                                                                                                                                                                                                   |
| -------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Escrow / customer wallet               | 1 (frozen)          | Code retained and audit-preserved. Re-enabling is a deliberate admin action.                                                                                                                                                                                |
| Automated commission                   | 2                   | `computeCommissionSplit` retained; model abandoned — depends on unverifiable self-reported value.                                                                                                                                                           |
| Integrated payments / split settlement | 6                   | Separate architecture and compliance programme.                                                                                                                                                                                                             |
| Complex business permission matrices   | 3                   | Custom roles exist. Enforce the built-ins first (P1-08).                                                                                                                                                                                                    |
| **Employment jobs**                    | **1 — fully built** | **Not an audit recommendation to defer.** Hiding a class-1 subsystem is a product decision. The audit recommends naming it "Hiring", giving it navigation, and fixing its class-5 escrow settlement. If it is then hidden, that is a deliberate scope call. |
| **Goods / products**                   | **6 — not found**   | Nothing located in schema, API, validation, form, search, dictionaries, any branch, or any stash. See `12` §B.1. **Re-audit before deciding** — this classification is provisional pending a pointer to the implementation.                                 |

---

## Recommended order

**Wave 1 (independent, parallelisable, no schema change):** P0-01, P0-02, P0-05, P0-06, P0-09, P0-11, P0-14, P0-15, P1-11, P1-12

**Wave 2 (schema, sequential):** P0-07 → P0-03, P0-04 · P0-08 · P0-12 → P1-10 · P0-13

**Wave 3 (workflow):** P1-04 → P0-10 · P1-01 · P1-05 · P1-06 · P1-07

**Wave 4 (architecture):** P1-03 → P1-02, P1-09, P2-02 · P1-08

**Wave 5:** remaining P2.
