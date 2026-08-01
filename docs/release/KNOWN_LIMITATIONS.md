# Known Limitations

Gaps that are **deliberate, accepted, or inherent** — as distinct from defects, which live in
`AUDIT_MASTER.md`. Nothing here has been accepted by you yet; everything is marked
**Proposed** until you confirm it.

**Date:** 2026-07-28. **Baseline:** commit `f7fda17`.

---

## L1 — Inherent to the launch model

These follow from the decision to have customers pay providers directly. They are not bugs
and cannot be engineered away without changing the model.

### L1.1 — The platform cannot verify that a customer paid a provider

**Status:** Inherent · **Proposed acceptance**

With escrow retired, money moves off-platform. The platform sees that a provider spent MHC to
activate a job and that a customer later marked it complete. It has no evidence that payment
occurred, in what amount, or at all.

_Consequences:_ completion is customer-attested; a dishonest customer can receive work and
refuse to mark it complete; dispute resolution has no financial record to work from; the
platform cannot report GMV.

_Mitigation:_ Part B Phase 11 must define a dispute path that works without financial
records. Providers should be told plainly, in-product, that the platform does not hold or
guarantee job payments.

### L1.2 — MHC spent on activation is not refundable

**Status:** Inherent · **Proposed acceptance** · _Confirm in Phase 11_

MHC is non-cashable by design. A provider who activates a job that then collapses — customer
disappears, work cancelled, dispute lost — has spent credits with no automatic recourse.

_Consequences:_ provider dissatisfaction in exactly the situations where they are already
unhappy. This is the most likely source of early support load.

_Options not yet decided:_ no recourse; discretionary admin re-grant via
`type='adjustment'` (the ledger already supports it); or an automatic re-grant under defined
conditions. **This will become a blocking decision in Phase 11.** Flagged now so it is not a
surprise.

### L1.3 — The contact gate is defence in depth, not a guarantee

**Status:** Inherent · **Proposed acceptance**

`contact-redaction.ts` says so in its own header comment, and it is right. A determined pair
can split a phone number across messages, describe it obliquely, or agree to meet on another
platform. Redaction raises friction; it does not create a wall.

_Consequences:_ some proportion of matches will always leak off-platform. The commercial
question is what proportion, which only production data answers.

_Mitigation:_ attachments are blocked pre-activation, the award itself requires payment, and
`raw_content` preserves original text for moderation. Post-launch, monitor the ratio of
awards to activations — a large gap indicates leakage.

---

## L2 — Deliberately out of launch scope

### L2.1 — Tiered EGP→MHC exchange-rate pricing

**Status:** Explicitly excluded

`mhc_tiered_pricing_implementation_prompt.md` (850 lines, repo root) proposes a tiered
exchange-rate model. It is **not** to be implemented unless separately requested. Launch uses
the flat package model already in `mhc_credit_packages`.

_Follow-up:_ the file should move under `docs/` so it is not mistaken for an active
specification (MHC-22).

### L2.2 — Crypto MHC purchase (NOWPayments)

**Status:** Proposed deferral · _Depends on D6_

`credit_purchase_nowpayments` is set to `false` and `fulfilPurchaseFromWebhook` has no caller.
Launch uses manual InstaPay only. The webhook path also carries MHC-12's status-validation
gap and must not be enabled until that is fixed.

### L2.3 — Booking / reservation MHC activation

**Status:** Proposed deferral · _Depends on S1_

`activateBooking` is implemented but unwired (MHC-08). If bookings ship as-is, work obtained
through that path is free and ungated — an unpriced second door into the marketplace. If
bookings are deferred, the path should be **disabled** rather than left open and free.

### L2.4 — Advertisements and promotions on MHC

**Status:** Proposed deferral to immediately post-launch · _Depends on D6_

Four action keys (`advertisement`, `service_promotion`, `featured_provider`,
`promoted_proposal`) are seeded but unconsumed. Recommendation is free-only ads at launch
(see D6), with the paid MHC versions as the first post-launch feature.

---

## L3 — Accepted technical debt

Real, understood, and not worth fixing before launch.

| ID   | Limitation                                                        | Why accepted                                                                                                                                                                |
| ---- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L3.1 | Two implementations of award release and MHC grant exist (MHC-21) | Dead code; harmless until someone edits one and not the other. Consolidated during Part A M6.                                                                               |
| L3.2 | MHC wallets store `currency = 'EGP'` (MHC-23)                     | `asset_code` is authoritative in every query. Cosmetic until reporting is built.                                                                                            |
| L3.3 | `NUMERIC(14,2)` MHC columns vs `NUMERIC(12,2)` ledger (MHC-24)    | Only reachable at absurd values. Fix when a package exceeds 10^10 MHC — i.e. never.                                                                                         |
| L3.4 | `getMyCredits` writes a wallet row on read (MHC-25)               | Idempotent, harmless, and removing it risks a null-wallet path elsewhere.                                                                                                   |
| L3.5 | No generated database types                                       | 83 hand-applied migrations and hand-written row types. Introducing generation now would touch every repository. Phase 17 adds a consistency **check** instead of a rewrite. |
| L3.6 | Retired escrow code remains in the tree                           | Fenced behind a fail-closed flag, preserves auditable history. Deleting a large money path during a recovery adds risk for no launch benefit (see D6).                      |

---

## L4 — Operational limitations at launch

### L4.1 — MHC purchases require manual admin approval

Every credit purchase goes through `pending_review` and an admin decision. Providers wait for
a human before they can activate a job.

_Consequence:_ purchase-to-activation latency is bounded by admin availability, not by
technology. At launch volume this is fine; it will not scale, and it is a poor experience for
a provider who has just been awarded work and wants to accept immediately.

_Mitigation:_ set an internal response-time target and staff to it. Automating this requires
the crypto or card rail (L2.2).

### L4.2 — MHC prices are all zero and inactive at launch

**Status:** Requires action before launch — see **S3**

Every row in `mhc_action_prices` is seeded at `mhc_price = 0, is_active = false`, and
`chargeActivation` treats an inactive or zero price as free. Until an admin configures
prices, **activation is free and the platform earns nothing.**

This is correct behaviour — session 1 deliberately avoided hardcoding prices — but it means
the revenue model is inert until someone sets numbers in the admin panel. There are also no
seeded `mhc_credit_packages` rows at all, so there is nothing for a provider to buy.

### L4.3 — Manual migration application

No migration runner and no per-environment record of applied migrations (MHC-13). Deploys
require a human to apply SQL in the correct order. Phase 17 addresses it; until then, treat
every deploy involving a migration as a manual, checklist-driven operation.

### L4.4 — No E2E test coverage

`apps/e2e` exists with a Playwright harness but no spec files. Every end-to-end scenario in
`MHC_RECOVERY_PLAN.md` A5 is currently a **manual** test. Phase 24 writes specs for the
critical paths; before then, regression confidence rests on unit tests and manual passes.

---

## L5 — Things I have not verified

Stated so this document's silence is not mistaken for assurance.

- Whether production holds real users, real EGP balances, or real transaction history
  (**S4**, **D1**).
- Which migrations are applied to which environment (**S2**).
- Whether the reservations, jobs, milestone-escrow, dispute, notification, admin-permission,
  and auth modules contain findings — none has been read (see `AUDIT_MASTER.md`,
  "Modules not yet audited").
- Whether the web application has RTL, responsiveness, or API-contract-drift problems.
- Whether backups exist and whether a restore has ever succeeded.

Each is assigned to a Part B phase. None should be assumed benign.
