# Advertisement billing

How advertisements are moderated, priced, charged and renewed.

This document supersedes `LAUNCH_CONSTRAINTS.md#lc-01` for advertisements. LC-01
froze the advertisement price at 0 for two reasons — flat per-campaign pricing
and no refund policy — and Wave 2F-A resolved both. Wave 2F-B resolves the last
one: automatic weekly renewal, with explicit consent, a mandatory bound, a
scheduler, notifications and the complete renewal interface, all now exist.

**The production price is still 0.** Shipping automatic renewal is what
*unblocks* a non-zero price; it is not the act of setting one. See §12.

Implemented by:

- `supabase/migrations/20260730120000_advertisement_weekly_billing.sql`
- `supabase/migrations/20260731090000_advertisement_automatic_renewal.sql`
- `apps/api/src/modules/advertisements/`
- `apps/api/src/tests/advertisements.weekly-billing.pg.test.ts` (real PostgreSQL)
- `apps/api/src/tests/advertisements.automatic-renewal.pg.test.ts` (real PostgreSQL)
- `apps/api/src/tests/advertisements.moderation.test.ts`
- `apps/api/src/tests/advertisement-renewal.worker.test.ts`
- `apps/web/tests/advertisement-weekly-billing-presentation.test.ts`

---

## 1. The rules

1. **Ads require moderation.** A submitted campaign is `pending_review` and is
   not publicly visible. An administrator with `manage_ads` approves or rejects
   it.
2. **Submission does not charge.** `POST /api/advertisements` creates one row
   and nothing else: no wallet is read, no wallet row is locked, no period
   exists. This is a property of the call graph, not of the configured price —
   the charging primitive is never reached on that path.
3. **Immediate campaigns are charged at approval.** The approval and the first
   week's charge commit in one transaction.
4. **Future-dated campaigns are charged when the start becomes due.** Approval
   records the decision; nothing is bought until the campaign can actually run.
5. **The billing unit is seven days** — exactly 168 hours, enforced by
   `chk_ad_period_exact_week`. Written in hours rather than days because
   `timestamptz + interval '7 days'` is 167 or 169 hours across a DST boundary.
6. **Manual renewal is implemented.** The advertiser buys one more week, once the
   previous one has ended.
7. **Automatic renewal is implemented, with explicit consent and a mandatory
   bound.** See §5.
8. **Started weeks are non-refundable.** Cancelling refunds nothing, and there is
   no advertisement refund endpoint.
9. **Cancellation hides the advertisement immediately** and closes the running
   week.
10. **Cancellation prevents renewal** and prevents future activation.
11. **Existing advertisements are grandfathered.** Every pre-existing row is
    `billing_model = 'legacy'` and is never touched by a weekly code path.
12. **Price changes affect future weeks only.** Each week snapshots the price it
    was charged, and the snapshot is never rewritten.
13. **Insufficient MHC creates no debt.** No charge, no active period, no
    negative balance — and the approval survives.

## 2. Where the price comes from

`mhc_action_prices.advertisement`, named *Advertisement week*. One row, one
number, resolved **inside** the charging transaction by the generic primitive
itself.

No caller passes an amount. There is no price field on any request schema, and
`apps/api/src/tests/advertisements.moderation.test.ts` asserts that a client
sending `mhcPrice`, `price` or `amount` has it discarded by validation.

`mhc_action_prices` has no duration dimension and does not need one: because the
period length is fixed by a CHECK constraint, "price per action" and "price per
week" are the same number. That is what resolves LC-01's flat-per-campaign
objection rather than working around it.

The screens read the same row for display only, so what a provider is shown and
what they are charged cannot drift.

### The weekly price is still 0

Wave 2F-A held it at 0 because a provider charged for week 1 would expect week 2
to be handled, and nothing handled it. That reason is now gone: automatic
renewal, reminders and the full interface exist and are covered.

The price nonetheless stays at 0 in this wave, because **setting a price is a
separate decision from building the machinery that would collect it.** Both
migrations assert on the way out that the price is still 0, so a replay cannot
quietly put advertising on sale. §12 records exactly how an administrator turns
it on when they decide to.

## 3. State model

Moderation and billing are separate columns, because "approved but out of
credits" and "nobody has reviewed this" are different situations with different
remedies.

| `status` | `billing_status` | Meaning |
|---|---|---|
| `pending_review` | `pending_review` | Submitted, unreviewed, never charged |
| `rejected` | `rejected` | Refused by an admin, never charged |
| `scheduled` | `awaiting_start` | Approved, starts later, unpaid |
| `scheduled` | `awaiting_credits` | Approved, but the charge found no credits |
| `active` | `active` | A paid seven-day week is running |
| `expired` | `renewal_required` | The paid week ended; manual renewal needed |
| `cancelled` | `cancelled` | Cancelled; no further week may be bought |
| *(any)* | `legacy` | Pre-weekly campaign, never billed in MHC |

A weekly campaign serves if and only if it holds an `active` period. The serving
query also requires `billing_status = 'active'`, so no other write path can put a
weekly campaign on air without a paid week.

## 4. Why a period table

`advertisement_campaign_periods` holds one row per paid week.

- Each week needs its **own** charge reference, so
  `uq_mhc_action_charge_reference` is idempotent per week rather than per
  campaign. A renewal is a new chargeable reference; a retry of that renewal is
  not.
- Each week needs its **own** price snapshot, so a later admin price change
  cannot rewrite what was already charged.
- "At most one active week" and "no two weeks overlap" are invariants over a set
  of rows. No column shape expresses them; `uq_ad_period_active` and the
  `ad_period_no_overlap` gist exclusion constraint do.

A zero-price week writes **no** charge row at all — that is the established
behaviour of the generic primitive, and `chk_ad_period_charge_shape` encodes the
same rule on the period: snapshot 0 means no charge link, and a priced week
always has one.

## 5. Automatic renewal

### 5.1 Consent, and a bound, are both mandatory

An advertiser may switch a campaign to automatic renewal through
`PUT /api/advertisements/:id/auto-renewal`. Enabling requires **both**:

- `consentAccepted: true`. Refused with `400 AD_AUTO_RENEWAL_CONSENT_REQUIRED`
  otherwise. The accepted terms version is stored on the campaign
  (`auto_renew_consent_version`), so a later change to the wording shown next to
  the toggle is distinguishable from what they actually agreed to;
- at least one of `maximumWeeks` or `renewalEndDate`. Refused with
  `400 AD_AUTO_RENEWAL_BOUND_REQUIRED` otherwise. **Automatic renewal is never
  open-ended.**

Consent is enforced by the database, not only by the service:
`chk_advertisements_auto_renew_consent` makes `auto_renew_enabled = true`
impossible without `auto_renew_enabled_at` and `auto_renew_enabled_by`, and
`chk_advertisements_auto_renew_bounded` (Wave 2F-A) makes it impossible without a
bound. Neither can be bypassed by a code path that forgets.

Deliberately **not** stored: IP address and user agent. Nothing about this
decision needs to identify a device, and the existing audit standard does not
collect them for provider self-service actions. The audit row written by the
controller records the actor, the bounds and the terms version.

### 5.2 What the bounds mean

- **`maximum_weeks` is the TOTAL number of weekly periods the campaign may ever
  buy, including the first.** A campaign that has run one week and is capped at
  4 has three renewals left.
- **`renewal_end_date` is a wall-clock boundary a full period must fit before.**
  A new week is bought only if all 168 hours end on or before it. There is no
  shortened final week and no prorated charge, ever.
- Both may be set. Each is checked independently at every boundary, so the
  **earliest applicable one wins** without any code choosing between them.

Enabling is refused if the requested bound could never be reached:
`409 AD_AUTO_RENEWAL_MAX_WEEKS_TOO_LOW` when the campaign has already used that
many weeks, `409 AD_AUTO_RENEWAL_END_DATE_TOO_SOON` when a full week would not
fit after the running one ends. Both are measured against the **database clock**.

### 5.3 What configuration does not do

- It never charges. No branch of `configureAutoRenewal` reaches the charging
  primitive, so this is a property of the call graph rather than of a guard.
- It never alters or refunds the running period. The week already paid for keeps
  running to its end whatever the advertiser chooses.
- Repeating an identical request is a no-op: nothing is written and nothing is
  acknowledged a second time. A genuine off-then-on sequence *is* acknowledged
  twice, because it is two real decisions.
- Turning it off sets `renewal_mode = 'manual'` and leaves the stored bounds
  alone unless the request explicitly clears them (send `null`). The bounds are
  campaign-level and continue to constrain manual renewal, which is what they did
  before this wave.

### 5.4 The boundary event log

`advertisement_renewal_events` holds one row per (campaign, boundary, outcome),
where the boundary is the **period number the campaign was trying to buy** —
never a timestamp, so a worker running three hours late is still acting on the
same boundary.

`uq_ad_renewal_event_boundary`, a partial unique index over the eight
boundary-scoped event types, is simultaneously:

- **the notification deduplication identity.** Ten workers that all decide
  boundary 4 failed produce one row; nine get a `23505`, unwind, and notify
  nobody;
- **the no-repeat-debit gate**, together with `auto_renew_paused_reason`;
- **the notification outbox** (`delivery_status`, `claim_expires_at`,
  `attempt_count`, `delivered_at` — see §5E);
- **the provider's renewal history.**

The two configuration acknowledgements (`auto_renew_enabled`,
`auto_renew_disabled`) are deliberately outside that index: turning automatic
renewal off and on again within one week is a real sequence of two decisions, and
suppressing the second would be wrong. They are made idempotent instead by only
being written when the stored configuration actually changes.

## 5A. Exactly-once, and why

### The transaction

For a due automatic campaign, in one transaction:

1. claim and lock the advertisement (`FOR UPDATE SKIP LOCKED` for the scheduler,
   blocking `FOR UPDATE` for the advertiser's explicit retry);
2. re-read **everything** under the lock: billing model, moderation status,
   consent, mode, pause, bounds, and the period table;
3. close the previous week if its 168 hours have elapsed — in this same
   transaction, so the campaign never has a gap;
4. compute the next period number from the period table;
5. check `maximum_weeks`, then `renewal_end_date`, **before** charging;
6. preallocate the period UUID;
7. charge through the generic primitive: `actionKey = advertisement`,
   `referenceType = advertisement_period`, `referenceId` = that UUID. The price
   is resolved by the primitive from `mhc_action_prices` inside this
   transaction — there is no parameter by which any caller could pass an amount;
8. insert the period (`status = 'active'`, `ends_at = starts_at + 168 hours`);
9. update the campaign mirrors and `renewal_count`;
10. insert the boundary event;
11. **commit once.**

Web push and email happen only after that commit, and only after the connection
is back in the pool. No advertisement row and no wallet row is ever held while a
network call is made.

### Where the guarantees actually live

| Guarantee | Enforced by |
|---|---|
| Two workers cannot both act on one campaign | the advertisement row lock |
| Only one period N per campaign | `uq_ad_period_number` |
| Only one running week per campaign | `uq_ad_period_active` |
| Weeks never overlap | `ad_period_no_overlap` (gist EXCLUDE, `'[)'`) |
| One charge per week, from both directions | `uq_mhc_action_charge_reference` + `uq_ad_period_action_charge` |
| Every week is exactly 168 hours | `chk_ad_period_exact_week` |
| One notification per boundary outcome | `uq_ad_renewal_event_boundary` |
| Balance can never go negative | guarded debit + `chk_wallets_balance_nonnegative` |

None of these is application logic. The renewal service opens period N+1 through
the **same** `chargeAndOpenPeriodInTx` the initial and manual paths use — a
second implementation of "charge, then open a week" is exactly how a double
charge would be introduced.

### Crash recovery

- **Before commit:** no charge, no ledger row, no period, no event. The whole
  transaction unwinds together.
- **After commit, before acknowledgement:** the next sweep re-reads the campaign,
  finds a running unexpired week, and skips. Retrying is free.
- **After the event, before the push:** the event survives as `pending` and the
  outbox sweep delivers it. The financial transaction is never reopened. See
  §5E for exactly what "delivers it" guarantees — and what it does not.

### Races, and what happens

| Race | Outcome |
|---|---|
| Disable commits before the scheduler's lock | no charge; `skipped: not_automatic` |
| Renewal commits before the disable | the new week stands and is not refunded; nothing renews after it |
| Cancellation commits before the lock | no charge; `skipped: cancelled_or_rejected` |
| Renewal commits before the cancellation | the campaign hides immediately, the week is closed, **nothing is refunded** |
| Manual and automatic renewal at once | exactly one period, one charge, one ledger debit; the loser reports `AD_PERIOD_STILL_ACTIVE` |
| Two, or ten, schedulers at once | one period, one charge, one debit, one notification |

## 5B. Failure and boundary handling

### Insufficient credits

- no period, no charge row, no ledger row, no negative balance, **no debt**;
- the previous week is closed if it had elapsed, so the advertisement stops
  serving;
- `auto_renew_paused_reason = 'insufficient_credits'`, `auto_renew_paused_at` set;
- `billing_status` stays `renewal_required` — the campaign is in the state it is
  genuinely in. The reason is recorded separately, because a reason is not a
  lifecycle state and conflating them would have made the advertiser's remedy
  unreachable;
- the **preference is preserved** (`auto_renew_enabled` stays true), so clearing
  the pause resumes automatic renewal rather than requiring re-consent;
- one durable notification, deep-linked to `/app/credits`, carrying the
  advertisement id and the required amount — never a balance.

**There is no timer that retries.** `auto_renew_paused_reason IS NOT NULL` takes
the campaign out of `idx_advertisements_auto_renew_due`, which is the only way
the scheduler finds work. The advertiser clears it by either:

- `POST /api/advertisements/:id/auto-renewal/retry` — runs the *same* locked,
  exactly-once operation the scheduler runs, so pressing it twice, or pressing it
  while the scheduler acts, still buys one week; or
- renewing manually, or re-submitting their configuration.

A retry that fails the same way re-pauses and does **not** notify again: the
boundary event already exists.

### Pricing unavailable or the action switched off

Identical shape, with `auto_renew_paused_reason = 'pricing_unavailable'` and its
own notification. `MHC_ACTION_PRICE_MISSING` (503) and `MHC_ACTION_DISABLED`
(409) both fail closed — an unpriced action is never given away.

### Maximum weeks reached

No period, no charge. `auto_renew_enabled` goes false, `renewal_mode` returns to
`manual`, `auto_renew_paused_reason = 'max_weeks_reached'`, one notification.
The campaign is complete, not broken; manual renewal is still refused by the
same cap (`AD_RENEWAL_LIMIT_REACHED`).

### Renewal end date reached

Same, with `end_date_reached`. **No partial final week and no prorated charge.**

## 5C. The scheduler

`apps/api/src/modules/advertisements/advertisement-billing.worker.ts`, started by
`apps/api/src/worker.ts` alongside the reservation, retention and award-expiry
workers.

| Setting | Env var | Default | Bounds |
|---|---|---|---|
| Sweep interval | `AD_BILLING_SWEEP_INTERVAL_MS` | 60 000 | ≥ 5 000 |
| Campaigns per stage per tick | `AD_BILLING_SWEEP_BATCH_SIZE` | 25 | 1–500 |
| Reminder lead time | `AD_RENEWAL_REMINDER_HOURS` | 24 | 1–168 |

An out-of-range value **fails startup** rather than being silently replaced.

One tick, in this order:

1. approved campaigns whose scheduled start has arrived;
2. automatic campaigns whose week has ended — **before** stage 3, so an automatic
   campaign closes its old week and opens the new one in one transaction and
   never spends a tick not serving;
3. the generic expiry sweep, which closes every remaining elapsed week and
   records `manual_renewal_required` for manual advertisers (`ON CONFLICT DO
   NOTHING`, so a lost race is a no-op rather than an aborted expiry);
4. upcoming-renewal reminders inside the lead-time window;
5. the notification outbox, **last**, so events this tick created go out in this
   tick.

Properties:

- one transaction per advertisement, so one campaign that fails cannot roll back,
  block or skip another. A whole stage that throws is logged and the remaining
  stages still run;
- `SET LOCAL lock_timeout = '5s'` on every claim, so a contended row fails this
  attempt and is retried next tick instead of pinning a connection;
- candidate reads are **unlocked and bounded**; every predicate is re-evaluated
  under the lock, so a candidate that stopped being due is skipped;
- safe with two or more worker instances. The in-process `running` flag is an
  efficiency guard, never the source of correctness;
- `stop()` sets a flag the sweep re-reads **between** campaigns, then waits for
  the one in flight. A campaign is never cut in half — it has committed its
  charge and its week, or neither. The worker stops before the pool closes.

A late sweep costs nothing: the new week starts at the database time of the
successful charge, so the advertiser always receives a full 168 hours.

## 5D. Notifications

Ten durable event types, all delivered from the outbox:

| Event | Notification type | Deep link |
|---|---|---|
| First week activated | `advertisement_activated` | `/app/advertisements` |
| Automatic renewal succeeded | `advertisement_renewed` | `/app/advertisements` |
| Failed: insufficient credits | `advertisement_renewal_failed_credits` | `/app/advertisements` |
| Failed: pricing unavailable | `advertisement_renewal_failed_pricing` | `/app/advertisements` |
| Manual week ended | `advertisement_renewal_required` | `/app/advertisements` |
| Renewal reminder (≈24h) | `advertisement_renewal_reminder` | `/app/advertisements` |
| Stopped: maximum weeks | `advertisement_auto_renew_stopped_max_weeks` | `/app/advertisements` |
| Stopped: end date | `advertisement_auto_renew_stopped_end_date` | `/app/advertisements` |
| Automatic renewal enabled | `advertisement_auto_renew_enabled` | `/app/advertisements` |
| Automatic renewal disabled | `advertisement_auto_renew_disabled` | `/app/advertisements` |

- The advertisement id travels in every payload, and the advertisements screen
  reads `?ad=<id>` to open that campaign's renewal panel. The paused panel is
  where the three things an advertiser needs sit together: **Add credits**
  (linking to `/app/credits`), the campaign itself, and **Retry renewal now**.
  That is why even the empty-balance notification lands here rather than on the
  credits screen, which knows nothing about the campaign and offers no way back.
- Payloads carry only the campaign's own identifiers and figures the provider was
  already shown. **No balance, no wallet id, no charge id, no transaction id**,
  enforced by an allow-list in `buildRenewalNotification`.
- Recipient ownership comes from `advertisement_renewal_events.advertiser_id`,
  written inside the financial transaction — never from anything a caller
  supplied.
- Titles and messages are stored in English and rendered through
  `dictionary.notificationTemplates`, which interpolates `{adTitle}` and
  `{periodNumber}`. Arabic and English are both real translations.
- Categorised under `services`, and none is marked required, so existing
  notification preferences continue to decide delivery. A provider who has turned
  the in-app channel off for this group gets no row, and the outbox treats that
  as delivered rather than reconsidering it forever.
- The reminder is deduplicated per boundary by the same unique index, so it
  cannot fire twice for one week.

## 5E. Delivery semantics — stated exactly

**External delivery is at-least-once, not exactly-once.** The Web Push protocol
has no idempotency key, and `sendTransactionalEmail` passes none to Resend — the
configured provider, which *does* support `Idempotency-Key`. Nothing downstream
can deduplicate a resend today, so nothing here claims it can.

What each layer actually guarantees:

| Layer | Guarantee | Enforced by |
|---|---|---|
| Boundary event | **exactly once** | `uq_ad_renewal_event_boundary` |
| In-app notification row | **exactly once** | written under the claim lock, guarded by `in_app_notification_id` |
| Web push | **at-least-once** | lease + bounded retry |
| Email | **at-least-once** | lease + bounded retry |
| Socket emit | best effort, not part of the outcome | — |

### The three ordered steps

1. **Claim** — one transaction: lock a deliverable row `FOR UPDATE SKIP LOCKED`,
   write the in-app notification *if `in_app_notification_id` is still null*,
   set `delivery_status = 'claimed'` with `claim_expires_at = now() + 5 min`,
   increment `attempt_count`, **commit**.
2. **Send** — push and email, outside every lock and transaction.
3. **Acknowledge** — a second transaction: `delivered` on success, or release
   the lease to `pending` with an exponential backoff, or park as `failed` once
   `attempt_count` reaches `MAX_DELIVERY_ATTEMPTS` (5).

Nothing is stamped delivered before the send. Marking early would suppress
duplicates by *losing* messages, which is the worse failure — and was the defect
this replaced.

### Crash behaviour

| Crash point | Result |
|---|---|
| After claim, before send | Row stays `claimed`. Lease expires; the sweep re-claims and sends. Nothing lost. |
| After send, before acknowledgement | Row stays `claimed`. Lease expires; the sweep **resends**. This is the at-least-once window: a duplicate push or email is possible. The in-app row is *not* duplicated. |
| Partial (push sent, email failed) | The attempt is a failure as a whole; the lease is released with a backoff and both channels are retried, so the successful channel may deliver twice. |
| Preferences unreadable | Both channels report failed; retried. Nothing is sent on a guess. |
| In-app channel switched off | Recorded once with a sentinel id, so no retry reconsiders the preference and no row is ever written. |

### Recovery and bounds

- **A stuck claim is impossible.** `chk_ad_renewal_event_claim_shape` makes a
  `claimed` row without a lease unstorable, and
  `idx_ad_renewal_events_deliverable` covers both `pending` past its backoff and
  `claimed` past its lease — the sweep treats a dead worker and an unstarted one
  identically.
- **Retry is bounded**: 5 attempts, backoff 1→2→4→8→16 minutes, capped at 60.
- **Retry is observable**: `attempt_count`, `last_delivery_error`,
  `delivery_status = 'failed'`, the sweep's `notifyRetrying` / `notifyExhausted`
  counters, and an `error`-level worker log line on exhaustion. An exhausted
  delivery is the one outcome nothing else surfaces — the renewal succeeded, so
  no financial alarm fires — which is why it is logged loudly.
- **Two workers never deliberately deliver the same event**: `SKIP LOCKED` on
  the claim means one wins and the rest get nothing. Ten concurrent
  `deliverEvent` calls produce one delivery and nine `not_claimable`.
- **Payload and recipient stay server-controlled**: the recipient is
  `advertisement_renewal_events.advertiser_id`, written inside the financial
  transaction; the payload is rebuilt from the event row by
  `buildRenewalNotification` on every attempt.
- **No delivery path touches money.** The financial transaction contains no
  notification write, and no acknowledgement path writes a period, a charge or a
  ledger row — asserted directly.

If effectively-once external delivery is wanted later, the change is small and
localised: pass the event id as `Idempotency-Key` on the Resend request, and
leave push at at-least-once because the protocol offers nothing better. That is
a deliberate follow-up, not something claimed today.

## 6. Expiration

`expireDuePeriods()` closes every week whose 168 hours have elapsed and moves its
campaign to `renewal_required`, atomically. It uses `SKIP LOCKED`, so two callers
never block or double-process.

It is invoked from **two** places, and both matter:

- **lazily, from the serving path**, before any campaign is ranked. An unpaid
  week cannot be served even if the worker is down, because the sweep runs first
  and the serving query independently requires a live `active` period regardless;
- **on a timer**, as stage 3 of the worker's tick.

Automatic campaigns are renewed in stage 2, *before* this runs, and close their
own elapsed week inside the renewal transaction — so an automatic campaign never
passes through a non-serving state on the way to its next week.

An admin pause is preserved — `paused_by_admin` stays paused while its billing
state still records that the week ended.

## 7. Refunds

There is no advertisement refund path, and none was added.

- A started week is non-refundable. Cancelling mid-week hides the campaign
  immediately and refunds nothing.
- Every period row and every charge row is preserved on cancellation. Nothing is
  deleted.
- The prorated **EGP** refund is retained, untouched, for
  `billing_model = 'legacy'` campaigns. Those were genuinely paid for in EGP and
  are still owed what they were promised. A weekly campaign can never reach that
  code: `amount_paid` is 0 for it, and the branch is selected on
  `billing_model`.

## 8. Grandfathering

Existing rows are grandfathered by column **default** alone —
`billing_model = 'legacy'` — so the mechanism holds for one existing row or a
million, and needs no backfill.

The migration asserts on the way out that no advertisement became weekly-billed
and that the period table is empty. Production held zero advertisement rows when
this shipped, but **nothing above depends on that**: every guard is expressed as
a default or a guarded UPDATE.

A legacy campaign:

- keeps serving, and keeps its own legacy expiry sweep;
- is refused by approval, renewal and due-start activation with
  `409 AD_NOT_WEEKLY`;
- is never given a period and never charged in MHC.

Converting one to weekly billing would be a deliberate, separate act. Nothing in
this wave does it.

## 9. Endpoints and error codes

| Endpoint | Who | Notes |
|---|---|---|
| `POST /api/advertisements` | provider | Submit for review. Charges nothing. |
| `GET /api/advertisements/:id/billing` | owner or admin | Weekly price, current week, every snapshot, renewal state, history |
| `POST /api/advertisements/:id/renew` | owner | Buy one more week |
| `POST /api/advertisements/:id/activate` | owner | Retry the first week after topping up |
| `PUT /api/advertisements/:id/auto-renewal` | owner | Enable, disable, or change bounds. Charges nothing. |
| `GET /api/advertisements/:id/auto-renewal` | owner or admin | Stored configuration and the consent record |
| `POST /api/advertisements/:id/auto-renewal/retry` | owner | Explicit retry of a paused automatic renewal |
| `GET /api/advertisements/:id/periods` | owner or admin | Paginated week history with price snapshots |
| `DELETE /api/advertisements/:id` | owner | Cancel. No refund. |
| `POST /api/advertisements/admin/:id/approve` | `manage_ads` | Charges the first week if immediate |
| `POST /api/advertisements/admin/:id/reject` | `manage_ads` | Reason required, shown to the advertiser |
| `POST /api/advertisements/admin/:id/activate-due` | `manage_ads` | Invokes the due-start service |

Stable error codes:

| Code | Status | Meaning |
|---|---|---|
| `MHC_INSUFFICIENT_CREDITS` | 402 | Not enough credits. Nothing was charged. Deep-links to `/app/credits`. |
| `MHC_ACTION_PRICE_MISSING` | 503 | No weekly price is configured. Fails closed; nothing charged. |
| `MHC_ACTION_DISABLED` | 409 | The advertisement action is switched off. Fails closed. |
| `AD_AUTO_RENEWAL_CONSENT_REQUIRED` | 400 | Enabling needs explicit agreement to the weekly charge |
| `AD_AUTO_RENEWAL_BOUND_REQUIRED` | 400 | Enabling needs a maximum week count, an end date, or both |
| `AD_AUTO_RENEWAL_MAX_WEEKS_TOO_LOW` | 409 | The campaign has already used that many weeks |
| `AD_AUTO_RENEWAL_END_DATE_TOO_SOON` | 409 | A full 168-hour week would not fit before that date |
| `AD_AUTO_RENEWAL_NOT_CONFIGURABLE` | 409 | Cancelled or rejected campaigns do not renew |
| `AD_NOT_PENDING_REVIEW` | 409 | Only an unreviewed campaign can be approved or rejected |
| `AD_NOT_APPROVED` | 409 | Activation needs a recorded approval |
| `AD_START_NOT_DUE` | 409 | Scheduled start has not arrived |
| `AD_NOT_AWAITING_ACTIVATION` | 409 | Not in an activatable billing state |
| `AD_PERIOD_ALREADY_EXISTS` | 409 | The first week was already bought |
| `AD_PERIOD_STILL_ACTIVE` | 409 | Renew once the current week ends |
| `AD_RENEWAL_NOT_ELIGIBLE` | 409 | Not waiting for a renewal |
| `AD_RENEWAL_LIMIT_REACHED` | 409 | Configured maximum weeks reached |
| `AD_RENEWAL_WINDOW_CLOSED` | 409 | A new week would run past the configured end date |
| `AD_NOT_RENEWABLE` | 409 | Cancelled or rejected |
| `AD_NOT_ACTIVATABLE` | 409 | Cancelled or rejected |
| `AD_NOT_WEEKLY` | 409 | Legacy campaign; not moderated or billed here |
| `AD_NOT_EDITABLE` | 409 | A reviewed campaign's creative is locked |
| `AD_ACTIVATION_REQUIRES_PERIOD` | 409 | A weekly campaign cannot be forced live by a status write |
| `AD_PROFILE_NOT_ADVERTISABLE` | 403 | Not an active provider profile |
| `AD_SERVICE_NOT_FOUND` | 404 | Destination service is not the advertiser's active service |

## 10. Two defects fixed on the way through

Both made **every** create request fail against the live schema, which is why
production had no advertisement rows to migrate:

1. Nothing populated `destination_provider_id` / `destination_service_id`, so the
   VALIDATED `advertisements_destination_check` (from `20260727100000`) rejected
   every insert with a raw `23514`. The destination is now resolved and
   ownership-checked before the insert.
2. `linkType: 'need'` was accepted by validation and can never satisfy that same
   CHECK. It is no longer offered. Historical `need` rows were already cancelled
   by `20260727100000`, so none can serve.

And one privilege hole: `status` was an editable field on the provider's own
update route, which let an advertiser `PUT { status: 'active' }` onto their own
unreviewed campaign and bypass moderation entirely. It is gone.

## 11. Rollback

Each migration's rollback is in its own header, and each is exercised **twice**
on a scratch replay copy with an exact schema-fingerprint assertion:

- `20260730120000` by `advertisements.weekly-billing.pg.test.ts`;
- `20260731090000` by `advertisements.automatic-renewal.pg.test.ts`.

### Reverse dependency order

`advertisement_renewal_events.period_id` references
`advertisement_campaign_periods(id)`, so **the event log must be dropped first**.
A bare `DROP TABLE advertisement_campaign_periods` fails while it exists, and
that failure is asserted rather than assumed. The chain, newest first:

```
DROP TABLE advertisement_renewal_events;   -- 20260731090000
DROP TABLE advertisement_campaign_periods; -- 20260730120000
ALTER TABLE plan_subscriptions DROP COLUMN action_charge_id; -- 20260730100000
DROP TABLE mhc_action_charges;             -- 20260729140000
```

The headers of `20260730120000` and `20260729140000` were both extended to say
so, and `mhc.action-charge.pg.test.ts` asserts the extended ordering.

### What each drop costs

- Dropping the **event log** destroys the record of which boundary produced which
  outcome, and the outbox stamp that proves a notification was delivered once. No
  financial record is lost: charges, ledger rows and periods all survive. The
  campaign's own consent record survives too — only the log goes.
- Dropping the **period table** destroys the record of which week each charge
  paid for. `mhc_action_charges` and `transactions` survive and remain the
  authoritative financial history.

Export either table first in any environment that has charged for a week.

`reviewed_by`, `reviewed_at` and `rejection_reason` are **not** dropped by any of
these: they predate weekly billing, which only started writing them.

## 12. How an administrator turns advertising on

The machinery is complete and the price is 0. Turning it on is one deliberate
change, not a deployment step. In order:

1. **Decide the number.** `mhc_action_prices.advertisement.mhc_price` is the MHC
   cost of one 168-hour week. There is no second place a price can be set, so
   the displayed and charged prices cannot drift.
2. **Set it** through `PUT /api/advertisements/admin/controls`
   (`manage_ad_pricing`), which writes that row and records an audit entry. Do
   not edit the row by hand: the endpoint is what leaves the audit trail.
3. **It applies forward only.** Every week already bought carries its own
   `mhc_price_snapshot` and is never rewritten — asserted directly in the
   PostgreSQL suite.
4. **Confirm the worker is running.** The scheduler is what makes a week end and
   the next one begin. Check the `Advertisement billing worker started` line and
   the periodic `Advertisement billing sweep processed due items` entries on
   `mohandishub-worker`.
5. **Do not change the migrations.** Both assert the price is 0 on the way out,
   which is correct: a *replay* must never put advertising on sale. Applying them
   to an environment where an admin has already set a price will fail that
   assertion — which is the intended signal, not a bug. Re-running migrations on
   a priced environment is not a supported operation.

To take it off sale again, set the price back to 0, or set
`mhc_action_prices.advertisement.is_active = false`. The charge primitive fails
**closed** on an inactive price (`409 MHC_ACTION_DISABLED`) rather than giving
the action away — automatic renewals pause with `pricing_unavailable`, notify
their advertisers, and charge nothing.
