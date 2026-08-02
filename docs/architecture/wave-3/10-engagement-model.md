# F — Engagement Model

> **Every activated commercial arrangement on MohandisHub is an Engagement.** There is no
> second kind of order, no parallel booking object, no separate product order and no
> business-only pipeline. One spine, five origins, one lifecycle, immutable snapshots.
>
> **An Engagement does not exist before successful activation.** Before activation there is a
> typed, origin-specific **commercial intent object** (§7). The Engagement is created *by* the
> activation transaction, never before it.

This is the most important structural decision in Wave 3. Wave 1/2 accumulated `bids` and
`reservations` as parallel half-implementations of the same transactional idea, each with its
own settlement, cancellation and dispute semantics. Wave 3 collapses **those** into one spine.

**`jobs` is not among them.** The legacy `jobs` subsystem is a **recruitment/employment
marketplace**, not a service transaction, and it is explicitly excluded from this spine — see
§15 and [00 §10](./00-overview-and-terminology.md).

---

## 1. Why one concept

Everything downstream of acceptance is identical regardless of how the arrangement was
formed:

- The provider paid MHC and D3 opened.
- Terms were fixed at a moment in time and must survive later edits.
- Work is fulfilled through typed components that need scheduling, evidence and confirmation.
- Money moves off-platform and is recorded as evidence.
- Disputes need one place to attach.
- Reviews need one unlock condition.
- Suspension must not break any of it.

Modelling five pipelines means writing those seven behaviours five times and getting them
inconsistent five ways. The **origin** is the only thing that genuinely differs, so origin is
a field, not a type.

---

## 2. Origins

| Origin            | Formed by                                                                       | Typical provider | Scheduling |
| ----------------- | --------------------------------------------------------------------------------- | ---------------- | ---------- |
| `need_award`      | Buyer posts a Need → provider proposes → buyer awards → **provider activates**  | Any              | Type-dependent |
| `service_purchase`| Buyer buys a published package/service at listed terms → **provider activates** | Any              | Type-dependent |
| `booking`         | Buyer requests an availability slot → **provider activates**                    | Expert, Craftsman, Business | Mandatory |
| `product_request` | Buyer requests product variant(s) + quantity + fulfillment method → **provider activates** | Craftsman, Business | Handover only |
| `custom_order`    | Buyer accepts a provider-authored Custom Proposal (from a Quote Request or a survey) → **provider activates** | Any | Type-dependent |

Rules:

- **Every origin ends with provider activation.** There is no instant-purchase path, no
  auto-accept and no "buy now" that creates an obligation without the provider's charged
  acceptance. This is a direct consequence of the MHC gate and is uniform by design.
- **Every origin begins as a pre-activation intent object** (§7), never as an Engagement.
- **Business purchases are not an origin** — see [09 §7](./09-business-buying-and-providing.md).
- **Recruitment Jobs are not an origin.** A job vacancy is not a Need or an Offer, a job
  application is not a Proposal, and hiring is not an activation (§15).
- The origin is **immutable** and carries a reference to the object that produced it (Need +
  Proposal, Offer + version + package, slot, Custom Proposal), plus the inline snapshot that
  governs if that object later changes or disappears.
- A `custom_order` arising from a paid survey references the survey engagement, so the chain
  is auditable.

---

## 3. Anatomy of an Engagement

| Group                        | Contents                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identity**                 | Engagement id; human-readable reference code; created-at; activated-at. **Created-at and activated-at are the same commit** — the row is written by the activation transaction (§7) |
| **Origin**                   | Origin kind; origin references; **link to the consumed pre-activation intent object**; **origin snapshot**                                                    |
| **Buyer party**              | Party kind (`identity` \| `business`); identity/BCI reference; **identity snapshot**                                                                         |
| **Provider party**           | Party kind (`expert` \| `craftsman` \| `business`); reference; **identity snapshot**                                                                         |
| **Acting humans**            | The human who acted for each party at each authoritative moment (Wave 3: always the owner for a BCI)                                                          |
| **Price snapshot**           | Agreed amount; currency; itemized breakdown; payment plan; validity of each line                                                                             |
| **Scope snapshot**           | Title; deliverables; inclusions; exclusions; requirement answers; variants and quantities; revision/rectification allowance; warranty; tolerances; delivery time or dates |
| **Fulfillment plan**         | One or more **Fulfillment Components**, each typed, each with its own schedule, evidence profile and state                                                    |
| **Location snapshot**        | Coarse location always; **both parties'** exact addresses, access notes and geolocation — the buyer's site and, where relevant, the provider's workshop/pickup premises — from activation onward |
| **Payment-method eligibility** | The payment methods and plan shapes eligible on this engagement, snapshotted at activation                                                                  |
| **Activation record**        | Activation state; MHC charge reference; action key; amount; timestamp; charging identity                                                                     |
| **Settlement**               | Settlement records, coverage state, agreed-vs-confirmed totals ([12](./12-payment-and-settlement.md))                                                        |
| **Amendments**               | Append-only list of accepted changes, each with before/after and both acceptances                                                                            |
| **Lifecycle**                | State, state history with actor and timestamp, terminal reason                                                                                               |
| **Overlays**                 | `disputed`, `admin_hold`, `amendment_pending`, `settlement_open` — flags, not states                                                                          |
| **Communication**            | The engagement thread; structured events (scheduling, arrival, handover, delivery)                                                                           |
| **Reputation**               | Review eligibility, review windows, submitted reviews, publication state                                                                                     |

---

## 4. Party snapshots

At **activation**, the engagement freezes both parties as they were.

**Provider identity snapshot** — commercial identity kind and id; display/trade name;
**verified legal name** (or registered legal name and registration reference for a BCI);
verification tier held; credential badges **with their scope and expiry**; rating and review
count at activation; the acting human.

**Buyer identity snapshot** — party kind; display name; verified legal name for a BCI with
registration reference; verification tier; buyer conduct band at activation; the acting human.

Why this is not optional:

- A customer who chose a provider because they were credential-verified must be able to prove
  that is what they were told, even if the credential later lapses.
- A provider defending a dispute must be able to show what the buyer's standing was.
- A commercial identity that is later suspended, renamed, archived or terminated must not
  cause historical engagements to render as blanks.
- Account deletion **pseudonymizes the display** of a party; it does not delete the snapshot.
  The counterparty's record of what happened survives.

---

## 5. Price and scope snapshots

**Price snapshot** — the agreed amount and its itemized breakdown:

```
base (package / service / product line items × quantity)
+ add-ons
+ travel fee
+ delivery fee
+ installation
− discount
= AGREED AMOUNT (single currency)
+ payment plan: single | deposit+balance | N instalments, each with amount and trigger
```

Rules: single currency per engagement; no platform fee line, ever, because the platform takes
none from this money; the MHC activation charge is the provider's cost and never appears on
the buyer's breakdown; the agreed amount is the sole basis for settlement coverage and for
verified GMV.

**Scope snapshot** — everything §3 lists under scope, taken from the accepted terms and
**not** from the offer as it stands today. The snapshot is inline and self-sufficient: an
engagement must render completely and be adjudicable with the source Offer archived, the
Need deleted and the provider suspended.

**Immutability:** neither snapshot is editable by the parties, by support, or by
administrators. Administrators may **annotate** an engagement and may rule on a dispute; they
may not rewrite what was sold. The only path to different terms is an Amendment.

---

## 6. Amendments

A mutually accepted, append-only change to a live engagement.

| Aspect             | Rule                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| What can change    | Agreed amount and its lines; scope items; delivery date or schedule; quantities/variants; payment plan; revision allowance |
| What cannot change | Parties, origin, activation record, MHC charge, settlement history, prior amendments, review history        |
| Who proposes       | Either party                                                                                                |
| Who accepts        | **Both.** An amendment takes effect only on explicit acceptance by the counterparty                         |
| Effect             | Creates a new **effective terms version**; the original and every prior version are retained and readable   |
| Timing             | Only while the engagement is live; not after completion, and not on a cancelled engagement                  |
| MHC                | **No additional charge.** Activation is charged once per engagement, per [13 §3](./13-mhc-activation.md)    |
| Disputes           | An open dispute blocks amendments unless the amendment is the agreed resolution and is recorded as such     |
| Evidence           | Amendments are dispute evidence and carry both acceptances with timestamps                                  |

**On the bypass question:** because the activation charge is **fixed per configured action
key** rather than a percentage of value, there is no incentive to award small and amend upward.
Value-based activation pricing is **prohibited** ([13 §3](./13-mhc-activation.md)); were it
ever introduced, amendments would immediately become a bypass and would need their own charge.
This is one of the reasons it stays prohibited.

---

## 7. The pre-activation intent object and the activation boundary

### 7.1 An Engagement does not exist before activation

This is the boundary the whole model turns on, and it is stated once here so no other document
has to reinvent it.

**Before activation there is no Engagement row, no engagement id, no engagement state, and no
D3 disclosure.** What exists is an **origin-specific commercial intent object**: a real,
persisted object with its own identity, its own deadline and its own lifecycle, visible to both
parties, which is *not* an Engagement and must never be modelled as one.

| Origin             | Pre-activation intent object                            |
| ------------------ | ------------------------------------------------------- |
| `need_award`       | **Need award offer**                                    |
| `service_purchase` | **Accepted service purchase intent** (purchase request) |
| `booking`          | **Booking request / accepted booking intent**           |
| `product_request`  | **Product request**                                     |
| `custom_order`     | **Custom order intent** (accepted Custom Proposal)      |

The exact names may vary by origin and by surface. What may not vary is that **none of them is
an active Engagement**, none of them carries an engagement lifecycle state, and none of them
opens D3.

An intent object is not an obligation. It does not appear in engagement counts, analytics
engagement totals, or reliability numerators other than the activation-rate metric.

### 7.2 The activation transaction

Activation is **one transaction** that must perform all of the following, atomically, and
commit **exactly once**:

| #  | Step                                                                                        |
| -- | ------------------------------------------------------------------------------------------- |
| 1  | Verify the intent **remains valid** — live, not withdrawn, not expired, deadline not passed |
| 2  | Verify the provider's **commercial eligibility** — enabled, verified, not suspended, not restricted |
| 3  | Verify the provider's **MHC balance** against the resolved action price                      |
| 4  | **Lock and charge** the provider's MHC                                                       |
| 5  | **Create the immutable Engagement**                                                          |
| 6  | **Snapshot** parties, offer, scope, price, fulfillment plan and payment-method eligibility   |
| 7  | **Link** the Engagement to its origin intent                                                 |
| 8  | Mark the intent **consumed / activated**                                                     |
| 9  | **Open D3 disclosure** for both parties                                                      |
| 10 | **Commit exactly once** — idempotent under retry and concurrency                             |

### 7.3 Failure behaviour — fail closed, leave nothing behind

If the transaction fails at any step:

- **No Engagement is created.** There is no partially-created engagement row, in any state.
- **No D3 disclosure opens** — not a preview, not a partial reveal, not a deferred one.
- **No MHC charge remains.** Any debit is rolled back with the rest of the transaction.
- The **origin intent stays pending**, fails, expires, or returns to its own defined
  origin-specific state. It is never left referencing an engagement that does not exist.

A debit that committed while engagement creation or disclosure did not is a **system fault**,
not a valid outcome, and is one of the narrow MHC re-grant grounds
([13 §9](./13-mhc-activation.md), ground G2).

**Retry and concurrency:** duplicate or concurrent acceptance of one intent produces **exactly
one** charge and **exactly one** Engagement, enforced by row locking and a uniqueness constraint
on the intent, never by application-level checks alone.

---

## 8. Fulfillment type

Each engagement carries **one or more Fulfillment Components**, each with a type from the
**nine fulfillment component types** in [11](./11-fulfillment-models.md):

`digital_delivery` · `consultation_session` · `on_site_service` · `workshop_service` ·
`physical_product` · `made_to_order_product` · `delivery` · `pickup` · `installation`

**Nine component types plus hybrid composition.** *Hybrid* is not a tenth component type and is
not an enum value — it is the **composition** of two or more of the nine.

Rules:

- The component set is derived from the accepted terms at activation and is part of the
  snapshot. Adding or removing a component requires an Amendment.
- **Delivery, pickup and installation are modifiers**: they attach to a product or service
  component and never stand alone as an engagement's only component.
- A **hybrid** engagement is simply one with two or more required components drawn from the
  nine — there is no hybrid component type and no hybrid enum value.
- Each component has its own schedule, evidence profile, completion action, confirmation and
  inactivity behaviour. The engagement completes only when every **required** component
  completes; optional components (e.g. a declined installation) are marked `not_required`.
- A dispute may target a **single component** rather than the whole engagement.

---

## 9. Lifecycle

**The Engagement lifecycle begins at activation.** `pending_activation` and `lapsed` are
**not** Engagement states — they describe the pre-activation **intent object** (§7) and belong
to its lifecycle, not to this one. No Engagement is ever in a state that represents "not yet
activated".

### 9.1 States

```
ACTIVATION COMMITS ─▶ active
                        │
                        ├─▶ pending_requirements ─┐  (clock stopped)
                        │                          │
                        ├─▶ scheduled ─────────────┤
                        │                          │
                        └─▶ in_progress ◀──────────┘
                                   │
                                   ├─▶ awaiting_customer_confirmation
                                   │        ├─ accept ─────────▶ completed
                                   │        ├─ revise ─────────▶ revision_in_progress ─▶ (back)
                                   │        └─ inactivity ─────▶ completed (auto)
                                   │
                                   └─▶ awaiting_collection  (pickup / workshop only; never auto-completes)
                                                └─ handover ──▶ awaiting_customer_confirmation

any live state ──▶ cancelled (terminal, with cause and actor)
```

The intent object's own lifecycle — pending, withdrawn, declined, expired/lapsed, consumed —
runs entirely before this diagram starts and never appears inside it.

### 9.2 State definitions

| State                             | Meaning                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `active`                          | Activated; not yet scheduled or started                                                   |
| `pending_requirements`            | Blocked on buyer input; **the delivery clock does not run**                               |
| `scheduled`                       | A confirmed future appointment or delivery window exists                                  |
| `in_progress`                     | Work has started or the slot has begun                                                    |
| `awaiting_customer_confirmation`  | Evidence submitted; the confirmation window is running                                    |
| `revision_in_progress`            | A revision round is running against the snapshot's allowance                              |
| `awaiting_collection`             | Goods or a repaired item are ready and uncollected                                        |
| `completed`                       | Every required component confirmed (explicitly or by inactivity fallback)                 |
| `cancelled`                       | Terminated before completion, with a recorded cause and actor                             |

Terminal states are `completed`, `cancelled`, and any further fulfillment-specific terminal
state a type defines. **There is no terminal state meaning "never activated"** — an intent that
never activated produced no Engagement at all.

### 9.3 Overlays (flags, not states)

| Overlay             | Effect                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `disputed`          | A case is open. **Work, messaging, evidence and settlement reporting all continue.** Auto-completion is suspended and review publication is held |
| `admin_hold`        | An administrator has paused automatic transitions pending investigation. Manual party actions still work                     |
| `amendment_pending` | An amendment awaits the counterparty's acceptance                                                                            |
| `settlement_open`   | Agreed amount is not fully covered by confirmed settlement records                                                           |

Overlays are flags precisely so that a dispute cannot freeze delivery, and so that a
half-settled engagement is not stuck in a state machine.

---

## 10. Completion

- An engagement completes when **every required component** reaches `confirmed` or
  `auto_confirmed`.
- Completion is recorded with a **completion basis**: `customer_confirmed`,
  `auto_confirmed`, or `admin_determined` (a dispute outcome).
- **Fulfillment completion and payment settlement are independent state dimensions.** This is
  settled, not open. Completion is a statement about **work**; settlement is a statement about
  **money**. An engagement may be `completed` while **unpaid, partially paid or fully paid**,
  and settlement may be confirmed long after completion.
  - Completion never implies, asserts or records that payment occurred.
  - **Auto-confirmed fulfillment does not auto-confirm payment.** Silence can complete work,
    because the platform holds evidence of the work; silence can never settle money, because
    the platform holds nothing ([12 §6](./12-payment-and-settlement.md)).
  - The `settlement_open` overlay stays on the engagement until coverage is `full`, both
    parties are reminded, and the provider's dashboard shows agreed-versus-confirmed
    prominently. The gap is made loud rather than blocking.
  - Settlement reporting is a **mandatory, unskippable step in the completion flow** — a
    required prompt with an explicit "not yet paid" option, recorded as an answer. This
    captures the data at the only moment attention is guaranteed, without letting money block
    work.
- **Reviews unlock from legitimate fulfillment completion**, never from settlement state. An
  unpaid completed engagement is fully review-eligible in both directions.
- Completion unlocks reviews for both parties and starts the review window.
- Completion does **not** close the engagement: the warranty/rectification window, the dispute
  window, the settlement window and the message thread all continue.
- Completion is **not reversible**. A defect after completion is a rectification request or a
  dispute, not a return to `in_progress`.

---

## 11. Cancellation

| Cancelling party | When                     | Allowed                                                                 | Consequences                                                                                     |
| ---------------- | ------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Buyer            | Before activation        | Always, free                                                            | No charge; provider notified; no reliability impact on the provider                              |
| Buyer            | After activation         | Yes, with a cause                                                       | **MHC already spent and not refunded**; recorded on buyer conduct; provider may open a case      |
| Provider         | Before activation        | Always (this is a decline)                                              | No charge; lapse/decline recorded on provider reliability                                        |
| Provider         | After activation         | Yes, with a cause                                                       | MHC not refunded; recorded on provider reliability by cause; customer remedy applies             |
| Both             | Any live state           | **Mutual cancellation** — either proposes, the other accepts            | Cleanest outcome; recorded as mutual; lighter reliability impact                                 |
| Admin            | Any live state           | Only with a written determination                                       | Records cause, remedy and any MHC re-grant                                                       |

Rules:

- **Cause codes are mandatory** and drive analytics and enforcement:
  `buyer_changed_mind`, `buyer_unresponsive`, `buyer_no_show`, `access_refused`,
  `scope_disagreement`, `provider_unavailable`, `provider_capacity`, `out_of_stock`,
  `out_of_area`, `price_disagreement`, `site_conditions`, `duplicate`, `fraud_suspected`,
  `mutual`, `admin_determination`.
- **Cancellation never deletes anything.** Snapshots, messages, evidence and settlement
  records are retained in full.
- **Confirmed settlements survive cancellation.** If the buyer paid a deposit and the
  engagement is cancelled, the deposit remains on record as a confirmed settlement. Any
  refund is an **off-platform event the parties report** ([12 §11](./12-payment-and-settlement.md)),
  and the platform executes nothing.
- **Cancellation does not unlock reviews** ([14 §8](./14-reviews-and-reputation.md)). It feeds
  reliability metrics instead, which is what stops a provider dodging a bad review by
  cancelling.
- **Customer remedy on provider cancellation:** the buyer is notified with the cause, may
  re-post the Need at no cost with proposals invited from the previous respondents, and may
  open a case. Where the provider cancelled at fault, the reliability record reflects it.

---

## 12. Expiry

Three distinct clocks, often confused:

| Clock                       | Applies to                       | On expiry                                                                              |
| --------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| **Activation deadline**     | The **pre-activation intent** (§7) — *not* an engagement state | The intent lapses; **no Engagement was ever created**; no charge; the Need returns to `open` with its own window extended |
| **Requirements deadline**   | `pending_requirements`           | After reminders, the engagement expires **without penalty to the provider**; MHC is a re-grant candidate under [13 §9](./13-mhc-activation.md) |
| **Confirmation window**     | `awaiting_customer_confirmation` | The type's inactivity fallback runs ([11](./11-fulfillment-models.md))                  |

Only the second and third clocks run against an Engagement. The first runs against an intent
object, which is why its expiry produces no engagement record of any kind.

Never expiring: `awaiting_collection` (it escalates and flags, but a customer's property is
never disposed of by a timer), open cases, and settlement reporting.

---

## 13. Dispute

- A **Case** attaches to the engagement, or to one component of it, and sets the `disputed`
  overlay.
- **Eligibility window:** from activation until a configured period after completion or
  cancellation; extended while a case is open. **An intent that never activated has no
  engagement to attach a case to**, because nothing was agreed and nothing was charged;
  pre-activation grievances (a fake Need, a harvesting Need) are raised as platform reports,
  not as engagement disputes.
- **A dispute does not stop the work.** Delivery, evidence, messaging, scheduling and
  settlement reporting all continue. Auto-completion is suspended and review publication is
  held ([14 §7](./14-reviews-and-reputation.md)).
- **Both parties retain full access under every suspension state**, including profile
  suspension and account closure.
- Outcomes: findings of fact, enforcement, reliability and reputation consequences, MHC
  re-grant, need re-opening at no cost, an agreed Amendment recorded as the resolution, or a
  determination that closes the engagement administratively.
- **The platform cannot order, execute or guarantee a refund**, and no determination may be
  worded as if it can ([12 §13](./12-payment-and-settlement.md)).
- Cases run in the Help & Resolution Center delivered in Wave 2I.

---

## 14. Historical integrity

The properties that must hold forever, and which most of this file exists to guarantee:

1. **An engagement is self-sufficient.** It renders and adjudicates completely with the
   Offer archived, the Need deleted, the package repriced and the provider suspended.
2. **Snapshots are immutable.** No party, support agent or administrator can alter what was
   agreed. Change happens only through append-only Amendments.
3. **The record is append-only.** State history, amendments, settlement records, evidence and
   messages accumulate; nothing is edited in place or removed.
4. **Deletion is pseudonymization, not erasure.** A closed or deleted account's display
   collapses to a neutral label; the engagement, its snapshots and the counterparty's record
   survive. Legal erasure requests are handled by an administrative process that preserves
   the counterparty's ability to evidence the transaction.
5. **Evidence outlives the dispute window.** Deliverables, photos, handover records and
   settlement proofs are retained beyond the engagement, because they are the only proof of
   performance either party has.
6. **Reputation references, not recomputes.** A review is bound to its engagement and to the
   offer version it was earned on; recomputation of aggregates never changes what an
   individual review says or which version it belongs to.
7. **Money history is never rewritten.** Settlement records may change *state* along the
   evidence ladder; their reported facts, timestamps and attachments never change. A
   correction is a new record, not an edit.
8. **Every automatic transition is attributed.** Auto-confirmation, engagement expiry and
   intent lapse are recorded as system actions with their triggering rule and timestamp, so
   that "the system completed it" is auditable rather than mysterious.

---

## 15. Recruitment Jobs are not Engagements

Named here because the legacy `jobs` table sits next to `bids` and `reservations` in the Wave
1/2 schema and looks, from the schema alone, like a fourth half-implementation of the same
transactional idea. **It is not.** The full model is
[00 §10](./00-overview-and-terminology.md); this section states the engagement-spine
consequence.

The MohandisHub Jobs module is a **recruitment / employment marketplace** — a Business
publishes a vacancy, Experts and Craftsmen apply as candidates, and the Business shortlists,
interviews, rejects, hires or closes the vacancy. That is candidacy for employment, not a
commercial service transaction.

| Recruitment object   | Is **not** a…                                             |
| -------------------- | --------------------------------------------------------- |
| Job vacancy          | Customer Need · provider Offer                            |
| Job application      | Proposal · Custom Proposal · pre-activation intent object |
| Shortlist / interview| Award offer · booking                                     |
| Hire                 | Engagement Activation                                     |
| Hiring record        | Engagement · Booking · Product Order · Custom Order       |
| Salary / compensation| Agreed amount · settlement record · settlement tranche    |

Consequences for this spine, each testable:

1. **No job or job application is migrated into the Engagement spine.** Historical Jobs data
   keeps its original recruitment semantics.
2. **A job application creates no Proposal row and no Engagement row**, at any point in its
   lifecycle.
3. **Hiring performs no activation**, charges no MHC through an activation action key, and
   opens no engagement D3 disclosure.
4. **No recruitment record contributes to provider verified GMV** or creates a settlement
   tranche ([12 §12](./12-payment-and-settlement.md)).
5. **INV-038 is unaffected.** "Every accepted commercial arrangement is an Engagement" scopes
   to *commercial service arrangements*. A recruitment candidacy is not one, and reading
   INV-038 as a mandate to fold Jobs into the spine is the specific misreading this section
   exists to prevent.

The recruitment module remains a **separately supported legacy/product subsystem** throughout
Wave 3. Its long-term redesign is a separate future decision
([18](./18-decisions-required.md)).
