# Wave 3 — Product Architecture

**Status:** architecture, approved-baseline-bound, **reconciled**. **Date:** 2026-08-02.
**Scope of this document set:** product architecture only. No schemas, no tables, no
endpoints, no tickets, no code.

**Repository baseline:** Wave 2 final baseline `11ae5cf64de2e0a47f2a453ab82ffe2de47cc70b`;
103 production migrations; urgent chat disclosure correction
`bc1681b5cee9f772402bc5ba8a5599e161da871d` ([00 §9](./00-overview-and-terminology.md)).

**Decision status:** all eight high-impact product decisions are **resolved**
([18](./18-decisions-required.md)). Two items — live verified-GMV rent charging and rent-driven
suspension — are deliberately deferred to a later explicit production decision and do not block
Wave 3.

This set defines what MohandisHub *is* in Wave 3: four roles, one engagement spine, one
disclosure gate, one credit gate, and an honest settlement record. It is written so that
engineering can derive schemas, APIs, permission matrices, state machines and test suites
from it without reopening product questions.

---

## Reading order

| #                                                | File                              | What it settles                                                              |
| ------------------------------------------------ | --------------------------------- | ---------------------------------------------------------------------------- |
| [00](./00-overview-and-terminology.md)           | Overview and terminology          | The identity/context model, disclosure tiers, verification tiers, vocabulary |
| [01](./01-role-customer.md)                      | Customer                          | The universal capability every identity holds                                |
| [02](./02-role-expert.md)                        | Expert                            | Personal provider — knowledge and professional work                          |
| [03](./03-role-craftsman.md)                     | Craftsman                         | Personal provider — local services, shops, physical goods                    |
| [04](./04-role-business.md)                      | Business                          | Organizational commercial identity, buys and provides                        |
| [05](./05-need-model.md)                         | **A** — Customer Need model       | Demand: types, visibility, eligibility, budgets, award, expiry               |
| [06](./06-offer-model.md)                        | **B** — Provider Offer model      | Supply: shared attributes, four offer kinds, lifecycle states                |
| [07](./07-expert-packages.md)                    | **C** — Expert packages           | Packages, add-ons, requirements, custom proposals, versioning                |
| [08](./08-craftsman-storefront.md)               | **D** — Craftsman storefront      | Shop identity, catalogs, variants, areas, delivery, inventory limits         |
| [09](./09-business-buying-and-providing.md)      | **E** — Business dual activity    | Procurement/sales separation, owner authority, Wave 4 containment            |
| [10](./10-engagement-model.md)                   | **F** — Engagement model          | The single spine every accepted arrangement converges into                   |
| [11](./11-fulfillment-models.md)                 | **G** — Fulfillment models        | Ten fulfillment types × eight behavioural dimensions                         |
| [12](./12-payment-and-settlement.md)             | **H** — Payment and settlement    | Off-platform money, evidence ladder, verified GMV, honesty limits            |
| [13](./13-mhc-activation.md)                     | **I** — MHC activation model      | The revenue gate and the anti-bypass regime                                  |
| [14](./14-reviews-and-reputation.md)             | **J** — Reviews and reputation    | Targets, eligibility, moderation, identity separation                        |
| [15](./15-suspension-and-enforcement.md)         | **K** — Suspension and enforcement| Two independent axes; obligations survive both                               |
| [16](./16-wave-3-scope.md)                       | **L** — Wave 3 scope              | Deliver / defer / must-not-build-by-accident                                 |
| [17](./17-product-invariants.md)                 | **M** — Product invariants        | INV-001…INV-104, each with an enforcement layer                              |
| [18](./18-decisions-required.md)                 | **N** — Resolved decisions        | All eight decisions settled, with reasoning and rejected alternatives        |

---

## The Wave 3 sentence

> A customer states a **Need** or buys from an **Offer**; a provider accepts; acceptance
> costs the provider **MHC** and is the moment protected information is disclosed; the
> accepted arrangement becomes an **Engagement** carrying immutable commercial snapshots;
> the Engagement is fulfilled through one or more typed **Fulfillment Components**; money
> moves **directly between the parties, off-platform**, and is recorded as **evidence** that
> can be reported, confirmed, verified, disputed or rejected; only confirmed or verified
> settlement counts as verified GMV; reputation attaches to the **commercial identity** that
> did the work and never mixes across identities.

Everything in these eighteen files is an elaboration of that sentence.

Four clarifications the reconciliation made load-bearing, stated here because each is the thing
a reader most often gets wrong:

1. **Pre-award conversation is open; pre-award payload is closed.** Buyer and provider may talk
   freely before activation, and every character is contact-masked. **No attachment of any type
   is accessible before activation** — no previews, no sanitized renditions, no exceptions.
2. **Completion is about work; settlement is about money.** They are independent. An engagement
   may be completed while unpaid, and auto-confirming fulfillment confirms nothing about payment.
3. **Business teams administer; owners transact.** Team administration works. Commercial
   authority is owner-only until Wave 4.
4. **Rent is calculated, not charged.** The whole verified-GMV rent chain ships and runs in
   shadow mode. Nothing is deducted.

---

## What this document set deliberately does not do

- It does not design database tables, columns, indexes or migrations.
- It does not specify API routes, payloads or status codes.
- It does not create implementation tickets or estimate work.
- It does not reopen settled product decisions (see the approved baseline in
  [00 §1](./00-overview-and-terminology.md)).
- It does not describe a generic marketplace. Every model here is shaped by three
  constraints that are specific to MohandisHub: money never touches the platform,
  disclosure is the product, and provider credit is the revenue.

---

## Relationship to existing repository documents

| Existing document                                        | Relationship                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `docs/audit/2026-07-29-marketplace-coherence/02-*`        | Its "one identity, many workspaces" proposal is superseded by the context model in **00**. |
| `docs/release/KNOWN_LIMITATIONS.md` L1.1–L1.3             | Carried forward and made structural rather than apologetic (see **12**, **13**).           |
| `docs/release/KNOWN_LIMITATIONS.md` L1.2 (MHC recourse)   | Answered in **13 §9**.                                                                     |
| `docs/ESCROW_AND_DISPUTES.md`                             | Obsolete for Wave 3. Escrow is retired; **12** replaces its release rules entirely.        |
| `docs/release/LAUNCH_CONSTRAINTS.md` LC-01, LC-02         | Untouched. Advertisement and plan pricing remain outside Wave 3 scope (**16 group 3**).    |
| Wave 2G/2H business teams                                 | **Retained.** Team administration stays available with `manage_team` enforced; commercial authority is owner-only; the six reserved permissions stay disabled (**09 §4**). |
| Wave 2I Help & Resolution Center                          | Becomes the single surface for disputes, appeals and settlement escalation (**15 §8**).    |
| Chat conversation-summary fix `bc1681b`                   | A confirmed Wave 2 disclosure defect, **fixed**. No longer a Wave 3 architecture blocker. Its regression tests are standing security invariants (**00 §9**, **17 §12**). |
