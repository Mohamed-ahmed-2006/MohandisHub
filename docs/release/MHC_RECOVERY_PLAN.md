# Part A — MHC Recovery Plan

**Baseline commit:** `f7fda17` "WIP: preserve Claude unfinished MHC changes"
**Status:** plan only. No application code has been modified.
**Date:** 2026-07-28

---

## A1. The intended MHC flow (reconstructed from repository evidence)

This is what session 1 was building, reconstructed from code, SQL comments, and the
shape of the tables. It is **not** invented — every element below is traceable to a file.
Where the intent is genuinely ambiguous, it is listed in `DECISIONS_REQUIRED.md` instead
of being guessed at.

```
                          ┌───────────────────────────────────────┐
                          │  Provider buys MHC (manual InstaPay)  │
                          │  deposit_requests.purpose =           │
                          │    'credit_purchase'                  │
                          │  status: pending_review                │
                          └──────────────┬────────────────────────┘
                                         │  admin approves
                                         ▼
                          ┌───────────────────────────────────────┐
                          │  MHC granted to provider_credit wallet│
                          │  transactions.type = 'deposit'        │
                          │  reference_type = 'mhc_credit_purchase'│
                          └──────────────┬────────────────────────┘
                                         │
  customer posts need ──► providers bid ─┤
                                         │
                     customer awards a bid (an OFFER, charges nothing)
                                         ▼
              needs.status = 'awarded_pending_provider_acceptance'
              needs.pending_award_bid_id / pending_award_expires_at set
              needs.awarded_bid_id = NULL
              bids.status = 'awarded_pending'
              all other bids -> 'rejected'
                                         │
                    ┌────────────────────┴────────────────────┐
                    │                                         │
        provider ACCEPTS + pays MHC                provider DECLINES / offer expires
                    │                                         │
                    ▼                                         ▼
   ONE transaction (mhc.repository.chargeActivation):     no MHC charged
     - debit provider MHC wallet                          bids.status -> rejected|expired
     - transactions.type = 'payment'                      needs.status -> 'open'
     - INSERT mhc_job_activations (unique per bid)         pending_award_* cleared
     - bids.status -> 'accepted'
     - needs.status -> 'awarded'
     - needs.awarded_bid_id = bid
     - needs.activated_at = now()
                    │
                    ▼
   GATE OPENS: contact details, attachments, exact address,
               and provider direct-payment details become visible
                    │
                    ▼
   customer pays the provider DIRECTLY, off-platform
   (platform never holds job money)
                    │
                    ▼
   awarded -> in_progress -> completed (customer-attested) -> review
```

**Invariants the design intends (VERIFIED from code comments and constraints):**

| #   | Invariant                                                        | Enforced today?                                   |
| --- | ---------------------------------------------------------------- | ------------------------------------------------- |
| I1  | MHC is never withdrawable, transferable, or convertible to money | Yes — no code path exists to do so                |
| I2  | A provider is never charged for a job they did not accept        | Yes — charge is provider-initiated                |
| I3  | Credits taken and job opened commit together or not at all       | Yes — single transaction                          |
| I4  | At most one activation charge per bid / per reservation          | Yes — partial unique indexes                      |
| I5  | Balance can never go negative                                    | Yes — `FOR UPDATE` + pre-check + CHECK constraint |
| I6  | Contact details are invisible before activation                  | **No — see MHC-05, MHC-06, MHC-07**               |
| I7  | The customer can pay the provider after activation               | **No — see MHC-04**                               |
| I8  | A stale offer cannot be activated                                | Partially — see MHC-03, MHC-14                    |

Invariants I6 and I7 are the model's entire commercial premise, and neither holds.

---

## A2. What session 1 completed correctly (VERIFIED)

Recording this explicitly so the recovery does not needlessly rewrite sound work.

1. **The ledger core is correct.** `mhc.repository.chargeActivation` and
   `fulfillCreditPurchase` both open an explicit transaction, take `SELECT ... FOR UPDATE`
   on the wallet row, check balance before debiting, write a matching `transactions` row
   with signed `balance_delta`, and commit atomically. I found **no** live double-credit,
   double-spend, or negative-balance path.
2. **Idempotency is real, not decorative.** `uq_mhc_activation_award` (partial, on
   `bid_id`) and `uq_mhc_activation_booking` (partial, on `reservation_id`) enforce
   single-charge at the database level, not just in application logic.
3. **Purchase fulfilment locks before deciding.** `fulfillCreditPurchase` takes
   `FOR UPDATE` on the `deposit_requests` row before reading `status`, so two concurrent
   admin approvals cannot both grant.
4. **The reuse of the existing ledger is legitimate.** MHC uses
   `transactions.type IN ('deposit','payment','adjustment')`, all of which are permitted by
   `transactions_type_check_publish_ready` (VERIFIED in
   `20260610132000_backend_only_rls_storage_indexes.sql:169`). The migration comment's
   claim that the type CHECK did not need changing is correct.
5. **`redactContactDetails` is genuinely good.** It normalises Arabic-Indic and Extended
   Arabic-Indic digits, handles separator obfuscation, matches Arabic-script messaging-app
   names without relying on `\b` (which cannot work for Arabic), and catches spelled-out
   digit runs. Its own doc comment correctly describes it as defence in depth rather than
   enforcement.
6. **Escrow retirement is fail-closed.** `isPaymentMethodEnabledStrict` was added
   specifically so an absent settings key cannot silently reopen a retired money rail,
   and `parsePaymentMethodsEnabled` was changed so the legacy `disable_*` columns are
   one-way switches. That is careful work.
7. **Contact-leak hardening in list queries.** `COALESCE(u.display_name, u.email)` was
   replaced with `COALESCE(u.display_name, 'Customer'|'Provider')` in `listOpenNeeds`,
   `getNeedById`, `listBidsForNeed`, and the plan-aware variant, and `expert_email` was
   dropped from every `SELECT`. This closed a real pre-existing leak.

---

## A3. Severity ranking scheme

| Rank                                | Meaning                                                                |
| ----------------------------------- | ---------------------------------------------------------------------- |
| **1 — Launch blocker**              | The product cannot be operated by real users at all.                   |
| **2 — Revenue / security critical** | Users can bypass the paywall, or see data they must not.               |
| **3 — Data-safety critical**        | Existing balances, historical records, or migrations are at risk.      |
| **4 — Functional defect**           | A flow behaves incorrectly but is neither exploitable nor destructive. |
| **5 — Cleanup / technical debt**    | Correctness unaffected. Deferred by default.                           |

Findings are listed in rank order. Within a rank, most urgent first.

---

## RANK 1 — LAUNCH BLOCKERS

### MHC-04 — There is no customer→provider payment path _(the central blocker)_

**Exact current behaviour (VERIFIED).**
Migration `20260728120000` creates `provider_payment_methods` (bank/InstaPay/mobile-wallet
rails with a `details JSONB` column documented as "revealed to a customer only after MHC
activation"). Migration `20260728160000` creates `provider_payment_disclosures` as an audit
trail of who saw which details. A repository-wide search for both table names returns
**only the migration files** — no controller, service, repository, route, or React
component references either table. Simultaneously, `needs.service.payBid` now throws
`ESCROW_PAYMENTS_RETIRED` (410) and every deposit/withdrawal/escrow rail is set to `false`.

**Intended behaviour.**
After the provider activates the job, the customer sees the provider's payment details and
pays them directly. The disclosure is recorded in `provider_payment_disclosures`.

**Files involved.** New: `apps/api/src/modules/mhc/provider-payment-methods.{controller,service,repository,routes}.ts`
(or a sibling module). Modified: `apps/api/src/routes/index.ts`, `apps/api/src/modules/needs/needs.service.ts`
(to surface details on the job view). New web: provider payment-method management UI and
the customer-facing post-activation panel.

**Database impact.** None — both tables already exist with appropriate indexes and a
uniqueness constraint. `provider_payment_disclosures` already has RLS enabled and
`anon`/`authenticated` revoked.

**Risk of the change.** Medium. This endpoint hands one user another user's financial
details; the ownership and activation checks must be exactly right, and the disclosure
must be recorded before the details are returned, not after.

**Tests required.** Unit: only the customer on an activated job receives details; a
non-participant gets 403; an unactivated job gets 402; disclosure row is written exactly
once per (activation, customer). Integration: full award → activate → disclose sequence.

**Business decision required.** **Yes — D5.** What exactly is disclosed, to whom, and
whether the provider must configure a method before they are allowed to activate.

---

### MHC-01 — The entire MHC feature has no user interface

**Exact current behaviour (VERIFIED).** No file under `apps/web` was modified by `f7fda17`.
A case-insensitive search of `apps/web/app`, `apps/web/components`, and `apps/web/lib` for
`mhc` or `/credits` returns one hit: a binary PNG. `customer-dashboard.tsx` branches only on
`need.status === 'awarded'` (lines 867 and 966), so a need in
`awarded_pending_provider_acceptance` renders no award UI at all.

Consequently, no user can: view an MHC balance, see packages or action prices, submit an
InstaPay purchase, accept or decline an award offer, see that an offer is pending, or (for
admins) review credit purchases and configure pricing. All of it exists only as HTTP
endpoints.

**Intended behaviour.** The flows in A1 are reachable from the product.

**Files involved.** New web routes for provider credits (balance, history, purchase),
provider award-acceptance, and admin credit review + pricing. Modified:
`apps/web/components/app/customer-dashboard.tsx`, `apps/web/lib/needs/client.ts`, and the
provider dashboard. Arabic and English strings for every new surface.

**Database impact.** None.

**Risk of the change.** Low technically, large in volume. The main risk is contract drift:
the web layer's hand-written types must match the API responses, and the compiler will not
catch a mismatch on an optional field.

**Tests required.** Component tests for the pending-award and insufficient-credits states;
i18n validation (`npm run validate:i18n`) for every new string; manual RTL/LTR pass.

**Business decision required.** No, once D2–D5 are settled (they determine what the UI must
show).

---

### MHC-03 — Award offers never expire

**Exact current behaviour (VERIFIED).** `needs.service.awardBid` sets
`pending_award_expires_at` (to `now() + N hours`, or `'infinity'::timestamptz` when the
admin sets 0 hours). `needs.repository.listExpiredPendingAwards` exists to sweep them.
`apps/api/src/worker.ts` starts only `startReservationLifecycleWorker` and
`startRetentionWorker`; `listExpiredPendingAwards` has **no caller anywhere in the
repository**. The expiry timestamp and its supporting index `idx_needs_pending_award_expiry`
are therefore inert.

An ignored offer holds the need in `awarded_pending_provider_acceptance` indefinitely. The
customer is not fully stuck — `awardBid` accepts a need in that status and can re-award —
but the state never self-corrects, no notification fires, and the provider keeps a live
offer forever.

**Intended behaviour.** Per D4.

**Files involved.** `apps/api/src/worker.ts`, a new
`apps/api/src/modules/mhc/award-expiry.worker.ts`, and one of the two duplicate release
implementations (see MHC-21).

**Database impact.** None — column and index already exist.

**Risk of the change.** Medium. A sweep that releases an award while a provider is mid-payment
would be a bad outcome; the release must be conditional (`WHERE status = 'awarded_pending'`)
and must not race the activation transaction. Both existing release implementations already
use the correct conditional `WHERE`.

**Tests required.** Unit: an expired offer is released and the need returns to `open`; a
non-expired offer is untouched; `'infinity'` offers are never swept; a concurrent
activate-vs-expire race resolves to exactly one outcome.

**Business decision required.** **Yes — D4.**

---

### MHC-02 — The test suite is red

**Exact current behaviour (VERIFIED by running `npm test`).** 6 failures / 176 tests.

- `mhc.service.test.ts` — 5 failures. The shared fixture at line 173 uses
  `bid_status: 'accepted'`, `need_status: 'awarded'`, but `activateAwardForProvider`
  (`mhc.service.ts:360-370`) now requires `need_status === 'awarded_pending_provider_acceptance'`,
  `pending_award_bid_id === bid_id`, and `bid_status === 'awarded_pending'`. Every test that
  expects to reach the charging logic instead gets `BID_NOT_AWARDED` (409). Notably, the
  "blocks activation when the credit wallet is frozen" test no longer exercises the frozen-wallet
  path at all, so **that protection is currently untested**.
- `needs.service.test.ts` — 1 failure. The `payBid` idempotency test now hits
  `ESCROW_PAYMENTS_RETIRED` (410).

**Intended behaviour.** Tests assert the post-refactor contract.

**Files involved.** `apps/api/src/tests/mhc.service.test.ts`,
`apps/api/src/tests/needs.service.test.ts`.

**Database impact.** None.

**Risk of the change.** Low, with one caveat that matters: the fixtures must be updated to
the _intended_ contract, not bent until they pass. The frozen-wallet and insufficient-credits
assertions must be restored to actually reach the code they claim to test.

**Tests required.** This finding _is_ test work. The `payBid` test should be re-expressed as
"the retired escrow rail returns 410" plus a preserved idempotency test behind the flag, so
the historical behaviour stays covered if the rail is ever re-enabled — subject to D6.

**Business decision required.** Partially — **D6** determines whether the escrow idempotency
test is preserved behind a flag or deleted.

---

## RANK 2 — REVENUE / SECURITY CRITICAL

### MHC-05 — General chat bypasses the activation gate completely

**Exact current behaviour (VERIFIED).** `POST /api/chat/conversations`
(`chat.routes.ts` → `chat.controller.startConversation` → `chat.service.startConversation`,
lines 173-185) accepts an arbitrary `otherUserId` and calls
`repo.findOrCreateConversation(userId, otherUserId)`. The only guard is `status.pauseChat`.
There is no participant restriction, no relationship requirement, no redaction, and no
consultation of `ActivationGateService`.

Any authenticated, email-verified user can therefore open a direct conversation with any
other user and exchange phone numbers freely. Since providers are discoverable by browsing
and their user IDs are returned by public profile endpoints, this defeats the bid-message
redaction entirely and makes the MHC paywall optional.

**Intended behaviour.** Per D2.

**Files involved.** `apps/api/src/modules/chat/chat.service.ts`,
`chat.repository.ts`, `chat.socket.ts`, and possibly `chat.routes.ts`.

**Database impact.** Depends on D2. Redaction-in-chat would need columns mirroring
`bid_messages.contact_redacted` / `raw_content`. Restricting who may start a conversation
needs no schema change.

**Risk of the change.** High — chat is a live, user-visible feature with an existing socket
layer. Restricting it will break flows that currently work, and over-restricting it will
make legitimate support and pre-sales conversation impossible.

**Tests required.** Unit tests per branch of the chosen rule; socket-path tests (the socket
layer must not be a second bypass of whatever the HTTP layer enforces).

**Business decision required.** **Yes — D2.** This is the highest-value decision in the set.

---

### MHC-06 — The activation gate is never actually asserted

**Exact current behaviour (VERIFIED).** `ActivationGateService` defines
`assertAwardActivated`, `assertBookingActivated`, and `resolveDisclosureLevelForBid`. A
repository-wide search shows **zero callers** for all three. The only methods of the service
that are used anywhere are `isGateEnabled`, `isContactMaskingEnabled`, and
`getAwardAcceptanceExpiryHours`, all called from `needs.service.ts`.

The service's own header comment states that every endpoint capable of revealing privileged
job data "MUST consult this service". None do. The enforcement layer was designed and
written but never wired in.

Today this is mitigated by accident rather than design: `expert_email` was removed from
every `SELECT`, and public profiles do not expose phone or email (VERIFIED — see MHC-09 for
what they _do_ expose). So there is no single dramatic leak through these endpoints right
now. But nothing prevents the next `SELECT` from reintroducing one, and the gate exists
precisely to make that structurally impossible.

**Intended behaviour.** Every endpoint that can reveal contact details, exact address,
private attachments, or provider payment details calls the gate first.

**Files involved.** `apps/api/src/modules/needs/needs.service.ts`,
`apps/api/src/modules/reservations/*`, the new provider-payment-methods module (MHC-04),
`apps/api/src/modules/media`/`upload` for private attachments.

**Database impact.** None.

**Risk of the change.** Medium. Adding assertions to existing endpoints will start returning
402 where callers previously got 200; the web layer must handle that before the API does it.

**Tests required.** One test per guarded endpoint asserting 402 pre-activation and 200
post-activation. This is the test set that makes the paywall a durable property rather than
a coincidence.

**Business decision required.** No for the mechanism; **D3** determines the scope for losing
bidders.

---

### MHC-07 — Post-activation unlock is need-scoped, so losing bidders' chats unlock too

**Exact current behaviour (VERIFIED).** `needs.service.listBidMessages` computes
`const unlocked = need.activated_at != null || !(await this.activationGate.isGateEnabled())`
and, when unlocked, returns `content: m.raw_content ?? m.content` for every message.

`activated_at` is a column on **`needs`**, not on `bids`. Once any bid on a need is
activated, `listBidMessages` returns unredacted `raw_content` for **every bid thread on that
need** — including the threads of providers whose bids were rejected, who paid nothing.

The same need-scoped condition governs `createBidMessage`, so losing bidders also regain the
ability to post unredacted text and attachments after someone else pays.

**Intended behaviour.** Per D3. At minimum, the unlock condition must be evaluated per bid
(an `mhc_job_activations` row for _this_ `bid_id`), not per need.

**Files involved.** `apps/api/src/modules/needs/needs.service.ts` (`listBidMessages`,
`createBidMessage`).

**Database impact.** None — `mhc_job_activations.bid_id` already provides the per-bid fact.

**Risk of the change.** Low. Narrowing the condition is a small, well-contained edit. The
risk is that the awarded provider's own thread must remain unlocked, which the per-bid
check preserves correctly.

**Tests required.** Unit: awarded bid's thread unlocks; a losing bid's thread on the same
need stays redacted and rejects attachments; historical messages with `raw_content IS NULL`
fall back to `content` without error.

**Business decision required.** **Yes — D3**, for the broader question of whether losing
bidders keep any access at all.

---

### MHC-08 — Booking / reservation activation is never charged

**Exact current behaviour (VERIFIED).** `MhcService.activateBooking` exists and is fully
implemented, `mhc_job_activations` supports `activation_type = 'booking'` with a unique index
on `reservation_id`, and the `booking_activation` action key is seeded. `activateBooking` has
**no callers**. `mhc.routes.ts` exposes award activation endpoints only — there is no booking
equivalent. `assertBookingActivated` is likewise uncalled.

A provider who receives work through the reservations/bookings path therefore pays nothing
and is gated by nothing, while a provider who receives work through the bids path pays. The
revenue model has a second, unpriced door.

**Intended behaviour.** Bookings are charged and gated on the same basis as awards.

**Files involved.** `apps/api/src/modules/reservations/reservations.service.ts`,
`reservations.routes.ts`, `apps/api/src/modules/mhc/mhc.routes.ts`, `mhc.controller.ts`.

**Database impact.** None.

**Risk of the change.** Medium-high. The reservations lifecycle has its own worker, its own
dispute path, and its own money handling that I have not yet deep-read. Charging MHC inside
it must not conflict with existing reservation state transitions.

**Tests required.** Mirror of the award-activation set, plus reservation-lifecycle regression.

**Business decision required.** **Yes, implicitly.** Whether bookings are in scope for launch
at all is a scope question — see `KNOWN_LIMITATIONS.md`. If bookings ship, they need a price
and a gate; if they do not, the path should be disabled rather than left free.

---

### MHC-09 — Public profiles expose off-platform contact channels

**Exact current behaviour (VERIFIED).** `GET /api/profiles/public/:userId`
(`profiles.service.getPublicProfile`, lines 1034-1163) does **not** expose phone or email
for any role — that is correct and worth stating. However it does return:

- expert: `linkedinUrl`, `portfolioUrl`
- business: `website`
- all roles: `displayName`, `avatarUrl`, city, country

**INFERRED risk:** a LinkedIn profile, portfolio site, or company website is a working
off-platform contact channel. A customer can reach a provider through any of them without
an award, without activation, and without the platform seeing it. This is a softer bypass
than MHC-05 but it is the same category.

**Intended behaviour.** Per D5 — specifically, whether these fields are legitimate
marketing surface (a portfolio is arguably the point of a provider profile) or a gate leak.

**Files involved.** `apps/api/src/modules/profiles/profiles.service.ts`,
`profiles.types.ts`, and the web profile components.

**Database impact.** None.

**Risk of the change.** Low technically; potentially significant commercially, since hiding
a portfolio may reduce provider conversion.

**Tests required.** Snapshot test of the public profile payload per role, asserting the
agreed field set.

**Business decision required.** **Yes — D5** (secondary part).

---

## RANK 3 — DATA-SAFETY CRITICAL

### MHC-10 — The migration freezes every EGP wallet while all withdrawal rails are off

**Exact current behaviour (VERIFIED).** `20260728160000_mhc_activation_gate_and_launch_model.sql`
lines 147-150 execute unconditionally:

```sql
UPDATE public.wallets
SET is_frozen = true
WHERE account_type = 'money';
```

The same migration sets `withdrawal_instapay`, `withdrawal_crypto`, `withdrawal_paymob`,
and every deposit rail to `false`.

Combined effect: every user's EGP balance becomes simultaneously unspendable (frozen),
un-toppable (deposits off), and un-withdrawable (withdrawals off). Any real money currently
held is stranded with no user-facing path out.

**INFERRED but important:** I do not know whether production holds non-zero EGP balances.
This must be established with a read-only query **before** the migration is ever applied to
production:

```sql
SELECT count(*) AS wallets_with_balance,
       COALESCE(sum(balance), 0) AS total_egp
FROM public.wallets
WHERE account_type = 'money' AND balance > 0;
```

If that returns zero, MHC-10 is a non-issue and the freeze is exactly right. If it returns
non-zero, applying this migration as written creates a customer-liability problem.

**Intended behaviour.** Per D1.

**Files involved.** `supabase/migrations/20260728160000_...sql`, plus whatever settlement
mechanism D1 selects.

**Database impact.** Direct and significant. Any corrective migration must be additive and
must not delete or rewrite historical `transactions` rows.

**Risk of the change.** High — this is real user money.

**Tests required.** A migration replay test against a seeded database containing non-zero
balances, asserting the chosen D1 outcome. Balances and transaction history must be
byte-identical before and after for any wallet the policy does not intend to change.

**Business decision required.** **Yes — D1. This is the first question that must be
answered.**

---

### MHC-11 — A new unique index may abort the migration on production data

**Exact current behaviour (VERIFIED).** `20260728120000` lines 191-193 create:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_requests_instapay_reference
  ON public.deposit_requests(provider, lower(btrim(transfer_reference)))
  WHERE transfer_reference IS NOT NULL AND provider = 'instapay_manual';
```

`provider = 'instapay_manual'` is **not** exclusive to MHC purchases — the legacy manual
InstaPay wallet top-up rail uses the same provider value, and `transfer_reference` was added
for that rail in `20260627120000`. The index therefore spans historical wallet deposits as
well as new credit purchases.

**INFERRED:** if any two historical `instapay_manual` deposit requests share a normalised
transfer reference (which is plausible — bank references are not globally unique, and users
retry), `CREATE UNIQUE INDEX` will fail and abort the migration. Read-only check to run
before applying:

```sql
SELECT lower(btrim(transfer_reference)) AS ref, count(*)
FROM public.deposit_requests
WHERE provider = 'instapay_manual' AND transfer_reference IS NOT NULL
GROUP BY 1 HAVING count(*) > 1;
```

A secondary consequence even if it succeeds: a legacy wallet top-up reference now blocks an
unrelated MHC purchase that reuses the same reference string, producing a confusing
`MHC_TRANSFER_REFERENCE_ALREADY_USED` error.

**Intended behaviour.** The uniqueness constraint should be scoped to
`purpose = 'credit_purchase'` so it protects MHC purchases without entangling legacy rows.

**Files involved.** A new additive migration that drops and recreates the index with the
narrower predicate. The original migration file should not be edited if it has already been
applied anywhere.

**Database impact.** Index-only. Non-destructive.

**Risk of the change.** Low, provided the original migration has not yet been applied to
production. If it has, the corrective migration must handle both states.

**Tests required.** Migration replay against a seeded database containing duplicate legacy
references.

**Business decision required.** No.

---

### MHC-12 — Credit purchases can be fulfilled from non-paid states

**Exact current behaviour (VERIFIED).** `fulfillCreditPurchase` returns early only for
`status IN ('paid','completed')` (already fulfilled) and `('rejected','cancelled')`
(refused). Everything else falls through to the grant.

Per `deposit_requests_provider_status_check_publish_ready`
(`20260610132000_...sql:186`), the permitted status set is
`('pending','paid','expired','failed','cancelled','pending_review','rejected','completed','underpaid')`.

So a purchase sitting in `expired`, `failed`, or `underpaid` — three states that
specifically mean _money did not arrive as expected_ — will be granted in full if an admin
clicks approve. Separately, `fulfilPurchaseFromWebhook` passes `providerStatus` straight
through and **never checks that it signifies payment**, so wiring it to a webhook as-is would
credit on any callback, including a failure callback.

**Mitigating fact (VERIFIED):** `fulfilPurchaseFromWebhook` currently has no callers, and
`credit_purchase_nowpayments` is set to `false`. This is a latent hazard, not a live one.

**Intended behaviour.** Fulfilment is permitted only from `('pending','pending_review')`,
and the webhook path additionally requires an explicit allow-list of provider statuses that
mean "settled".

**Files involved.** `apps/api/src/modules/mhc/mhc.repository.ts` (`fulfillCreditPurchase`),
`mhc.service.ts` (`fulfilPurchaseFromWebhook`, `approvePurchase`).

**Database impact.** None.

**Risk of the change.** Low. Tightening an unreached branch.

**Tests required.** Unit: approving an `expired`/`failed`/`underpaid` purchase is refused;
approving a `pending_review` purchase grants exactly once; a second approval grants nothing;
a webhook with a non-settled status grants nothing.

**Business decision required.** No — but the `overrideMhcAmount` admin path (an admin
granting a corrected amount for a short or over payment) is adjacent to D1's accounting
questions and should be reviewed at the same time.

---

### MHC-13 — Migration application is manual and unordered

**Exact current behaviour (VERIFIED).** 83 SQL files in `supabase/migrations/` with no
runner in `package.json`, alongside `docs/ALL_SUPABASE_MIGRATIONS_FOR_SQL_EDITOR.txt`,
`ALL_SUPABASE_MIGRATIONS_IDEMPOTENT_COPY.sql`, and `ALL_SUPABASE_MIGRATIONS_PURE.sql` —
which strongly implies migrations are pasted into the Supabase SQL editor by hand.

**INFERRED:** there is no record of which migrations have been applied to which environment.
`20260728160000` depends on `20260728120000` having run (it validates a constraint that the
earlier file creates `NOT VALID`, and updates `wallets.account_type` which the earlier file
adds). Applied out of order or partially, the second migration fails or silently skips —
its `VALIDATE CONSTRAINT` block catches `undefined_object` and only raises a `NOTICE`.

**Intended behaviour.** A recorded, ordered, verifiable migration state per environment.

**Files involved.** `scripts/`, `package.json`, the aggregate docs files.

**Database impact.** Introducing a migration-tracking table is additive.

**Risk of the change.** Medium — reconciling an existing hand-applied database against a
tracking table requires care and must not re-run applied migrations.

**Tests required.** A CI check that replays all migrations against an empty database.

**Business decision required.** No, but it needs your confirmation of **which migrations are
already applied to production**, which only you can supply.

---

## RANK 4 — FUNCTIONAL DEFECTS

### MHC-14 — Time-of-check/time-of-use gap in award activation

**VERIFIED.** `activateAwardForProvider` validates ownership, pending state, and expiry with
an **unlocked** `SELECT` (`mhc.service.ts:318-383`). It then calls `chargeActivation`, which
opens its own transaction and executes:

```sql
UPDATE bids  SET status = 'accepted', ... WHERE id = $1
UPDATE needs SET status = 'awarded', awarded_bid_id = $1, activated_at = now(), ... WHERE id = $2
```

with no re-check that the need is still `awarded_pending_provider_acceptance` for this bid.
Between the validating read and the transaction, the customer may have re-awarded to another
provider. The unique index prevents charging the _same_ bid twice, but it does not prevent an
`UPDATE` that overwrites a newer award.

**Intended.** The state checks belong inside the charging transaction, with
`SELECT ... FOR UPDATE` on the need, and the `UPDATE`s must carry guard predicates
(`WHERE id = $2 AND status = 'awarded_pending_provider_acceptance' AND pending_award_bid_id = $1`)
with a zero-rowcount abort.

**Files.** `mhc.repository.ts` (`chargeActivation`), `mhc.service.ts`.
**DB impact.** None. **Risk.** Low-medium — must not break the existing idempotent
"already activated" return path. **Tests.** Concurrency test: award A, re-award to B, then
A activates → must fail cleanly with no charge. **Decision required.** No.

### MHC-15 — `updateNeedSchema` status enum omits the new state

**VERIFIED.** `needs.validation.ts:27` lists `['open','closed','awarded','in_progress','completed']`.
Impact is low: it prevents a customer from _setting_ the pending status via PATCH, which is
correct behaviour anyway, and the transition map reads `from` out of the database. Recorded
for consistency; fix alongside MHC-16.
**Decision required.** No.

### MHC-16 — Two divergent "active needs" quota counts

**VERIFIED.** `needs.repository.countActiveNeedsByCustomer` was updated to include
`awarded_pending_provider_acceptance`; `plans.service.ts:424` was not, and still counts
`('open','awarded','in_progress')`. The same customer therefore has two different active-need
counts depending on which code path enforces the plan limit.
**Files.** `apps/api/src/modules/plans/plans.service.ts`. **DB impact.** None. **Risk.** Low.
**Tests.** Assert both paths agree for a need in each status. **Decision required.** No.

### MHC-17 — Closing a need with a pending award leaves orphaned state

**VERIFIED.** `assertNeedStatusTransition` permits
`awarded_pending_provider_acceptance → closed`. `updateNeed` then writes only `status`. The
`chk_needs_pending_award_shape` CHECK is conditional on the pending status, so the write
succeeds and leaves `pending_award_bid_id`, `pending_award_at`, and `pending_award_expires_at`
populated on a closed need, with the bid stranded in `awarded_pending`.

The stranded bid is counted by `countActiveBidsOnNeed` (which was updated to include
`awarded_pending`), permanently consuming a slot. The provider cannot activate it —
`activateAwardForProvider` requires the pending need status — but nothing ever cleans it up
or tells them.
**Files.** `needs.service.ts` (`updateNeed`). **DB impact.** None; a one-off additive cleanup
migration may be warranted if such rows already exist. **Risk.** Low. **Tests.** Closing a
need with a pending award clears pending fields and releases the bid. **Decision required.**
No.

### MHC-18 — Losing bids are rejected at offer time, before the offer is accepted

**VERIFIED.** `awardBid` sets every other bid to `'rejected'` and notifies each provider
"Bid not selected" _at the moment the offer is made_ — before the chosen provider has
accepted or paid. If the offer is then declined or expires, the need returns to `open` with
every other bid already rejected and every other provider already told they lost.

Re-awarding technically works, because `awardBid` accepts a bid in `rejected` status. But
the second provider receives a "not selected" notification followed later by an award, and
the need shows no live bids in between.
**Files.** `needs.service.ts` (`awardBid`), `needs.repository.ts`. **DB impact.** Possibly a
new bid status such as `'on_hold'`, which would require extending `bids_status_check` — a
non-destructive `ALTER`. **Risk.** Medium — touches the award transaction. **Tests.**
Decline-then-reaward and expire-then-reaward sequences. **Decision required.**
**Yes — folded into D4**, since the right answer depends on whether offers expire.

### MHC-19 — Paid advertisements are unreachable at launch

**VERIFIED.** `advertisements.service.ts` charges the **EGP money wallet**
(`walletRepo.findByUserId` → `debitWalletInTransaction`, lines 41-90). Migration
`20260728160000` freezes every money wallet and disables every deposit rail. A paid ad
therefore fails: the wallet is frozen and cannot be funded.

Free ads still work — `DEFAULT_AD_CONTROLS.pricePerDay` is `0` and the debit is guarded by
`if (amount > 0)`. But `findByUserId` is called unconditionally before that guard and throws
402 "Wallet is required to create advertisement" when no money wallet row exists, so a
provider who has never had an EGP wallet cannot create even a free ad.

Meanwhile `mhc_action_prices` seeds `advertisement`, `service_promotion`, `featured_provider`,
and `promoted_proposal` action keys — all inactive at price 0, and **none consumed by any
code**. The intent to move ads onto MHC is visible and unimplemented.
**Files.** `apps/api/src/modules/advertisements/advertisements.service.ts`. **DB impact.**
None. **Risk.** Medium — ad refunds also move EGP and would need the same treatment.
**Tests.** Ad purchase charged in MHC; refund path; free-ad path with no wallet row.
**Decision required.** **Yes — D6** (what happens to remaining EGP-denominated features).

---

## RANK 5 — CLEANUP / TECHNICAL DEBT

Deferred by default. Listed so they are not rediscovered as new findings.

- **MHC-21 — Duplicate, divergent implementations of the same transitions.**
  `needs.repository.markAwardAcceptedInTransaction` duplicates the award-acceptance SQL that
  `mhc.repository.chargeActivation` inlines; `needs.repository.releasePendingAward` duplicates
  `mhc.repository.releasePendingAwardForBid`; `needs.repository.listExpiredPendingAwards` is
  unused; `MhcRepository.grantCredits` duplicates the grant that `fulfillCreditPurchase`
  inlines. All four are dead. Two implementations of a money-adjacent state transition is a
  standing hazard: a future fix applied to one will silently miss the other. Consolidate when
  MHC-03 is implemented (the expiry worker must choose one of the two release paths anyway).
- **MHC-22 — `mhc_tiered_pricing_implementation_prompt.md`** (850 lines) sits at the
  repository root. It is a future proposal and explicitly out of scope. It should move under
  `docs/` so it is not mistaken for an active specification.
- **MHC-23 — MHC wallets carry `currency = 'EGP'`.** `getOrCreateCreditWallet` inserts
  `'EGP'` into `wallets.currency` for a `provider_credit`/`MHC` account. Harmless today
  because `asset_code` is the authority, but it will mislead any report that groups by
  `currency`.
- **MHC-24 — Numeric width mismatch.** MHC columns are `NUMERIC(14,2)`;
  `transactions.amount` and `balance_delta` are `NUMERIC(12,2)`. Only reachable with absurd
  values, but the ledger cannot represent the full range the MHC tables permit.
- **MHC-25 — `getMyCredits` creates a wallet row as a side effect of a read.** Any provider
  loading the credits page gets a `provider_credit` wallet row whether or not they ever buy
  credits. Harmless, but a read endpoint that writes is worth knowing about.

---

## A4. Minimal MHC recovery path

The smallest sequence that restores a **coherent, enforced, usable** end-to-end flow. It
deliberately omits bookings (MHC-08), advertisements-on-MHC (MHC-19), the crypto purchase
rail, and all Rank 5 cleanup.

Each step is one commit, verified before the next begins.

| Step   | Work                                                                                                                                                                                                                      | Findings closed                        | Blocked by                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------- |
| **M0** | Read-only production checks: EGP balances (MHC-10), duplicate InstaPay references (MHC-11), applied-migration inventory (MHC-13). Produces the evidence D1 needs.                                                         | —                                      | Nothing. **Can start now.**                   |
| **M1** | Repair the test suite to the intended contract. Restore the frozen-wallet and insufficient-credits assertions so they actually reach the code they test.                                                                  | MHC-02                                 | D6 (partial — affects one `payBid` test only) |
| **M2** | Correct the migration hazards: narrow `uq_deposit_requests_instapay_reference` to `purpose = 'credit_purchase'`; tighten `fulfillCreditPurchase` to fulfil only from `pending`/`pending_review`. Additive migration only. | MHC-11, MHC-12                         | Nothing                                       |
| **M3** | Make the gate real: per-bid unlock instead of need-scoped; wire `assertAwardActivated` into every privileged read; close the TOCTOU by moving state checks inside the charging transaction with guarded `UPDATE`s.        | MHC-06, MHC-07, MHC-14                 | D3                                            |
| **M4** | Build the provider direct-payment rail: CRUD for `provider_payment_methods`, activation-scoped disclosure writing `provider_payment_disclosures`. **This is what makes the launch model function at all.**                | MHC-04                                 | D5                                            |
| **M5** | Close the chat bypass per the chosen rule.                                                                                                                                                                                | MHC-05                                 | D2                                            |
| **M6** | Award-offer lifecycle: expiry worker (or the chosen alternative), consolidate the duplicate release paths, fix the close-with-pending-award orphan, resolve the premature loser-rejection.                                | MHC-03, MHC-17, MHC-18, part of MHC-21 | D4                                            |
| **M7** | Build the web surface: provider credits + purchase, provider award accept/decline, customer pending-award state, admin purchase review + pricing. Arabic and English.                                                     | MHC-01                                 | M3-M6 (the UI must reflect settled rules)     |
| **M8** | Consistency sweep: `updateNeedSchema` enum, `plans.service` quota count.                                                                                                                                                  | MHC-15, MHC-16                         | Nothing                                       |
| **M9** | Resolve the EGP wallet position per D1.                                                                                                                                                                                   | MHC-10                                 | **D1**                                        |

**Deferred out of the minimal path**, tracked in `KNOWN_LIMITATIONS.md`: MHC-08 (bookings),
MHC-09 (profile channels — pending D5), MHC-19 (ads on MHC — pending D6), MHC-13
(migration tooling), and all of Rank 5.

**Critical path.** M4 and M7 are the two items without which the product cannot be used by a
real customer and provider. M0 can and should run today. M1, M2, and M8 are unblocked and can
proceed in parallel with your decisions.

---

## A5. Manual end-to-end scenarios required before launch sign-off

To be executed against a staging environment, in both Arabic and English, on desktop and
mobile widths:

1. **Happy path.** Provider buys MHC via InstaPay → admin approves → balance credited →
   customer posts need → provider bids → customer awards → provider sees offer → provider
   activates → MHC debited exactly once → job opens → customer sees provider payment details
   → customer marks complete → customer reviews.
2. **Insufficient credits.** Provider with a zero balance attempts activation → 402 with the
   required and available amounts → buys credits → activation succeeds.
3. **Decline.** Provider declines → no MHC charged → need returns to `open` → customer awards
   a different provider → that provider activates successfully.
4. **Expiry.** Offer expires per the D4 rule → no MHC charged → correct notifications.
5. **Contact gate.** Pre-activation: phone numbers, emails, URLs, and Arabic messaging-app
   names are redacted in bid chat; attachments are refused; the general chat endpoint behaves
   per D2. Post-activation: the awarded thread reveals raw text; **a losing bidder's thread
   does not.**
6. **Double-spend attempts.** Two simultaneous activation requests for one bid → exactly one
   charge. Award to A, re-award to B, then A activates → clean failure, no charge.
7. **Purchase integrity.** Reusing a transfer reference is refused; approving the same
   purchase twice grants once; rejecting a purchase grants nothing.
8. **Admin.** Pricing changes take effect on the next activation and do not retroactively
   alter in-flight purchases (the package snapshot must hold).
9. **Kill switch.** Setting `mhc_activation_gate_enabled = false` opens the gate as
   documented and does not corrupt any state; re-enabling restores gating.

---

## A6. Business decisions that block this plan

| ID  | Question                                                    | Blocks               |
| --- | ----------------------------------------------------------- | -------------------- |
| D1  | Existing EGP wallet balances and withdrawals                | M9, MHC-10           |
| D2  | General pre-activation chat behaviour                       | M5, MHC-05           |
| D3  | Losing bidder chat and data access                          | M3, MHC-07           |
| D4  | Award-offer expiration behaviour                            | M6, MHC-03, MHC-18   |
| D5  | Provider direct-payment-method disclosure                   | M4, MHC-04, MHC-09   |
| D6  | Legacy escrow and EGP-denominated features after MHC launch | M1 (partial), MHC-19 |

Full statements, options, consequences, and recommendations are in
`DECISIONS_REQUIRED.md`. **No implementation inside these flows will begin before they are
answered.**
