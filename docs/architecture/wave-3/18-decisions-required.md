# N — Resolved Product Decisions

**Status: all eight decisions are resolved. No high-impact product decision remains open.**

This file previously held eight blocking decisions with recommended defaults. Every one has now
been decided. It is retained rather than deleted because the _reasoning_ behind each decision is
what stops it being reopened by someone who only sees the rule — and because the rejected
alternatives are the shapes this architecture must not drift back into.

Each entry below records: the question, **the decision**, where it is specified, why it was
decided that way, and what was rejected.

Deliberately still out of scope here: naming, wording, layout, thresholds, window lengths,
quota sizes, prices, tier bands, cooldown durations, and anything else that lives safely in
admin configuration.

---

## 1. Personal commercial identity type change — **RESOLVED**

**Question:** Can an identity whose PCI is Expert later become a Craftsman (or the reverse), and
if so what happens to reviews, engagements, offers and MHC balance?

### Decision

**Permitted, and delivered in Wave 3 as an Admin/Support-controlled operation** — an audited
archival-and-replacement with **available-MHC carryover** and no reputation carry-over.

**Conversion mechanics**

- The source PCI is **archived, never mutated, never retyped, never deleted.** A **replacement
  PCI** of the other type is created at zero reputation with a new provider profile.
- The archived identity stays available for historical engagement, review, dispute, settlement,
  audit and administrative views. It **cannot** publish offers, submit proposals, accept
  bookings, activate engagements, spend MHC, or acquire new commercial work.
- **Historical reviews and reputation remain permanently attached to the archived PCI.**
- **Reviews, reputation, ratings, offers, services, products, portfolio, provider analytics,
  search ranking, fulfillment history and provider-type-specific commercial verification do not
  transfer.**
- **Account-level identity evidence may be reused only where still valid and applicable.**
  Role-specific onboarding, eligibility and verification are completed again in full.
- Source and replacement are linked by an **immutable audited conversion record**.

**MHC carryover** — _approved separately and recorded here in full_

- **The remaining available MHC balance carries over to the replacement PCI.** It is neither
  forfeited nor permanently frozen.
- Carryover happens through a **special audited system conversion operation**. It is **not a
  user-accessible MHC transfer feature**, and must not enable transfers between arbitrary
  personal identities, Business identities or users.
- **The archived PCI finishes at a zero available balance**; the replacement receives **exactly**
  that amount. No MHC is created, destroyed, duplicated, or left spendable by both identities.
- The operation is **atomic and idempotent**, and **preserves complete ledger history**.
  Historical MHC transactions remain attributable to the archived PCI.
- **Only the remaining available balance carries, and the rule is deterministic and fails
  closed.** **Any non-final MHC state on the source blocks the conversion** — pending MHC
  purchase, pending credit approval, reserved MHC, held MHC, pending action charge, disputed
  action charge, pending refund, pending reversal, unresolved chargeback, in-flight idempotent
  ledger operation, unreconciled balance discrepancy, or any other non-final state. Each must
  reach a **final ledger outcome before conversion executes**; there is no
  reconcile-during-conversion path and **no operator override**.
- **Pending, reserved, held and disputed balances never transfer**, in whole or in part.
  **Reversed, refunded, expired, cancelled and failed ledger entries remain immutable
  historical records and never become available carryover.**
- After success: the source's **available balance is zero**, the **source cannot spend**, and
  the replacement holds **exactly** the source's final available balance. **Concurrent
  conversion requests allow exactly one success**, and retry duplicates no credit.
- The audit record identifies: source PCI, replacement PCI, user/account owner, amount moved,
  original ledger balance, conversion event, Administrator or Support actor, timestamp, reason.

**Authorization and Wave 3 delivery**

- **Only authorized Admin/Support actors may execute a conversion.** Wave 3 ships conversion-safe
  architecture, archival, replacement creation, eligibility validation, blocking validation,
  audited carryover, Admin/Support authorization, conversion reason, immutable audit history,
  user notifications, safe rollback before final commit, and idempotency protection.
- Wave 3 ships **no** user-facing "Switch to Expert / Switch to Craftsman" button, **no**
  self-service conversion, **no** automatic approval, **no** repeated user-controlled switching,
  and **no** general MHC transfer interface.
- Conversion is **rejected** while any unresolved commercial obligation exists — pending provider
  activation, active engagement, incomplete fulfillment, pending customer confirmation, open
  correction request, open dispute or case, unresolved settlement issue, active commercial
  suspension investigation where conversion could evade enforcement, or any other unresolved
  obligation defined by the engagement lifecycle. **No administrative override.**
- **Conversion must not be usable to evade** suspension, disputes, poor reputation, rent
  obligations, settlement reviews or enforcement actions.
- An **admin-configurable cooldown** may apply. **Cooldown configuration does not create
  self-service conversion** — the workflow stays Admin/Support-controlled at any setting.

**Specified in:** [00 §3.5](./00-overview-and-terminology.md) · [13 §1.1](./13-mhc-activation.md) ·
[14 §3](./14-reviews-and-reputation.md) · [15 §9.1](./15-suspension-and-enforcement.md) ·
[16 §1.1](./16-wave-3-scope.md) · [17](./17-product-invariants.md) INV-009d–l, INV-059a–f,
INV-072a–b

### Why

Trades and careers change; this is a foreseeable, non-rare request. Refusing it drives people to
create second accounts, which produces duplicate-identity enforcement cases and a worse data
model than the one refusal was protecting. Archival is what makes it safe: reputation stays with
the work it describes, and a buyer reading an Expert's reviews is never shown a Craftsman's
punctuality record as if it were analysis quality.

The decision had to be made **before** implementation because it determines whether PCI type is a
fixed attribute or a lifecycle with archival — which changes how reputation aggregates, offers,
engagement snapshots and profile reads are keyed. Retrofitting archival onto an attribute assumed
permanent means rewriting every reputation and profile read path after real data exists.

### Why the MHC carryover is safe

MHC non-transferability exists to stop credit becoming a currency — pooled, gifted, sold, or
moved between market participants. The carryover does none of that. It is operator-executed
inside one lifecycle event, scoped to **one natural person's one PCI slot**, and it empties the
source in the same transaction that funds the replacement. No second identity ever holds
spendable credit, and there is no surface a user could reach.

The alternative — forfeiting the balance — would make conversion a punishment for a legitimate
career change, and would push providers to burn credit on marginal activations before converting,
which corrupts the activation data. Freezing it permanently would be the same outcome with worse
bookkeeping.

### Rejected

**Immutable PCI type.** Simplest to build and impossible to abuse, but it pushes real users into
duplicate accounts and produces exactly the identity-fragmentation the exclusivity rule exists to
prevent.

**Conversion with reputation carry-over.** Would have made conversion painless and is what users
will ask for. Rejected because it is reputation transfer between two commercial identities, which
the baseline prohibits, and because the two trades' review criteria measure different things.

**MHC forfeited or frozen on conversion.** Rejected: it penalises a legitimate lifecycle event
and creates a perverse incentive to spend credit down before converting.

**Self-service conversion in Wave 3.** Rejected for the first release. Conversion moves credit,
archives a commercial identity and resets a reputation; each deserves a named human behind it
before the flow is opened to users. Self-service remains a possible later enhancement and is
**not** blocked by anything in this architecture.

**Deferring conversion out of Wave 3 entirely.** Rejected: archival cannot be retrofitted onto an
attribute assumed permanent without rewriting every reputation and profile read path after real
data exists, and the operational need is immediate.

---

## 2. Wave 2 business membership and owner-only authority — **RESOLVED**

**Question:** Wave 2G/2H shipped business workspace membership with roles and invitations, and
some permissions are enforced today. Wave 3 states only the owner may act commercially. What
happens to the shipped feature and to live members?

### Decision

**Retain team administration. Withhold commercial authority. Delete nothing.**

- **Existing Business team administration remains available** — members, invitations, roles and
  the workspace surface continue to work. This is not a fenced or withdrawn feature.
- **`manage_team` remains the only effective team permission**, genuinely enforced, governing
  team administration and nothing beyond it.
- **Only the verified Business owner may perform commercial actions.** Every commercial
  authorization resolves to the ownership relation and never consults membership.
- **The six reserved permissions remain disabled** — `manage_services`, `manage_jobs`,
  `manage_reservations`, `view_wallet`, `manage_support_disputes`, `view_analytics`. Not
  grantable, not effective, not readable as an authorization input.
- **No historical membership data is deleted or disabled**, including roles still carrying a
  reserved permission from before the split.
- **No delegated commercial capability is enabled** in any domain: services, jobs, bookings,
  files, conversations, analytics, disputes, advertisements, payment methods, plans or MHC
  spending.
- **Workspace selection scopes team administration only** and must not be extended to set an
  application-wide commercial context.
- Workspace-owned assets and delegated commercial authority remain **Wave 4**.

**Specified in:** [09 §4](./09-business-buying-and-providing.md) · [09 §6](./09-business-buying-and-providing.md) ·
[04 §2](./04-role-business.md) · [16 §3.3](./16-wave-3-scope.md) ·
[17](./17-product-invariants.md) INV-009a–c, INV-092, INV-093

### Why

This matches what the repository already enforces rather than fighting it. `manage_team` is
genuinely read by an authorization decision; the other six are storable values that authorize
nothing, already separated as reserved precisely so a role's history is preserved without
telling a user it works.

**Corrected repository reality.** An earlier draft of this decision asserted that
`business_teams.business_id` was already the immutable Business commercial and billing
principal. **It is not.** `business_teams.business_id` references `users.id`, as does
`business_profiles.user_id`; commercial assets are user-owned, and **no distinct BCI entity
exists yet**. The immutability of the Business-account relation is real and remains a useful
**compatibility anchor** — but the current Business-role user account is a **legacy
Business-account surrogate**, not the final BCI model.

What the earlier wording was reaching for is delivered instead by the **additive BCI spine** in
[09 §4.4](./09-business-buying-and-providing.md) and [16 §1.1a](./16-wave-3-scope.md): a
distinct BCI entity, a deterministic one-to-one mapping from each legacy Business account,
preserved team/workspace IDs and membership history, and non-destructive re-association of
commercial assets. **That** is what makes Wave 4 delegation an authorization change on a real
principal rather than a data migration — and it is Wave 3 work, not an existing property.

This was the single most likely route by which unfinished Wave 4 behaviour reached production: a
member sees a button, the API happens to allow it, and an engagement is created under an
authority nobody designed.

### Rejected

**Withdraw membership entirely.** Cleanest possible authorization surface, but it takes away a
shipped capability that works, discards data Wave 4 needs, and treats team administration — which
is genuinely enforced and genuinely useful — as if it were the unfinished part.

**Leave the two models side by side unreconciled.** The status quo that produced the risk.

---

## 3. MHC balance ownership — **RESOLVED**

**Question:** Is MHC held per commercial identity or per identity? And what happens to existing
balances keyed to the owner's user record?

### Decision

**Per commercial identity.** A PCI holds its own balance; each BCI holds its own, funded by the
owner and owned by the BCI. No transfer between them, ever, in any direction.

**Migration:** existing balances stay with the personal identity's PCI slot, and every Business
starts at zero, with affected owners notified before the change and given a window to spend or to
request an administratively recorded adjustment with a written rationale.

**Specified in:** [13 §1](./13-mhc-activation.md) · [04 §13](./04-role-business.md) ·
[17](./17-product-invariants.md) INV-059, INV-062

### Why

A shared balance makes "MHC is non-transferable" unenforceable by construction — a Business's
credit and the owner's personal credit would be the same pool. It also makes per-identity cost
analytics meaningless, and per-identity economics is the input to the verified-GMV rent model
(decision 6 and [12 §12A](./12-payment-and-settlement.md)). Business dissolution, ownership change
and Wave 4 spend delegation all become ambiguous under a shared pool.

### Rejected

**Per identity, one balance per person.** No migration and a simpler top-up experience, at the
cost of making the non-transferability rule unenforceable and the rent model's inputs incoherent.

---

## 4. Auto-confirmation of completion — **RESOLVED**

**Question:** Does customer inactivity ever complete an engagement automatically?

### Decision

**Yes, with configurable windows by fulfillment type and disciplined timers.**

- **Configurable auto-confirmation windows by fulfillment type** — and by category. Lengths are
  configuration; the mechanism's existence is product.
- **The timer starts only after a valid provider fulfillment submission** — never at activation,
  never at scheduling, never on a submission that failed evidence validation.
- **Customer correction requests, issue reports and disputes pause the timer**, which resumes
  only when the component returns to `evidence_submitted` with the objection addressed.
- **Notifications and warnings precede auto-confirmation** — at least two reminders, including an
  explicit warning naming the moment it will fire.
- **High-risk cases escalate to manual review instead of auto-confirming.**
- Auto-confirmation requires valid evidence already on file, **extends** the dispute window
  rather than closing it, and is fully review-eligible.
- It **never** applies to pickup components, to workshop components before handover, or to any
  component holding the customer's property.
- **Auto-confirming fulfillment does not confirm that payment occurred** (decision 7).

**Specified in:** [11 §1](./11-fulfillment-models.md) · [11 §1.1](./11-fulfillment-models.md) ·
[11 §1.3](./11-fulfillment-models.md) · [17](./17-product-invariants.md) INV-047, INV-048–048d

### Why

Without it, providers can be held hostage by silence — and in a model where the platform holds no
money, it has no other lever to offer them. The alternative produces a large and growing tail of
permanently open engagements, reputation lost to silence rather than performance, and unbounded
administrative load.

The evidence precondition, the extended dispute window, the paused timer and the high-risk
escalation are together what keep it from completing engagements a customer would genuinely have
contested.

### Rejected

**No auto-confirmation.** Nothing completes that the customer did not accept, at the cost of the
hostage problem and unreliable completion metrics.

**Universal auto-confirmation.** Rejected specifically for pickup and pre-handover workshop work,
where a timer would record an uncollected customer possession as a completed engagement.

---

## 5. Pre-activation communication — **RESOLVED**

**Question:** Does any communication channel exist between buyer and provider before activation,
and if so what shape?

### Decision

**Yes. Pre-award communication remains available, contact-masked and anti-bypass protected.**

- **Free-form communication may remain**, subject to strict redaction, moderation, turn caps and
  rate limits. Structured clarification Q&A exists alongside it.
- On an **Offer**, clarification may be a **public Q&A** visible to all viewers — which both
  discourages contact exchange and amortises the answer across future buyers.
- **Blocked before activation:** contact information, payment instructions, unrestricted links,
  exact location, and **transaction attachments of every type** (decision, attachments, below).
- **The approved pre-award communication model must not be replaced with a structured-only
  model.** A structured-only mode may exist later as an explicitly optional per-category or
  under-enforcement enhancement; it is not the baseline and does not supersede this.

**Specified in:** [00 §5.1](./00-overview-and-terminology.md) · [01 §11](./01-role-customer.md) ·
[13 §10.2](./13-mhc-activation.md) · [17](./17-product-invariants.md) INV-020c–d, INV-021

### Why

This is the single largest lever on both sides of the central trade-off. Too little communication
and providers cannot price, so both parties leave to talk elsewhere and the gate loses the
transaction entirely. Too much unmoderated channel and the channel _becomes_ the bypass.

Masking is what resolves it: the conversation stays on-platform where it can be moderated,
measured and used as case evidence, while the payload — numbers, handles, addresses, files — is
denied. Text can be masked in place and still do its job; that is why free-form survives and
attachments do not.

### Rejected

**No pre-activation communication.** Smallest bypass surface and simplest build, at the cost of
providers pricing defensively or declining, and pressure to exchange contact details migrating
into needs, offers, proposals and review text where it is harder to detect.

**Structured-only communication.** Rejected as the baseline model. It fails the case where a
provider needs to ask one unanticipated question, and no intake designed in advance covers every
trade.

---

## 6. Activation charge granularity — **RESOLVED**

**Question:** Is the activation charge fixed per action key, or does it vary with the
engagement's declared value?

### Decision

**A fixed, admin-configurable action charge. Value-based pricing is prohibited.**

- **Every engagement origin passes through the same activation pipeline.** No exempt, waived or
  alternate acceptance path.
- The charge **may vary by origin, category, or configured action tier**, resolved as a lookup
  against admin configuration.
- It **must not be calculated as a percentage of negotiated contract value**, and must not be
  selected by a band derived from that value.
- Provider acceptance and the MHC charge are **atomic and idempotent**.
- **No D3 disclosure before committed activation** — no preview, no partial reveal.
- **Decline, withdrawal and pre-activation expiry consume no MHC.**
- Refunds use **explicit ledger counterentries** — the original debit is never reversed — and a
  **closed list of narrowly defined grounds** whose enablement and caps are configurable.
- **No hard-coded time-window refund rule**, of any duration, without explicit product approval.

**Specified in:** [13 §2–§4](./13-mhc-activation.md) · [13 §9](./13-mhc-activation.md) ·
[16 §3.2](./16-wave-3-scope.md) · [17](./17-product-invariants.md) INV-069a–b, INV-070a–b

### Why

Value-based activation would give every provider a direct incentive to under-declare the agreed
amount — and the agreed amount is the denominator of settlement coverage and the origin of the
verified-GMV series that the rent model runs on. A rent model built on data that a value-based
charge has already taught providers to understate is not recoverable. It would also make every
Amendment a bypass requiring its own charge, and hand disputes a new subject to argue about.

The acknowledged cost — a large engagement and a small one carry the same charge, which falls
hardest on low-value local work — is mitigated by per-origin, per-category and per-tier prices,
which move the charge to where the economics actually differ.

A window-based refund was rejected on its own merits: it would let a provider open D3, read the
customer's contact details and address, cancel inside the window, and recover the credit. That is
the gate paying for its own bypass. The only case a window intuitively reaches for — a disclosure
that did not actually happen — is already covered by the atomicity-breach ground.

### Rejected

**Value-banded or percentage pricing.** Fairer per transaction and keeps small jobs cheap, at the
cost of corrupting the settlement series at its source and making platform revenue a percentage
of GMV, which the baseline already rejected in favour of tiered rent.

---

## 7. Coupling of completion and settlement — **RESOLVED**

**Question:** Can an engagement complete while settlement coverage is `none` or `partial`?

### Decision

**Fully decoupled. Fulfillment completion and payment settlement are independent state
dimensions.**

- An engagement may be **completed while unpaid, partially paid or fully paid**.
- **Reviews unlock from legitimate fulfillment completion**, never from settlement state.
- **Verified GMV comes only from counterparty-confirmed or administratively verified settlement
  tranches.** A **provider completion claim alone counts for nothing.**
- **Auto-confirmed fulfillment does not auto-confirm payment.**
- The gap is made **loud, not blocking**: the `settlement_open` overlay persists, both parties
  are reminded, agreed-versus-confirmed is shown prominently, and the unsettled state is visible
  in analytics.
- Settlement reporting is a **mandatory, unskippable step in the completion flow** — a required
  prompt with an explicit "not yet paid" option, recorded as an answer.

**Specified in:** [10 §10](./10-engagement-model.md) · [12 §6](./12-payment-and-settlement.md) ·
[12 §12A](./12-payment-and-settlement.md) · [14 §6](./14-reviews-and-reputation.md) ·
[17](./17-product-invariants.md) INV-052a–b

### Why

Completion is a statement about **work**; settlement is a statement about **money**. The platform
holds evidence of the work and can honestly presume from silence; it holds nothing about the money
and can never presume. Coupling them would let an unresponsive counterparty block completion
indefinitely — reintroducing exactly the hostage problem decision 4 exists to prevent, and handing
either party a lever the platform cannot adjudicate.

The mandatory reporting step in the completion flow is what answers the real cost of decoupling:
verified GMV would otherwise be systematically under-captured, because completion is the moment
both parties stop paying attention. Capturing the answer at that moment — including "not yet
paid" — gets the data without letting money block work.

### Rejected

**Strong coupling** (confirmed settlement required before completion). Best data quality, at the
cost of the hostage problem.

**Weak coupling** (a reported record required). Better capture at low friction, but it creates an
incentive to report a payment that did not happen just to close out, polluting the `reported` rung
and loading all the integrity onto the confirm step.

---

## 8. Verification required for a Business to buy — **RESOLVED**

**Question:** Selling requires approved KYB. What does buying require?

### Decision

**Graduated verification.**

- A Business owner must pass **personal KYC (V1) before acting through the Business at all**, in
  either direction.
- **Basic Business verification (V3a)** — verified business email, verified business phone, and
  organization identity — **is sufficient for ordinary buying activity**.
- **Full KYB is not required** merely to browse, post a Need, request proposals, or make ordinary
  purchases.
- **Full KYB (V3b) is required before**: providing, publishing commercial offers or products,
  submitting provider proposals, earning Business reputation, receiving provider payment
  disclosures, and accumulating provider verified GMV.
- **Administrators may configure higher verification requirements** for high-risk or high-value
  procurement — by category, declared budget, cumulative volume or risk flag — including a
  per-period procurement cap.
- Providers are shown the **accurate stage**. A V3a Business is never presented as KYB-verified.

**Specified in:** [00 §4](./00-overview-and-terminology.md) · [00 §4.1](./00-overview-and-terminology.md) ·
[04 §5–§6](./04-role-business.md) · [17](./17-product-invariants.md) INV-011–011d

### Why

Requiring full KYB to buy imposes a multi-day dead period at the exact moment a new organization
is most motivated, raises abandonment, and pushes owners to buy through their personal identity
instead — which defeats the separation the Business identity exists to provide.

The anti-abuse cost is real and falls on providers rather than the platform: every Need a fake
Business posts can burn a provider's MHC on activation. That is why the owner's **V1 is
mandatory** rather than optional — it gives providers an accountability anchor and enforcement a
person to act against — and why administrators can raise the bar where the exposure is largest.

The asymmetry is principled, not a compromise: KYB answers _is this a real registered company fit
to sell_, and a buyer is not selling. The activities gated at V3b are precisely the ones where a
counterparty relies on the organization's registered standing.

### Rejected

**Full KYB before any activity.** Lowest provider MHC risk from organizational demand, at the cost
of the dead period, the abandonment, and the pressure to route around the Business identity.

**Registration-document-submitted as the buying gate** (the earlier recommended default). Replaced
by V3a because a submitted-but-unreviewed document is a weaker and less honest signal than
verified contact channels plus checked organization identity — it implies review that has not
happened.

---

## Final status

> **No unresolved Wave 3 marketplace product decisions remain.**

Every high-impact product decision in this document set is settled. Wave 3 implementation is not
blocked on a product answer.

### Jobs / recruitment — separately supported, not an open decision

**Jobs/recruitment remains a separately supported subsystem during Wave 3.** This is a settled
position, not a deferred decision and not a gap:

- The Jobs module is a **recruitment/employment marketplace**. Jobs are not Needs, Offers,
  Bookings, Product Orders or Custom Orders; job applications are not Proposals; hiring is not
  an Engagement Activation ([00 §10](./00-overview-and-terminology.md)).
- **No job or job application is migrated into the Wave 3 transactional Engagement spine**, and
  historical Jobs data preserves its original recruitment semantics.
- **Recruitment authority is owner-only**; `manage_jobs` stays reserved and non-authoritative
  until Wave 4.
- **Legacy Jobs money paths stay disabled and read-only** — application fees, interview fees,
  escrow, milestone money, commissions, provider payouts and internal wallet movement. No new
  customer-money wallet flow, escrow, salary payout, platform-held compensation or provider
  withdrawal path is created ([00 §10.3](./00-overview-and-terminology.md)).

**Its long-term redesign and monetization are separate future decisions**, deliberately not
taken here. Any future recruitment monetization must be designed separately using approved MHC
platform actions, plans, advertisements, recruitment subscriptions or job-posting fees. **No
recruitment monetization model is invented or activated by this correction pass**, and none is
required for Wave 3 to proceed.

### What would reopen any of these

Nothing in ordinary implementation. These are settled product decisions, and an implementation
difficulty is not grounds to revisit one — it is grounds to raise the difficulty.

A decision reopens only if a **new** contradiction is discovered that cannot be resolved from the
approved set, or if a factual premise proves wrong. In that case the route is an explicit product
decision request naming the question, why it matters, the options, a recommendation and what is
blocked — not a quiet divergence in code.

### Later commercial activation decisions — not Wave 3 blockers

Five items are deliberately deferred. None is an open architecture question, and **none blocks
Wave 3 technical design or implementation**:

| Deferred decision                                        | Status                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live verified-GMV rent charging**                      | Remains a **later explicit production decision**. Rent ships in **shadow mode** — calculated, recorded and reported, deducting nothing. Turning on the debit is a separate decision, informed by the shadow data ([13 §11](./13-mhc-activation.md))                                                                                                                                                                                             |
| **Rent-driven commercial suspension**                    | Remains a **separate later explicit decision**. Deciding to charge is not deciding to suspend for non-payment ([15 §4](./15-suspension-and-enforcement.md))                                                                                                                                                                                                                                                                                     |
| **Jobs/recruitment long-term redesign and monetization** | Remains a **separate future decision**. The recruitment subsystem is separately supported and frozen commercially during Wave 3; nothing about its future shape is settled or needs to be (see above)                                                                                                                                                                                                                                           |
| **Non-zero advertisement pricing**                       | Remains a **later explicit configuration and commercial-approval decision**. The machinery is **already implemented and wired** — active action key, weekly period billing, automatic and manual renewal — and the **current price is zero**. What is deferred is the price, not the model, and free pricing is not missing implementation ([00 §14.1](./00-overview-and-terminology.md), [13 §2.1](./13-mhc-activation.md))                    |
| **Enabling any paid plan**                               | Remains a **later explicit product and pricing decision**. Plans fail closed today through **per-plan** controls — `is_purchasable`, an approved active scoped MHC price, plan/action eligibility — and **not** through `app_settings.pause_plan_subscriptions`, which is currently `false`. Paid-bid ordering, proposal visibility advantages and promoted proposals stay prohibited regardless ([00 §14.2](./00-overview-and-terminology.md)) |

**These deferred commercial activations do not block Wave 3 technical design.** All five are
deliberately structured so the answer can be taken later against real data — which is the entire
point of shadow mode, the reason the recruitment subsystem is frozen rather than redesigned
under time pressure, and the reason the advertisement and plan machinery is fenced by
configuration rather than by removal. The architecture, the calculation chain and the
enforcement boundaries are complete in Wave 3; only the commercial switches are deferred.

### Legacy repository disposition — settled, not a decision

The final repository-disposition pass settled three legacy structures on the evidence in the
repository. **None of them is an open product question, and none reopens an approved decision:**

| Legacy structure                 | Settled disposition                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`users.platform_verified_at`** | A **legacy compatibility/display signal only**. It grants no Wave 3 verification status and no commercial authority; the timestamp is preserved, legacy accounts start **unverified for Wave 3 commercial authority**, and nothing auto-upgrades from the badge or from deposit history ([00 §12](./00-overview-and-terminology.md)) |
| **`mhc_job_activations`**        | **Immutable historical activation records.** Each qualifying row seeds **at most one** Engagement, through a backfill that runs no charge pipeline, writes no second debit and preserves existing payment-disclosure provenance ([00 §13](./00-overview-and-terminology.md))                                                         |
| **Advertisements and plans**     | **Implemented and fenced by configuration**, not absent. Advertisements are wired at a zero price; plans are fenced per plan. Turning either on is the deferred commercial decision above ([00 §14](./00-overview-and-terminology.md))                                                                                               |

Each disposition follows from what the repository already contains and from the approved
baseline. **No new product decision is introduced by it**, and the correction pass adds none.
