# Launch Constraints

Restrictions that are **deliberately enforced in code and configuration** for launch, and
what has to be true before each one may be lifted.

This file is not a wish list and not an open-questions log — open questions live in
`DECISIONS_REQUIRED.md`. Everything here is already implemented and tested. Each entry
exists because a capability is _built_ but must not be _sold_ yet.

**Rule for lifting any constraint below:** the deferred decision must be made, implemented,
and covered by tests. Turning a price on is not a deployment step; it is a change.

---

## LC-01 — Paid advertisements stay at price 0

**Status:** enforced · **Backlog:** P0-03 · **Owner decision pending:** refund policy

### What ships

Advertisement creation charges MHC through the generic charge primitive (P0-07), inside the
same transaction as the campaign insert. The price comes only from
`mhc_action_prices.advertisement`. Migration `20260729150000_advertisement_mhc_pricing.sql`
**activates** that action row while leaving its value at the seeded `0`, so advertising is
exactly as free as it was before the change, and the wiring is proven end to end.

### Why the price must stay 0

Two things about the current implementation are not yet product decisions:

1. **Charging is flat per campaign, not per day.** The pre-P0-03 model was
   `pricePerDay × durationDays` in EGP against a wallet that is now frozen.
   `mhc_action_prices` has one price per action key and no duration dimension, so a
   campaign now costs a single flat MHC price regardless of how long it runs. This matches
   `docs/audit/2026-07-29-marketplace-coherence/03-financial-mhc-audit.md` §5.3 and keeps
   the charged amount derivable from the price catalogue alone — but it means a 1-day and a
   365-day campaign cost the same. Nobody has agreed that is the intended commercial shape.

2. **There is no cancellation or refund policy.** Cancelling an MHC-charged campaign
   currently refunds **nothing**. `advertisements.amount_paid` is written as `0` for launch
   campaigns precisely so the legacy prorated _EGP_ refund maths yields 0 and no wallet is
   touched. The refund primitive (`MhcRepository.refundActionCharge`) exists and is tested,
   but it performs a **full** refund only — it cannot prorate — and no policy has been
   chosen between "full refund before the campaign starts serving", "prorated", and "no
   refund once live".

At a price of 0 both gaps are harmless: nothing is charged, so nothing can be
mispriced by duration and nothing can be owed back. At any non-zero price, a provider who
cancels a campaign on day 1 of 30 silently loses their credits.

### Before this constraint may be lifted

- [ ] Decide whether advertisement pricing is flat per campaign or duration-scaled. If
      duration-scaled, `mhc_action_prices` alone cannot express it and the primitive's
      single-price contract needs revisiting — do not multiply the action price in a
      consumer, because then the charged amount stops matching the configured price.
- [ ] Decide the cancellation refund policy, implement it on
      `refundActionCharge`, and test it — including the concurrent-cancel case.
- [ ] Only then set `mhc_action_prices.advertisement.mhc_price` to a non-zero value.

Until all three are done, advertising stays free **or** the `advertisement` action stays
inactive. Note that leaving the row _inactive_ is also safe: the charge primitive fails
closed on an inactive price (`409 MHC_ACTION_DISABLED`) rather than giving the action away.

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
