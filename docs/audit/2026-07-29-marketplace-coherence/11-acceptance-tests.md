# 11 — Acceptance Tests

Tests are grouped by backlog item. **Every money and authorization test is mandatory.**

---

## 0. Regression gates — must pass unmodified

If a change requires editing one of these, the change altered a security or money invariant and needs explicit review.

| Test | Invariant |
|---|---|
| `apps/api/src/tests/mhc.activation-race.test.ts` | Concurrent activations produce exactly one charge |
| `apps/api/src/tests/award-lifecycle.test.ts` | Award state machine correctness |
| `apps/api/src/tests/contact-redaction.test.ts` | Contact masking incl. Arabic-Indic digits |
| `apps/api/src/tests/chat-access.test.ts` | Chat access gate |
| `apps/api/src/tests/needs.bid-chat-gate.test.ts` | Pre-activation bid chat gate |
| `apps/api/src/tests/admin-verification-auth.test.ts` | Admin authorization |
| `apps/api/src/tests/legacy-egp-reset-migration.test.ts` | Wallet freeze holds |
| `apps/web/tests/mhc-presentation.test.ts` | MHC never formatted as currency |

---

## P0-01/02/05/06/09 — Financial UI removal

**Unit — `apps/web/tests/profile-screen-sections.test.ts`**
- `getVisibleProfileSections('customer')` excludes `wallet`
- `getVisibleProfileSections('expert' | 'craftsman' | 'business')` includes the credits section
- `canRequestWithdrawal(r)` is `false` for all four roles

**Component**
- Header renders no balance element for a customer
- Header renders an MHC balance for a provider
- The MHC value contains no currency symbol (`£`, `EGP`, `$`)
- No `+` deposit button exists in the header for any role

**E2E (extend `apps/e2e/specs/05-wallet-payment.spec.ts`)**
- A customer traverses profile, settings and header and encounters no deposit or withdrawal control
- A provider reaches the credits screen in one click from the sidebar
- A customer navigating directly to `/app/credits` is rejected

---

## P0-03 — Ads on MHC

**Mandatory money tests**
- Insufficient MHC → `402`, **no** `advertisements` row created
- Sufficient MHC → ad created, MHC debited exactly once, `transactions` row written with `reference_type='advertisement'`
- **Two concurrent identical creations → exactly one charge** (mirror `mhc.activation-race.test.ts`)
- Ad creation failure after the charge → transaction rolled back, balance unchanged
- **No write to any `account_type='money'` wallet occurs on the ad path**

**Integration**
- Admin sets the ad price via `mhc_action_prices`; the UI reflects it in MHC
- A zero-price ad creates no charge row

---

## P0-04 — Plans off the EGP wallet

- Subscribing to a launch plan succeeds with **no EGP wallet interaction**
- An existing `plan_subscriptions` row continues to resolve entitlements after the change
- A duplicate subscribe request does not double-charge
- `SubscribeToPlanResponse` carries no EGP figure

---

## P0-07 — MHC charge primitive

**Mandatory**
- Concurrent identical `chargeAction` calls → exactly one debit (10 parallel calls, assert one `mhc_action_charges` row)
- Insufficient balance → `402`, no partial state, balance unchanged
- Balance can never go negative — assert the DB constraint fires, not only the application check
- The charge shares the caller's transaction: caller rollback ⇒ charge rolled back
- `refunded_at` set ⇒ balance credited exactly once; a second refund is a no-op

**Regression**
- `mhc.activation-race.test.ts` and `award-lifecycle.test.ts` pass **unmodified**

---

## P0-08 — Retired route guards

**For each of:** `POST /wallet/deposit/checkout`, `/wallet/deposits/instapay`, `/wallet/deposit/crypto`, `/wallet/deposit/stripe`, `/wallet/deposit/confirm-stripe`, `POST /wallet/withdrawals`, `/withdrawals/:id/cancel`, `/withdrawals/:id/verify`, `GET /wallet/withdrawals/quote`
- Returns `410` with a retirement code, for every role
- Returns `410` **even when the settings row lacks the payment-method key** — this is the fail-open trap; assert `isPaymentMethodEnabledStrict` semantics explicitly

**Must remain open**
- `GET /wallet/me` → `200`
- `GET /wallet/me/transactions` → `200`
- `GET /wallet/me/transactions/:id/receipt` → `200`
- NOWPayments and Paymob webhooks still process an in-flight settlement

---

## P0-10 + P1-04 — Completion workflow and reviews

**Authorization (mandatory)**
- A non-participant reading a deliverable → `403`
- A participant reading a deliverable on an **unactivated** job → `402 MHC_ACTIVATION_REQUIRED`
- A participant reading a deliverable on an activated job → `200`
- Creating a milestone on an unactivated need → `402`
- **A deliverable URL is not guessable without passing the gate**

**Workflow**
- Milestone lifecycle: `pending → active → submitted → approved`
- Rejection returns the milestone to `active` with a reason recorded
- Completion requires both `customer_completed_at` and `provider_completed_at`; one alone does not set `status='completed'`

**Reviews**
- A review on a completed, activated need-job succeeds for both parties
- A review on an incomplete need-job → `400`
- A review by a non-participant → `403`
- A second review by the same reviewer on the same need → `409`
- Existing reservation reviews are unaffected

**Schema**
- `need_milestones` and `need_deliverables` contain **no** column referencing `wallet_holds`, `transactions` or any balance

---

## P1-01 — Bid submission fee

**Mandatory money tests**
- Insufficient MHC → `402`, **no bid row created**
- Sufficient MHC → bid created, charged exactly once
- Concurrent double submission → one bid, one charge
- Bid insert fails after charge → both rolled back
- **Editing an existing bid incurs no charge**
- Withdrawing a bid does not refund (unless policy says otherwise — assert the chosen policy)
- **Need expires with no award → every bid fee refunded exactly once**; running the refund sweep twice does not double-refund
- Losing a normal award → **no** refund
- Fee of 0 → no charge row created

**UI**
- Fee, current balance and resulting balance are shown before submission

---

## P0-12 + P1-08 + P1-10 — Business teams

**Authorization (mandatory)**
- A member with `primary_role='expert'` can `GET /api/business-teams/me`
- A non-member → `403`
- A member cannot read a different team's overview
- A member without `manage_services` cannot modify team services → `403`
- A member with `manage_services` can
- **Accepting an invitation never modifies `users.primary_role`** — assert before/after
- A member cannot escalate themselves to owner

**Concurrency**
- Two concurrent first-time `GET /me` calls for one business → exactly one `business_teams` row
- `GET /me` performs no writes after provisioning

**Invitations**
- Accepting via link creates a `business_members` row
- An expired token → rejected
- A used token cannot be reused
- The raw token never appears in a response body or server log

---

## P0-13 — Help & Resolution Center

**Routing**
- Subject "project" + problem "not delivered" on an **activated** need → `case_type='dispute'`
- Same on an **unactivated** need → `case_type='support'` (nothing to dispute yet)
- Subject "account" → always `case_type='support'`
- A dispute cannot be created without `reference_type` and `reference_id` — assert the CHECK fires

**Escalation preserves state (the critical test)**
- Create a support case with 3 messages and 2 attachments
- Escalate
- Assert: same `ticket_id`; all 3 messages present; both attachments present; `case_type='dispute'`; `escalated_at` set

**Visibility**
- Before escalation, `counterparty_id IS NULL` and the counterparty cannot read the case
- After escalation, the counterparty reads `visibility='participants'` messages
- The counterparty **never** reads `visibility='admin'` messages
- A third party reads nothing → `403`

**Migration**
- Backfill is idempotent — running it twice creates no duplicates
- Historic `reservation_disputes` remain readable after phase 4

---

## P1-05 + P0-11 — Notifications

**Producers**
- MHC purchase approved → notification to the provider with the credited amount
- MHC purchase rejected → notification with the reason
- Award activated → notification **to the customer**
- Activation reminders at 50% and 90% of the window; **none after activation or expiry**
- Low balance fires once per crossing, not on every read

**Content and links**
- Every new type renders in **both** `en` and `ar`; `npm run validate:i18n` passes
- No notification body is a hardcoded English string at the producer
- Clicking an award notification opens that award, not `/app`
- No notification links to a retired wallet screen

**Badges**
- An MHC notification does not light the "jobs" badge (the current `else` fallthrough bug)
- Badges derive from `getNotificationCategory()`

---

## P1-03 — Workspaces

**Backward compatibility (mandatory)**
- Every existing endpoint works with **no** `X-Workspace-Id` header
- Absent header resolves the default workspace from `primary_role`
- `users.primary_role` is not dropped

**Authorization (mandatory)**
- Acting in a workspace the user does not belong to → `403`
- A forged `X-Workspace-Id` is rejected by `workspace_members` lookup
- A business cannot bid on a need it posted
- Switching workspaces does not grant access to another workspace's data

**Migration**
- Backfill is deterministic: re-running produces the same result
- Rollback nulls the FKs and drops both tables with no data loss
- Every existing `need` gets a `workspace_id`

---

## Cross-cutting security tests

Run against **every** stage:

1. **No contact leak.** For every endpoint returning need/bid/job data, assert no phone, email, address or payment detail appears in the response when `mhc_job_activations` has no row for that bid.
2. **No authorization regression.** Every route that had a guard before still has it.
3. **No frontend-only enforcement.** For each UI-gated action, call the API directly with a role that should not have it → non-2xx.
4. **No fabricated badges.** Every badge in a response maps to a backend-verified fact. A plan-granted badge is not presented as verification.
5. **Ledger integrity.** After any credit operation: exactly one `transactions` row, balance equals the sum of ledger deltas, no negative balance.

---

## Manual QA — not automatable

- [ ] Arabic RTL rendering on every changed screen
- [ ] Mobile drawer, sidebar and modals at 375px
- [ ] Full workflow walkthrough: post need → bid (fee) → award → activate → contact unlock → milestone → deliverable → approve → complete → review
- [ ] Provider MHC purchase by InstaPay end-to-end, including the notification at each state
- [ ] Admin work queues reflect real pending items
- [ ] No screen shows an EGP figure to a customer
- [ ] Escalating a support case in the real UI preserves the visible conversation

---

## Launch readiness

**Do not treat green lint, typecheck and unit tests as launch readiness.** All of the following must also hold:

- [ ] No dead customer-facing financial interface anywhere
- [ ] Every MHC action is idempotent and race-safe, with a test proving it
- [ ] Contact data is unreachable before activation, proven by direct API probing
- [ ] The primary workflow completes end-to-end, including review
- [ ] Every launch-critical event produces a notification with a working deep link
- [ ] Every permission is enforced server-side
- [ ] Every plan benefit is enforced server-side
- [ ] No badge implies unperformed verification
- [ ] Every schema change has a tested rollback
- [ ] Support and disputes share one entry point, with escalation preserving the thread
- [ ] Navigation labels match their destinations
- [ ] The goods/products question is resolved (see `12` §B.1)
