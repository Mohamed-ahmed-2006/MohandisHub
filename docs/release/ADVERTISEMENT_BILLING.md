# Advertisement billing

How advertisements are moderated, priced and charged, and what is deliberately
**not** built yet.

This document supersedes `LAUNCH_CONSTRAINTS.md#lc-01` for advertisements. LC-01
froze the advertisement price at 0 for two reasons — flat per-campaign pricing
and no refund policy — and Wave 2F-A resolves both. The price nonetheless stays
at 0, for a different and narrower reason recorded below.

Implemented by:

- `supabase/migrations/20260730120000_advertisement_weekly_billing.sql`
- `apps/api/src/modules/advertisements/`
- `apps/api/src/tests/advertisements.weekly-billing.pg.test.ts` (real PostgreSQL)
- `apps/api/src/tests/advertisements.moderation.test.ts`
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
7. **Automatic renewal is NOT implemented.** No scheduler exists. See §5.
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

### The weekly price stays 0 until Wave 2F-B

Not because anything here is unfinished, but because a provider who is charged
for week 1 will expect week 2 to be handled. Until automatic renewal, renewal
reminder notifications and the complete renewal interface are reviewed and
merged, the honest state of the product is "free". Setting a non-zero price is a
change, not a deployment step.

The migration asserts the price is still 0 on the way out, so a replay cannot
quietly put advertising on sale.

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

## 5. Automatic renewal is not available

The schema carries `renewal_mode`, `auto_renew_enabled`, `maximum_weeks` and
`renewal_end_date` so Wave 2F-B does not need another migration. None of it is
active:

- no worker, no scheduler, and nothing in `apps/api/src/worker.ts`;
- `auto_renew_enabled` defaults to `false`, and
  `chk_advertisements_auto_renew_bounded` makes it impossible to enable without a
  maximum week count or an end date;
- `PUT /api/advertisements/:id/auto-renewal` refuses to enable it with
  `409 AUTO_RENEWAL_NOT_AVAILABLE`. Disabling is accepted, because off is the
  only state;
- the provider UI shows a **disabled** "Coming soon" checkbox that submits
  nothing;
- `renewal_source = 'automatic'` is a permitted value that this wave never
  writes.

No campaign is left depending on a scheduler that does not exist.

Wave 2F-B will add explicit consent, a maximum week count or end date,
scheduler concurrency, renewal reminders and automatic charging.

## 6. Expiration and renewal today

`expireDuePeriods()` closes every week whose 168 hours have elapsed and moves its
campaign to `renewal_required`, atomically. It uses `SKIP LOCKED`, so two callers
never block or double-process.

It is invoked **lazily**, from the serving path, before any campaign is ranked.
That keeps the product coherent without a scheduler: an unpaid week cannot be
served because the sweep runs first. Wave 2F-B will also call it on a timer.

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
| `GET /api/advertisements/:id/billing` | owner or admin | Weekly price, current week, every snapshot |
| `POST /api/advertisements/:id/renew` | owner | Buy one more week |
| `POST /api/advertisements/:id/activate` | owner | Retry the first week after topping up |
| `PUT /api/advertisements/:id/auto-renewal` | owner | Always refuses to enable |
| `DELETE /api/advertisements/:id` | owner | Cancel. No refund. |
| `POST /api/advertisements/admin/:id/approve` | `manage_ads` | Charges the first week if immediate |
| `POST /api/advertisements/admin/:id/reject` | `manage_ads` | Reason required, shown to the advertiser |
| `POST /api/advertisements/admin/:id/activate-due` | `manage_ads` | Invokes the due-start service |

Stable error codes:

| Code | Status | Meaning |
|---|---|---|
| `MHC_INSUFFICIENT_CREDITS` | 402 | Not enough credits. Nothing was charged. Deep-links to `/app/credits`. |
| `AUTO_RENEWAL_NOT_AVAILABLE` | 409 | Automatic renewal is not implemented |
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

The documented rollback is in the migration header and is exercised by
`advertisements.weekly-billing.pg.test.ts`, which runs it **twice** on a scratch
replay copy and asserts the schema fingerprint returns to the expected
pre-migration state with no collateral damage.

Dropping the period table destroys the record of which week each charge paid for.
The `mhc_action_charges` and `transactions` rows survive and remain the
authoritative financial history, so no financial record is lost — but export the
table first in any environment that has charged for a week.

`reviewed_by`, `reviewed_at` and `rejection_reason` are **not** dropped by the
rollback: they predate this migration, which only starts writing them.
