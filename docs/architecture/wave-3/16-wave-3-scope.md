# L — Wave 3 Scope

Three groups. Group 1 is the contract. Group 2 is what the architecture must not preclude.
Group 3 is what must not appear by accident, by copy-paste, by an enabled flag, or by a
well-meaning "while we're in here".

---

## Group 1 — Must be delivered in Wave 3

### 1.1 Identity and context

- Identity with **universal customer capability**, non-removable.
- **Personal Commercial Identity**: at most one per identity, typed Expert **xor** Craftsman,
  with its own profile, offers, reputation and MHC balance.
- **Business Commercial Identity**: zero or more per identity, owner-only *commercial* authority, own
  profile, offers, reputation and MHC balance.
- **Acting context** resolved server-side on every commercial write:
  `personal_buyer` · `personal_provider` · `business:<id>`.
- **Self-dealing prevention** across all related identities.
- Verification tiers **V0/V1/V2/V3a/V3b** with category-gated credential requirements, expiry
  and re-verification, and **snapshotting onto engagements**.
- **Graduated Business verification**: V3a gates buying, V3b (KYB) gates providing, with
  admin-configurable step-ups for high-risk or high-value procurement
  ([00 §4.1](./00-overview-and-terminology.md)).
- **PCI conversion (Expert ⇄ Craftsman) — delivered as an Admin/Support-controlled operation**
  ([00 §3.5](./00-overview-and-terminology.md)). Wave 3 ships it operationally, not merely as a
  compatible data shape:

  | Delivered                                                        |
  | ---------------------------------------------------------------- |
  | Conversion-safe data and domain architecture                     |
  | PCI archival — source archived, never retyped in place           |
  | Replacement PCI creation at zero reputation                      |
  | Eligibility validation                                           |
  | Blocking validation for unresolved commercial obligations        |
  | **Audited MHC carryover** ([13 §1.1](./13-mhc-activation.md))     |
  | **Admin/Support authorization** on every execution               |
  | Recorded conversion **reason**                                   |
  | **Immutable conversion audit history**                           |
  | User notifications                                               |
  | **Safe rollback / failure behaviour before final commit**        |
  | **Idempotency protection**                                       |
  | Admin-configurable conversion cooldown                           |

  Deliberately **not** delivered: a user-facing "Switch to Expert / Switch to Craftsman" button,
  self-service conversion, automatic approval, repeated user-controlled switching, or any
  general MHC transfer interface (Group 3).
- **Business team administration retained**: `manage_team` enforced, the six reserved
  permissions disabled, membership history preserved, commercial authority owner-only
  ([09 §4](./09-business-buying-and-providing.md)).

### 1.2 Disclosure gate

- **D0/D1/D2/D3** tiers with every field assigned to exactly one.
- Contact redaction across every pre-activation free-text surface, including evasion forms.
- **Total attachment lock at D2 — every file type, no preview exception of any kind.**
- **Pre-award communication**: structured clarification **and** contact-masked free-form text,
  moderated, turn-capped and rate-limited.
- **Structured requirement attributes** rich enough to price from, per type and per category,
  since they replace what previews were carrying.
- Exact location, payment instructions and full contact at **D3 only**.
- D3 opened **exclusively** by successful Engagement Activation.
- **Conversation-list and historical-preview redaction regression tests** as standing security
  invariants ([00 §9](./00-overview-and-terminology.md)).

### 1.3 Demand

- **Needs** with six types, three audience modes, fixed depth rules, four budget modes,
  the location precision model, the attachment model, the award flow and the full
  cancellation/expiry lifecycle.
- **Proposals**: free, quota-limited, sealed, structured, no attachments, withdrawable,
  versioned on edit.
- **Quote Requests** and **Custom Proposals**.

### 1.4 Supply

- **Offers** in four kinds with the shared attribute spine, versioning, and the
  draft/pending/published/paused/hidden/rejected/archived lifecycle.
- **Expert packages**: 1–3 tiers, optional, with scope, pricing, delivery time, counted
  revisions, add-ons, requirements intake, availability, and post-purchase version immutability.
- **Craftsman storefront**: shop identity, service catalog, product catalog with variants,
  made-to-order with the spec-confirmation gate, service areas with travel fees, delivery,
  pickup, installation, availability, and the manual stock-status model with its limitations
  stated in-product.
- **Business offers**: all four kinds under an organizational identity, no fifth kind.
- Moderation on publish and on material edit.

### 1.5 The engagement spine

- **One Engagement concept**, five origins, one lifecycle, overlays as flags.
- **Immutable snapshots**: origin, buyer party, provider party, price, scope, location,
  verification, acting humans.
- **Fulfillment Components** with declared dependencies; hybrid as composition, not a type.
- **Amendments**: mutual, append-only, non-destructive, no extra MHC charge.
- Completion, cancellation with mandatory cause codes, expiry across three clocks, and the
  historical-integrity guarantees.

### 1.6 Fulfillment

- All ten fulfillment types with their scheduling, evidence, completion, confirmation,
  correction, inactivity, dispute and review behaviour as specified in
  [11](./11-fulfillment-models.md).
- Type-specific hard rules: the **spec-confirmation gate**, the **workshop intake record**,
  **arrival check-in**, **handover codes where the policy requires them**, and **no
  auto-completion for pickup or pre-handover workshop work**.
- **Configurable evidence policies** resolved by fulfillment type, category, risk level,
  delivery method and engagement terms ([11 §1.2](./11-fulfillment-models.md)) — never a
  universal mandate applied regardless of what is being delivered.
- **Auto-confirmation** with configurable windows per fulfillment type, timers that start only
  on a valid provider submission and pause on correction requests, issue reports and disputes,
  warnings before firing, and **high-risk escalation to manual review**.
- Evidence retention beyond the engagement.

### 1.7 Payment and settlement

- Payment instructions at D3, snapshotted, with change notification.
- **Agreed amount** and **payment plans** (single, deposit + balance, instalments) in the
  snapshot.
- **Settlement records** with the full evidence ladder: reported → counterparty_confirmed →
  admin_verified, plus disputed / rejected / withdrawn.
- Partial coverage, deposits, instalments, over-coverage flagging.
- **Off-platform refunds** as reported records, netting against verified GMV.
- **Verified GMV** computed from **settlement tranches** only — confirmed and verified records,
  net of refunds, attributed per provider commercial identity, restatable.
- **Period closing** per commercial identity, with immutable closing records and auditable
  restatement of late or reversed tranches.
- **Tier calculation** against an admin-configurable tier table, and **expected-rent
  calculation** from the resolved tier.
- **Admin reporting** across verified GMV, tiers, expected rent and restatement history.
- **Completion and settlement as independent state dimensions**, with the mandatory
  settlement-reporting step in the completion flow and the `settlement_open` overlay.
- The **honesty constraints** in [12 §13–§14](./12-payment-and-settlement.md), enforced as
  copy rules and, where mechanical, as tests.

### 1.8 MHC activation

- Five activation action keys, one per origin, **fixed-price and admin-configurable**, with
  price resolution by origin, category and configured action tier, failing closed on an
  inactive or unset price.
- **One activation pipeline for every origin**, with no exempt path.
- **Atomic** charge + engagement creation + disclosure, idempotent under concurrency.
- Per-commercial-identity balances; purchase; ledger.
- Activation windows per origin, booking-capped by slot start.
- Insufficient-credit behaviour that does not leak provider finances to the buyer.
- **Re-grants** limited to the closed ground list in [13 §9](./13-mhc-activation.md), recorded
  as **explicit ledger counterentries** that never reverse the original debit, capped, audited,
  credit-only, with configurable reasons.
- The anti-bypass regime: content controls, structural controls, behavioural detection,
  conduct prohibitions.

### 1.8a Verified-GMV rent — shadow mode only

- The full calculation chain of §1.7, plus the **shadow entry series** recording what rent
  would have been charged per identity per closed period.
- Administrative reporting on shadow entries and tier distribution.
- **No deduction, no ledger debit, no provider-facing charge, and no rent-driven suspension**
  ([13 §11](./13-mhc-activation.md)). Live charging is a separate, explicit production
  decision that Wave 3 does not take and must not pre-empt.

### 1.9 Reputation

- Reviews targeting the commercial identity, with offer/package/product/variant attachment and
  version recording.
- Per-role criteria sets; aggregates with counts and distributions.
- Structured, non-public **buyer conduct** ratings and bands.
- Eligibility, timing, one edit, moderation, one provider response.
- **Dispute hold** on publication; **no reviews on cancelled engagements**.
- **Reliability metrics** as a separate, computed signal.
- **Reputation isolation** across every identity boundary, enforced at aggregate computation.

### 1.10 Enforcement

- The two independent axes, the six-step ladder, offer hiding with cause-based restoration,
  proposal/booking restrictions that never produce a debit.
- The four survival guarantees: engagement access, delivery access, dispute access, payment
  evidence access — in **every** state including termination.
- Customer remedy protection; surface-scoped suspension for Business; explicit-only
  cross-identity cascade; one appeal per action; constrained termination.

### 1.11 Cross-cutting

- Every Wave 4 tripwire in [09 §6](./09-business-buying-and-providing.md) implemented as a
  **negative test**.
- Every invariant in [17](./17-product-invariants.md) with an identified enforcement layer.
- Analytics per role with the reported/confirmed/verified labelling discipline.
- Notifications for every state transition, deadline and evidence event on both sides.

---

## Group 2 — Architecture-compatible but deferred

These must **fit without redesign** when they arrive. Nothing in Wave 3 may make them require
a migration of engagement, settlement or reputation data.

| Deferred capability                                                 | What Wave 3 must already carry so it lands cleanly                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Delegated commercial authority for Business members**             | Team administration already ships; `manage_team` enforced and the six reserved permissions already named, stored and disabled; acting-human attribution on every Business action; the owner check isolated in one place |
| **Spend limits, budgets, approval chains, maker/checker**           | MHC spend as a distinct, attributed authorization point                               |
| **Workspace-scoped commercial context**                             | `business_teams.business_id` already the immutable commercial principal; workspace selection deliberately scoped to team administration only |
| **Staff assignment to engagements and components**                  | Components as first-class objects with their own state and evidence                   |
| **Branches and multi-location**                                     | Service areas and locations as data on the identity, not hardcoded to one             |
| **Workspace-owned assets**                                          | Assets already owned by the commercial identity, not by the person                    |
| **Business ownership transfer**                                     | Ownership as an explicit relation, snapshots independent of the current owner          |
| **Real inventory** (quantities, reservations, decrement, backorders)| Per-variant status as a field a quantity model can derive rather than replace          |
| **Milestone-structured engagements**                                | Components with dependencies and independent completion                                |
| **Multi-item cart, multi-provider checkout**                        | Engagement already supports multiple line items from one provider                     |
| **Recurring engagements, retainers, maintenance contracts**         | Engagement origin as an enum with room; snapshots per instance                         |
| **Live charging of tiered monthly MHC rent**                        | The entire chain already built and running in **shadow mode** — verified GMV, tranches, period closing, tiers, expected rent, reporting. What is deferred is the debit, not the model ([13 §11](./13-mhc-activation.md)) |
| **Rent-driven commercial suspension**                               | Enforcement axes already independent of any balance; rent explicitly excluded as a trigger ([15 §4](./15-suspension-and-enforcement.md)) |
| **Automated MHC purchase rails** (card, crypto)                     | Purchase decoupled from the activation charge primitive                                |
| **Payment-rail verification** (bank feed, provider API)             | Settlement ladder already has an `admin_verified` rung an automated verifier can fill |
| **Public free-text buyer reviews**                                  | Buyer conduct already structured and stored per engagement                             |
| **Multi-currency pricing and FX**                                   | Currency on every price snapshot and settlement record                                 |
| **Carrier integration and tracking**                                | Delivery as a component with handover evidence, extensible with a tracking reference  |
| **Route-aware scheduling and capacity optimization**                | Slots, buffers and daily caps already modelled                                        |
| **Structured warranty claims as their own object**                  | Warranty windows and rectification rounds already on the snapshot                     |
| **Contract templates, e-signature, legal invoicing, tax documents** | Snapshots already contain everything such a document would render                     |
| **Structured-only pre-award communication** as an optional per-category or under-enforcement mode | The structured Q&A surface already exists alongside free-form; restricting to it is a policy switch, and is explicitly *not* a replacement for the shipped model |
| **Paid promotion, featured placement, advertisements, paid plans**  | Action-key pricing table exists and is inactive; see Group 3 for the prohibition       |

---

## Group 3 — Explicitly prohibited from accidental implementation in Wave 3

Not "later". **Not in this wave, not partially, not behind a flag that could be switched on,
not as scaffolding.** Each of these has a plausible route into the codebase, which is why it
is named.

### 3.1 Money the platform must not touch

1. **Escrow, holds, milestone holds, or platform-held funds** of any kind. The retired escrow
   code must stay fenced and fail-closed; it must not be revived, partially reused, or
   referenced by any new path. `docs/ESCROW_AND_DISPUTES.md` is obsolete and must not be
   treated as a live specification.
2. **Withdrawals, payouts, provider cash balances, earnings wallets** — no surface, no
   endpoint, no flag, no "coming soon" affordance. `canRequestWithdrawal` must stay false.
3. **Platform-executed or platform-promised refunds**, chargebacks, reversals or compensation.
4. **Card, crypto or any payment acceptance for engagement value.** MHC purchase is the only
   money the platform takes.
5. **Automatic verification of settlement from a proof file** — no OCR-to-truth, no
   "verified because a screenshot was attached".
6. **Any copy, badge, receipt, notification or determination** violating
   [12 §14](./12-payment-and-settlement.md).

### 3.2 The gate

7. **Paid bidding, paid proposals, proposal boosts, pay-to-view-Need** — unapproved.
8. **Promoted proposals, featured provider placement, service promotion, advertisements** —
   the action keys exist and are inactive; they must not be wired to anything in Wave 3
   (`LAUNCH_CONSTRAINTS.md` LC-01).
9. **Paid plans and subscription upgrades** — `pause_plan_subscriptions` stays on
   (`LAUNCH_CONSTRAINTS.md` LC-02).
10. **Any pre-activation channel that escapes redaction and moderation.** Pre-award
    communication itself is approved and delivered, structured and free-form alike
    ([00 §5.1](./00-overview-and-terminology.md)); what is prohibited is an unmasked channel,
    an unmoderated one, or any route that reaches a counterparty outside the D2 surface.
11. **Any disclosure of contact, exact location, attachments or payment instructions before a
    successful charge** — including previews, partial reveals, "shortly" placeholders, and
    map radii fine enough to identify an address.
12. **Any pre-activation attachment preview**, of any file type, under any treatment.
    Watermarking, downscaling, EXIF stripping, OCR screening, contact scanning and a "safe
    image" determination are all prohibited routes to the same prohibited disclosure.
13. **Guest-visible Needs** or any unauthenticated demand index.
14. **Value-based or percentage-based activation pricing.** Prohibited outright, not pending
    anything ([13 §3](./13-mhc-activation.md)).
15. **Live verified-GMV rent charging**, any MHC deduction for rent, and any suspension,
    restriction or enforcement triggered by a rent figure. Rent is shadow mode in Wave 3 and
    going live is a separate explicit production decision ([13 §11](./13-mhc-activation.md)).
16. **Customer-side MHC** — balances, purchases, charges or surfaces of any kind.
17. **MHC transfer, gifting, sale, pooling or conversion** between any two identities, and
    **MHC cashout** in any form. The audited carryover inside an Admin/Support-executed PCI
    conversion ([13 §1.1](./13-mhc-activation.md)) is the sole exception, and **no
    user-accessible transfer interface, partial-move capability or reusable transfer primitive
    may be built from it**.

### 3.3 Wave 4 leakage

18. **Any commercial action by a non-owner on behalf of a Business** — the tripwires in
    [09 §6](./09-business-buying-and-providing.md), each as a negative test. Team
    administration under `manage_team` is **not** covered by this and continues to work.
19. **Displayed-but-unenforced permissions presented as effective**: role pickers, capability
    lists and seat counters that imply a member can act commercially. The six reserved
    permissions may be shown under their reserved label; they may never be shown as granted,
    effective or working.
20. **Wiring any reserved team permission to an authorization decision** —
    `manage_services`, `manage_jobs`, `manage_reservations`, `view_wallet`,
    `manage_support_disputes`, `view_analytics`.
21. **Deleting or disabling historical membership data** — memberships, invitations, roles or
    audit records, including roles carrying a reserved permission.
22. **Extending workspace selection to set commercial acting context.**
23. **Engagement or component assignment** to anyone other than the acting owner.
24. **Branches, sub-entities, second brands** inside one BCI, including simulation via
    categories, tags or duplicate offers.
25. **A separate "workspace" object** introduced as scaffolding for Wave 4.
26. **Cross-BCI aggregation**, parent/subsidiary relations, or public linkage of two
    identities with a common owner.
27. **Self-serve business ownership transfer.**

### 3.4 Identity and reputation

28. **A second PCI**, or an identity holding both Expert and Craftsman — including
    transiently, during a conversion. Archival completes before the replacement is enabled.
29. **Any person-level rating**, combined score, "also operates" surface, linked-accounts view,
    or cold-start prior derived from another identity's reputation.
30. **Reputation migration** in any direction between any two commercial identities,
    **including between an archived PCI and its replacement**.
31. **Any market-facing linkage of an archived PCI to its replacement** — "previously traded
    as", merged aggregates, redirected profiles.
32. **Converting a PCI around a live obligation** — pending provider activation, an active
    engagement, incomplete fulfillment, pending customer confirmation, an open correction
    request, an open dispute or case, an unresolved settlement issue, an active suspension
    investigation, or any other unresolved commercial obligation. **No administrative override
    exists.**
33. **Self-service PCI conversion in Wave 3** — a user-facing "Switch to Expert / Switch to
    Craftsman" control, automatic approval, or repeated user-controlled switching. Conversion is
    Admin/Support-executed, and a configured cooldown of any length does not make it
    self-service.
34. **Mutating a PCI's commercial type in place.** Conversion archives a source and creates a
    replacement; it never retypes the source identity.
35. **Using conversion to evade** suspension, disputes, poor reputation, settlement review,
    verified-GMV or rent obligations, or any enforcement action
    ([15 §9.1](./15-suspension-and-enforcement.md)).
36. **Leaving MHC spendable by both** an archived PCI and its replacement, or forfeiting a
    provider's available balance on a valid conversion.
37. **Reviews on unactivated or cancelled engagements.**
38. **Transaction-value-weighted star ratings**, or any aggregate, badge or ranking input that
    weights reviews by agreed amount, settled amount or verified GMV.
39. **Review removal at the reviewed party's request**, or any review-for-settlement mechanism.

### 3.5 Data and integrity

40. **Editing an engagement snapshot** by any actor — party, support or administrator.
41. **Deleting engagements, evidence, settlement records, messages or case history**,
    including in response to account-deletion requests (pseudonymize instead).
42. **Hard-deleting an offer, package, product or variant** that carries an engagement or a
    review.
43. **Silent restatement of verified GMV** without an auditable trail.
44. **Auto-confirmation of a settlement record** from silence — money is never presumed.
45. **Auto-completion of pickup or pre-handover workshop components.**

### 3.6 Scope creep with a plausible excuse

46. **Real inventory**, even "just a quantity field that we won't use yet".
47. **Carrier integration or tracking numbers**, even as a free-text field presented as
    tracking, and **never as a universal evidence requirement** for physical products
    ([11 §1.2](./11-fulfillment-models.md)).
48. **Universal evidence mandates applied regardless of fulfillment type** — a customer OTP on
    every on-site service, carrier tracking on every physical product, or a platform-uploaded
    SHA-256 artifact on every digital engagement. Evidence is policy-resolved, not decreed.
49. **A generic marketplace cart** or multi-provider checkout.
50. **Tax computation, legal invoices, or accounting exports** presented as authoritative
    documents.
51. **Milestones**, in any form, on any engagement.
52. **Personalized ranking that sells placement** without labelling it.
53. **Any feature justified by "the schema already supports it"** — every item in Group 2 is
    architecture-compatible on purpose, and compatibility is not permission.
