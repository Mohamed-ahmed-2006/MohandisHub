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
