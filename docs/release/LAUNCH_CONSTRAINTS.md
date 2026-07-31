# Launch Constraints

Restrictions that are **deliberately enforced in code and configuration** for launch, and
what has to be true before each one may be lifted.

This file is not a wish list and not an open-questions log — open questions live in
`DECISIONS_REQUIRED.md`. Everything here is already implemented and tested. Each entry
exists because a capability is _built_ but must not be _sold_ yet.

**Rule for lifting any constraint below:** the deferred decision must be made, implemented,
and covered by tests. Turning a price on is not a deployment step; it is a change.

---

## LC-01 — Advertisements stay at price 0

**Status:** enforced · **Every original blocker resolved (Waves 2F-A and 2F-B)** ·
**Full detail:** [`ADVERTISEMENT_BILLING.md`](./ADVERTISEMENT_BILLING.md)

### What changed

Both original blockers below are **resolved**. Advertisements are no longer sold as a
campaign at all: they are sold one **seven-day week** at a time, and the refund question is
answered rather than left open.

1. **Flat per-campaign pricing — resolved.** The billing unit is a period of exactly 168
   hours, pinned by `chk_ad_period_exact_week`. Because the duration is fixed, one price per
   action key *is* a weekly price; no duration dimension is needed and no consumer multiplies
   anything. A 1-day and a 365-day campaign can no longer cost the same, because neither
   exists — there are only weeks.
2. **No refund policy — resolved.** The policy is: **a started week is non-refundable.**
   Cancelling hides the advertisement immediately, closes the running week, prevents renewal
   and refunds nothing. No advertisement refund endpoint was added, and
   `refundActionCharge` is not called on this path. Charging is per week, so the exposure a
   provider carries at any moment is one week rather than a whole campaign — which is what
   makes "no refund" a defensible answer instead of a gap.

Submission is also now free and moderated: a submitted campaign is `pending_review`, reaches
no wallet at all, and is charged only when an administrator approves it and a week actually
starts.

3. **No automatic renewal — resolved (Wave 2F-B).** A provider charged for week 1
   reasonably expects week 2 to be handled, and now it is. Automatic weekly renewal exists
   with **explicit consent** (`chk_advertisements_auto_renew_consent` makes the flag
   impossible without a recorded agreement), a **mandatory bound** (`maximum_weeks`, a
   renewal end date, or both, with the earliest winning), a **bounded multi-instance
   scheduler**, ten localized notification events including a 24-hour reminder, and the
   complete provider renewal interface. Exactly-once charging is a property of row locks and
   unique indexes rather than of application logic, and a failed boundary pauses the campaign
   instead of retrying on a timer — there is no path by which an advertiser is debited twice
   or repeatedly.

Submission is also now free and moderated: a submitted campaign is `pending_review`, reaches
no wallet at all, and is charged only when an administrator approves it and a week actually
starts.

### Why the price still stays 0

Not because anything is unfinished. Every blocker above is closed and covered by real
PostgreSQL concurrency tests.

The price stays 0 because **choosing a number is a commercial decision, separate from
building the machinery that would collect it.** Shipping 2F-B is what *unblocks* a price; it
is not the act of setting one, and this wave deliberately does not set one.

Both `20260730120000_advertisement_weekly_billing.sql` and
`20260731090000_advertisement_automatic_renewal.sql` assert on the way out that
`mhc_action_prices.advertisement.mhc_price` is still 0, so a replay cannot quietly put
advertising on sale.

### Before this constraint may be lifted

- [x] Decide whether advertisement pricing is flat per campaign or duration-scaled →
      **weekly periods**, enforced by a CHECK constraint.
- [x] Decide the cancellation refund policy → **started weeks are non-refundable**, with no
      refund endpoint and no wallet call on the cancellation path.
- [x] Ship Wave 2F-B: automatic renewal with explicit consent and a bound, scheduler
      concurrency, renewal reminders, and the complete renewal UI.
- [ ] Set `mhc_action_prices.advertisement.mhc_price` to a non-zero value —
      the only remaining step, and a deliberate one. The procedure, including what happens
      to weeks already bought and what a migration replay will do afterwards, is
      [`ADVERTISEMENT_BILLING.md` §12](./ADVERTISEMENT_BILLING.md).

Setting a price remains a change, not a deployment step. Leaving the row _inactive_ is also
safe: the charge primitive fails closed on an inactive price (`409 MHC_ACTION_DISABLED`)
rather than giving the action away, and an automatic renewal that meets an inactive price
pauses the campaign and notifies the advertiser without charging.

---

## LC-02 — Only the Free plan is available

**Status:** enforced · **Backlog:** P0-04 · **Owner decision pending:** per-plan MHC pricing

### What ships

`PlansService.subscribeToPlan` refuses **every** plan with `503 PLAN_SUBSCRIPTIONS_PAUSED`
while `app_settings.pause_plan_subscriptions` is true. The guard is the first thing the
method does after the feature check, so no EGP wallet is read, no wallet row is locked, no
debit happens, and no `plan_subscriptions` row is written — the method never even calls
`getPool()`.

Paid plans render as "Coming soon" with no price and no subscribe control. The Free plan
stays visible with its features. Migration `20260730090000_plan_subscriptions_launch_freeze.sql`
flips the column **default** to `true`, because it defaulted to `false` — the live row was
already frozen by hand, but a fresh environment or a clean replay would have shipped with
paid plans purchasable.

### What is explicitly NOT done

- The Pro plan is **not** converted to free, and no plan's price is changed.
- No plan is deactivated or deleted.
- No `plan_subscriptions` row is deleted or rewritten. Existing active subscriptions keep
  resolving their entitlements, and the `users.plan_id` → free-plan fallback keeps working.
- No `subscription_upgrade` MHC price is configured, and no per-plan action keys are created.
- The legacy EGP subscription implementation is **retained**, fenced rather than rewritten,
  and is still covered by its original tests with the pause lifted.

### Why paid plans cannot be sold yet

The plan catalogue is **multi-tier by design** — every plan carries its own `price`,
`currency`, `billing_cycle` and `duration_days`. The live catalogue holds `free` at 0 and
`pro` at 1000 EGP, plus deactivated tiers at 100 and 55.

MHC pricing is a **single price per action key**. Charging `subscription_upgrade` would
therefore either flatten every paid tier onto one identical MHC price — silently mispricing
a 55-tier and a 1000-tier the same, and mispricing again the moment an admin activates
another paid plan — or require per-plan action keys, which is a new monetisation model
rather than a migration of the existing one. Neither was approved, so neither was built.

### Note on the free plan and the subscribe endpoint

The endpoint is paused for the Free plan too, not just for paid ones. That is deliberate:
Free is the default `users.plan_id`, and `getEffectivePlanLimits` / `getEffectivePlanSlug`
already fall back to it, so nothing is taken away — while refusing uniformly keeps the guard
ahead of the wallet for **every** plan instead of only for priced ones. The consequence is
that an existing paid subscriber cannot self-downgrade to Free from the UI; their plan
simply lapses at `ends_at` and resolution returns `free`. A deliberate downgrade path is
new behaviour and was not built.

### Before this constraint may be lifted

- [ ] Choose the pricing model: one shared MHC price for all paid plans, per-plan MHC
      pricing (a schema decision, e.g. an MHC price column on `plans`), or
      free-with-entitlements permanently.
- [ ] Implement it against the P0-07 primitive, with the subscription row as the charge
      reference and a stable idempotency key.
- [ ] Prove no EGP wallet is read or written on the subscribe path, and that a duplicate
      concurrent subscribe produces one charge and one effective subscription.
- [ ] Replace the legacy `plan.confirmText` copy, which still quotes an EGP amount and a
      wallet deduction, with the chosen MHC wording.
- [ ] Only then clear `pause_plan_subscriptions`.
