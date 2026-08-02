# C — Expert Packages

> A **Package** is a named, priced, scoped tier inside an `expert_service` Offer. Packages
> exist so that repeatable professional work can be bought without a negotiation, and
> **custom proposals** exist because most professional work is not repeatable. Wave 3
> supports both inside one Offer.

Everything in this file applies equally when a **Business** publishes an `expert_service`
offer.

---

## 1. Optional or mandatory

**Packages are optional.** An `expert_service` Offer declares one of three pricing shapes at
creation:

| Shape                  | Packages | Custom proposals | Buyer's entry action                          |
| ---------------------- | -------- | ---------------- | ----------------------------------------------- |
| `packaged`             | 1–3      | No               | Buy a package directly                        |
| `quote_only`           | 0        | Yes              | Send a Quote Request; receive a Custom Proposal |
| `packaged_with_custom` | 1–3      | Yes              | Either                                        |

Rationale for making them optional rather than mandatory: forcing a package on work that
genuinely cannot be scoped in advance produces fictional listings — a "starting at" price
that never matches the real one — which is precisely the bait pattern
[06 §1](./06-offer-model.md) prohibits. Forcing quote-only on everything, conversely,
destroys the fast path for the work that *is* standard.

A `quote_only` offer must still publish a **price indication** — a band, an hourly rate, or
a typical-project range — so that discovery filtering and buyer expectation both work. An
offer with no price signal at all is not publishable.

---

## 2. Package count

- **Minimum 1, maximum 3** per Offer. The maximum is admin-configurable; the product default
  is 3.
- Tiers are **ordered** and must be strictly increasing in price. Equal-priced tiers are
  rejected at validation, because they give the buyer no basis to choose.
- Tier naming is provider-chosen, not fixed to Basic/Standard/Premium.
- An Offer may present **fewer tiers than it defines** only by pausing a tier
  (see §9); it cannot hide one from some buyers and not others.
- Three is a ceiling, not a target. A one-package Offer is a normal, complete Offer.

---

## 3. Scope

Each package carries a scope definition that is precise enough to be **snapshotted and
adjudicated**, because it is what a dispute will be decided against.

| Element                  | Requirement                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| **Deliverables list**    | Mandatory. Itemized, countable where countable (e.g. "3 plan drawings", "1 report, 10–15 pages")     |
| **Deliverable formats**  | Mandatory. File formats and whether editable source files are included — the classic hidden dispute  |
| **Inclusions**           | Mandatory. What the work covers                                                                      |
| **Explicit exclusions**  | Mandatory, minimum one. What it does not cover                                                       |
| **Assumptions**          | Optional. Conditions the price depends on                                                            |
| **Rights and usage**     | Optional in Wave 3, but if declared it is snapshotted; the platform records, it does not adjudicate IP |
| **Session component**    | Optional. Duration, count, platform, and whether recording is permitted                              |

Validation rules:

- Deliverables and exclusions are **structured lists**, not one free-text blob. A dispute
  over "was the CAD source included" must be resolvable by reading a field, not a paragraph.
- Scope text passes redaction like every other field.
- Scope may **not** reference off-platform terms, external documents by link, or "as
  discussed" — a package is sold to strangers.

---

## 4. Pricing

- One **fixed price per package**, in the Offer's single currency. Wave 3 is single-currency
  per Offer; multi-currency is deferred.
- Price is inclusive of everything in the scope. Anything conditional belongs in an add-on
  or an exclusion.
- **Payment plan shapes** the provider will accept are declared per Offer: single payment,
  deposit + balance (with the deposit percentage or amount), or N instalments. The buyer
  chooses among the offered shapes at purchase, and the choice is snapshotted.
- **No platform fee is deducted from the price**, because the platform never handles the
  money. The provider's MHC activation charge is a separate cost the provider bears and must
  never be presented to the buyer as a line item.
- Minimum and maximum price bounds are admin-configurable per category, as an anti-abuse
  measure, not a pricing policy.
- **Price changes never propagate.** They increment the Offer version; live engagements keep
  their snapshot (§10).

---

## 5. Delivery time

- Declared **per package**, in business days, as a **maximum**, not an estimate.
- The clock starts at **requirements satisfaction**, not at activation. If the package has
  mandatory requirements and the buyer has not answered them, the engagement sits in
  `pending_requirements` and the clock does not run
  ([11 §1](./11-fulfillment-models.md)).
- Add-ons carry **delivery-day deltas** that add to the package's days.
- A **revision round pauses the delivery clock** and starts a separate, shorter revision
  clock.
- Provider **lead-time buffer** (a queue delay before the clock starts, declared on the
  Offer's availability) is disclosed to the buyer *before* purchase, and is added to the
  displayed "delivered by" date. Hiding queue time until after purchase is the most common
  source of avoidable lateness disputes.
- On-time performance is measured against the snapshotted date, adjusted only by recorded
  requirement delays, agreed Amendments, and revision pauses.

---

## 6. Revisions

- Declared **per package** as an integer, `0` to a configured maximum. `unlimited` is **not**
  offered: an unbounded obligation cannot be adjudicated, cannot be scheduled, and produces
  the worst disputes in this product. A provider wanting a generous policy sets a high number.
- A **revision round** is: the buyer rejects a delivery with specific, scoped feedback → the
  provider revises → the provider re-delivers. It consumes one revision.
- **What is not a revision:** a change to the agreed scope. That is an **Amendment**
  ([10 §6](./10-engagement-model.md)) or a paid add-on. The distinction must be enforced by
  the product, not left to negotiation, and the buyer-facing revision request form must ask
  the buyer to point at the scope item that was not met.
- Revision requests must be made **within the confirmation window** and must cite the
  deliverable and the scope item.
- **Revision exhaustion**: with zero revisions remaining, the buyer may accept, purchase a
  further revision as an add-on if offered, agree an Amendment, or dispute. It does not
  silently auto-accept mid-dispute.
- Each revision round is separately evidenced and versioned; prior deliverable versions are
  retained.
- Revision rate per offer and per provider is a quality metric, not a penalty.

---

## 7. Add-ons

- Defined **per Offer**, and each add-on declares which packages it applies to.
- Each add-on carries: title, description, price, delivery-day delta, quantity rules
  (single-select or multi-quantity with a cap), and any additional requirements it triggers.
- Add-ons are chosen **at purchase** and are part of the price snapshot. They cannot be added
  to a live engagement without an Amendment.
- Common shapes the model must support: extra revision, faster delivery, additional
  deliverable format, source files, extended session time, additional review round.
- **Add-ons may not be used to reconstruct the package.** An add-on that is required for the
  deliverable to be usable belongs in the package scope; this is a moderation rule with a
  measurable signal (an add-on attached to nearly every purchase).
- Add-on totals are capped relative to the base price by an admin-configurable multiple, to
  prevent a token base price with a mandatory expensive add-on.

---

## 8. Requirements

- **Structured intake questions** defined per Offer (and optionally per package), each with:
  question text, input type (short text, long text, number with unit, single/multi choice,
  date, file), mandatory flag, and help text.
- Answered by the buyer **at purchase** for direct package purchases, or at acceptance for
  awarded/custom engagements.
- **Mandatory requirements gate the clock.** An engagement with unanswered mandatory
  requirements sits in `pending_requirements`; the delivery clock does not run and prolonged
  buyer silence expires the engagement without penalty to the provider
  ([11 §1](./11-fulfillment-models.md)).
- Requirement **file uploads** follow the customer attachment rules: **manifest-only before
  activation for every file type, with no preview or sanitized rendition**, full access at D3.
  For a direct purchase, activation and requirement submission are close together, so in
  practice the provider sees the files immediately after accepting.
- Because file content is unavailable pre-activation, an intake that *needs* to be seen before
  pricing must express that need in **structured fields** — measurements with units, formats,
  counts, choices — rather than in a "please attach an example" question. An intake whose
  mandatory question is an attachment is an unpriceable intake and a moderation matter.
- Requirement answers are **part of the scope snapshot** and are what the delivery is
  adjudicated against alongside the package scope.
- Requirements may not ask for contact details, external links or payment information. This
  is an obvious bypass route and must be blocked at definition time, not at answer time.

---

## 9. Availability

Declared per Offer, with per-package overrides where useful.

| Control                       | Effect                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| Accepting / paused            | Paused offers keep their link and reviews but take no new requests ([06 §8](./06-offer-model.md)) |
| Per-package pause             | One tier can be closed while others stay open                                                     |
| **Concurrent-engagement cap** | A hard limit on live engagements from this Offer; reaching it auto-pauses new requests            |
| **Lead-time buffer**          | Queue delay added to the displayed delivery date, disclosed before purchase                       |
| Vacation / away mode          | Time-bounded pause across the identity, with an auto-resume date shown to buyers                  |
| Session slots                 | For session-shaped offers: working hours, slot length, buffer, blackout dates, booking horizon    |
| Buyer requirements            | Optional minimum buyer verification tier for the *request action*                                 |

The concurrent-engagement cap is the single most valuable availability control for an
individual Expert, because over-acceptance — not under-demand — is what destroys on-time
rates and produces the cancellations that damage reputation.

---

## 10. Custom proposals

A **Custom Proposal** is provider-authored bespoke terms offered to one named buyer.

**Two origins:**

1. **Against a Need** — the provider's Proposal is itself the bespoke terms
   ([05 §3](./05-need-model.md)).
2. **Against a Quote Request** — the buyer sends a structured request from an Offer or a
   provider profile; the provider replies with a Custom Proposal.

**Content:** title, scope statement with structured deliverables/inclusions/exclusions,
price and currency, payment plan shape, delivery time, revision count, optional session
component, optional add-ons, validity/expiry, and a cover note. Structurally it is a package
that exists for one buyer.

**Rules:**

- **No attachments and no links**, at either origin, before acceptance. If the scope cannot
  be expressed in the structured fields, it is not ready to be sold.
- **Validity period** is mandatory; an expired custom proposal cannot be accepted.
- The provider may **revise** it before acceptance (new version, buyer notified); the buyer
  may **decline** or let it expire.
- Buyer acceptance produces a pending arrangement, **not** an engagement: the provider must
  still activate and pay MHC. This matters — the provider authored the terms, but the
  *charge* happens at acceptance-of-the-acceptance, so the provider always has a final
  decision point and is never charged by a buyer's unilateral action.
- A Custom Proposal is **not published** and is invisible to anyone but its two parties.
- Custom proposals are subject to the same redaction, moderation and price-bound rules as
  packages.
- Repeated custom proposals to the same buyer for the same work, each undercutting the last,
  is a bypass pattern and is measured.

---

## 11. Versioning after purchase

This is where the immutability invariant becomes concrete.

| Event                                                            | Effect on live engagements | Effect on the Offer                              |
| ---------------------------------------------------------------- | -------------------------- | -------------------------------------------------- |
| Price change on a package                                        | **None**                   | Version increments; new purchases use the new price |
| Scope, deliverables, exclusions, delivery days, revisions change | **None**                   | Version increments                                 |
| Add-on added, repriced or removed                                | **None**                   | Version increments                                 |
| Requirements changed                                             | **None**                   | Version increments                                 |
| Package paused or deleted                                        | **None**                   | Discovery only                                     |
| Offer paused, hidden, rejected, archived                         | **None**                   | Discovery only                                     |
| Cosmetic edit (typo, media order)                                | None                       | No version increment                               |

Rules:

- **Every engagement records `offer_id` + `version` + a full inline snapshot.** The version
  reference is for analytics and review attribution; the inline snapshot is what governs,
  because it must survive the Offer being archived or the identity being suspended.
- **A version is never edited in place** once an engagement references it. Editing produces a
  new version; the referenced one is frozen.
- **Reviews record the version** they were earned on, and aggregate to both the Offer and the
  commercial identity ([14 §4](./14-reviews-and-reputation.md)).
- **A package cannot be deleted** if any engagement or review references it — it is paused or
  the Offer is archived.
- **The only way to change live terms is an Amendment**: explicit, mutually accepted,
  append-only, preserving the original ([10 §6](./10-engagement-model.md)). No edit path,
  no admin path and no support path may alter a snapshot. An administrator can annotate an
  engagement and can rule on a dispute; an administrator cannot rewrite what was sold.
