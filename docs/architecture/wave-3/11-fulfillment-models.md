# G — Fulfillment Models

> A **Fulfillment Component** is one typed unit of work or handover inside an Engagement.
> An engagement has one or more. Each type defines its own scheduling, evidence, completion,
> confirmation, correction, inactivity, dispute and review behaviour.

**Nine fulfillment component types plus hybrid composition.**

The nine component types are: `digital_delivery` · `consultation_session` · `on_site_service` ·
`workshop_service` · `physical_product` · `made_to_order_product` · `delivery` · `pickup` ·
`installation`.

`delivery`, `pickup` and `installation` are **modifiers** — they attach to a product or service
component and never stand alone.

**Hybrid is a composition, not a type.** A hybrid engagement is one carrying **two or more** of
the nine component types (§11). There is no tenth component type, no `hybrid` enum value, and
nothing in the data model that a component's type field may be set to called "hybrid".

---

## 1. The shared skeleton

Every component runs the same eight-stage frame; the types differ in how each stage is filled.

```
pending_requirements ─▶ scheduled ─▶ in_progress ─▶ evidence_submitted
        (clock off)                                        │
                                                           ├─ customer confirms ────▶ confirmed
                                                           ├─ customer rejects ─────▶ correction round ─▶ (back)
                                                           └─ inactivity fallback ──▶ auto_confirmed | escalated
```

Cross-cutting rules:

| Rule                        | Statement                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Clock discipline**        | Delivery clocks never run during `pending_requirements`, during a correction round awaiting buyer input, or during an `admin_hold` |
| **Evidence is mandatory**   | A provider cannot reach `evidence_submitted` without the evidence its **evidence policy** requires (§1.2). The policy is configurable; the requirement itself is not optional |
| **Confirmation windows**    | Length is admin-configurable **per fulfillment type** and per category; existence is not                                         |
| **Timer start**             | The auto-confirmation window starts **only after a valid provider fulfillment submission** — never at activation, never at scheduling, never on a submission that failed evidence validation |
| **Timer pause**             | The window **pauses** on a customer correction request, an issue report, or a dispute, and resumes only when the component returns to `evidence_submitted` with the objection addressed |
| **Reminders**               | At least two before any inactivity fallback fires, to both parties, in-app and by email/push, with an explicit warning that the component will auto-confirm and when |
| **Auto-confirmation**       | Where it applies, it requires valid evidence already on file, and it **extends** the dispute window rather than closing it. It confirms **work only** — never payment (§1.1) |
| **Never auto-completes**    | `pickup`, `workshop_service` handover, and any component holding the customer's property                                        |
| **High-risk manual review** | Configured high-risk cases **escalate to manual review instead of auto-confirming** (§1.3)                                       |
| **Dispute overlay**         | Suspends auto-confirmation and holds review publication; never blocks work, evidence or messaging                               |
| **Review unlock**           | At **engagement** completion, i.e. when every required component is confirmed or auto-confirmed. Not per component              |
| **Suspension**              | Every stage of every type remains operable under commercial and profile suspension ([15](./15-suspension-and-enforcement.md))   |

### 1.1 Auto-confirmation confirms work, never money

Auto-confirming a fulfillment component records that the **work** was delivered and the
customer did not object within the window. It records nothing about payment.

- It never creates, advances or confirms a settlement record.
- It never sets settlement coverage, and never clears the `settlement_open` overlay.
- No copy, notification, receipt or badge attached to an auto-confirmation may state or imply
  that the engagement was paid for ([12 §14](./12-payment-and-settlement.md)).

Silence is admissible about work because the platform holds the evidence of the work. Silence
is never admissible about money because the platform holds nothing
([17](./17-product-invariants.md), INV-053).

### 1.2 Evidence policies are configurable, not universal

Evidence requirements are **defined per policy, resolved per component**, and are never a
single platform-wide mandate applied regardless of what is being delivered.

An evidence policy resolves from these dimensions:

| Dimension            | Example effect                                                                       |
| -------------------- | ------------------------------------------------------------------------------------ |
| **Fulfillment type** | On-site work needs arrival and before/after evidence; digital delivery needs files or a recorded link |
| **Category**         | Regulated electrical work demands a functional check that a furniture assembly does not |
| **Risk level**       | A flagged provider, a first engagement, or a high declared value raises the requirement |
| **Delivery method**  | Provider delivery evidences a handover; customer-arranged delivery evidences the courier handover |
| **Engagement terms** | Declared tolerances demand dimensional evidence; declared materials-extra demands a materials record |

**Explicitly rejected as universal mandates.** Each of these is a legitimate *option* within a
policy and a defensible requirement for some categories. None is imposed on every engagement of
its class:

1. **Customer OTP or handover code on every on-site service.** On-site confirmation may be a
   tap, a handover code, a signed record, or remote confirmation within the window. Requiring a
   code universally fails every engagement where the customer is elderly, offline, absent by
   arrangement, or simply not the person on site — and converts a delivered job into an
   unconfirmable one.
2. **Carrier tracking on every physical product.** Wave 3 has no carrier integration and no
   tracking numbers at all ([16 group 3](./16-wave-3-scope.md)). Delivery is an evidenced
   handover. A free-text field presented as tracking is prohibited, not a substitute.
3. **Platform-uploaded SHA-256 artifacts on every digital engagement.** Digital delivery is
   satisfied by uploaded files **or** a recorded external link plus a written delivery
   statement (§2). Mandating a platform-hosted hashed artifact would break every legitimate
   delivery to a client's own repository, drive or system, which is how a large share of
   professional work is actually handed over.

Policies are admin-configurable in their thresholds, counts and moments. What is **not**
configurable is that every component type has *some* evidence policy and that a component
cannot reach `evidence_submitted` without satisfying it.

### 1.3 High-risk manual review

An auto-confirmation may be **withheld and escalated to manual review** instead of firing,
where the configured risk rules match — high declared value, a first engagement between the
parties, a provider under enforcement or with an elevated dispute rate, an evidence profile
satisfied only minimally, a category flagged high-risk, or a prior correction round on the same
component.

Escalation is not a penalty and does not fail the provider. It routes the component to an
administrator for a determination, notifies both parties that the window has been extended, and
records the escalation rule that fired.

---

## 2. Digital service delivery

*Expert and Business `expert_service` deliverable work.*

| Dimension                  | Definition                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Required scheduling**    | None. A **delivery-by date** is derived from the snapshot's delivery days + add-on deltas + lead-time buffer, running from requirements satisfaction |
| **Evidence**               | Uploaded deliverable files matching the snapshot's declared formats, **or** a recorded external link plus a written delivery statement. Every round is versioned and retained |
| **Provider completion**    | *Submit delivery* — attaches evidence, states what was delivered against each scope item, moves to `awaiting_customer_confirmation`     |
| **Customer confirmation**  | *Accept* → confirmed. *Request revision* → correction round, citing the deliverable and the unmet scope item                          |
| **Revisions / corrections**| Consumes one of the snapshot's revision allowance. Delivery clock pauses; a shorter revision clock runs. Exhausted allowance → accept, buy an add-on, amend, or dispute |
| **Inactivity fallback**    | After reminders, the confirmation window elapses → **auto-confirmed**, basis recorded, dispute window extended                        |
| **Dispute eligibility**    | From activation to completion + window; grounds include non-delivery, format mismatch, scope shortfall, lateness                      |
| **Review unlock**          | On acceptance or auto-confirmation                                                                                                     |

Specific rule: **an unreachable external link is not a delivery.** If the provider delivers by
link, the link plus the statement is the evidence, and a link that the buyer reports as dead
within the window returns the component to `in_progress` without consuming a revision.

---

## 3. Consultation or session delivery

*Expert, Business, and Craftsman paid surveys or remote diagnosis.*

| Dimension                  | Definition                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Required scheduling**    | **Mandatory.** A confirmed slot with start, duration, timezone and platform (on-platform call, phone at D3, or on-site)                 |
| **Evidence**               | On-platform: automatic session record — join times, duration, participants, optional recording with both parties' consent. Off-platform: provider-attested session record plus customer confirmation |
| **Provider completion**    | *Mark session held*, with outcome notes; auto-populated from the call log where the session was on-platform                             |
| **Customer confirmation**  | *Confirm held* → confirmed. *Report no-show* or *report cut short* → escalation, not a silent revision                                  |
| **Revisions / corrections**| Not applicable. Instead: **reschedule**, bounded to a configured count per party, each recorded; and **no-show handling** for both sides |
| **Inactivity fallback**    | Window runs from the scheduled end. On-platform sessions with a call log auto-confirm on elapse. **Off-platform sessions with no log and no customer response escalate to review rather than auto-confirming** — there is no evidence a session happened |
| **Dispute eligibility**    | From activation to completion + window; grounds include no-show, short session, wrong scope, unreachable provider                       |
| **Review unlock**          | On confirmation, auto-confirmation, or a determination                                                                                  |

No-show rules: a **provider no-show** is a provider-fault cancellation with reliability impact
and is an MHC re-grant candidate only where the platform itself failed. A **customer no-show**
completes the component as delivered (the provider's time was consumed) unless the snapshot's
declared policy says otherwise, and is recorded on buyer conduct.

---

## 4. On-site service

*Craftsman and Business labour at the customer's location.*

| Dimension                  | Definition                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Required scheduling**    | **Mandatory.** Date + arrival window at the customer's address. The exact address is released at activation, never before                       |
| **Evidence**               | **Arrival check-in** (timestamp, optional geotag, mandatory for categories flagged as such); **before photos**; **after photos** (minimum counts per category); a written work summary; materials used where the snapshot says materials are extra |
| **Provider completion**    | *Mark work complete on site*, with evidence attached                                                                                            |
| **Customer confirmation**  | *Confirm on site* — a tap, or a **handover code** the provider enters — or confirm remotely within the window. On-site confirmation is strongly preferred and prompted at completion |
| **Revisions / corrections**| **Rectification / callback** within the snapshot's warranty window: the customer reports a defect, the provider schedules a return visit. This is a new scheduled sub-round, not a revision, and does not reopen the price |
| **Inactivity fallback**    | Window runs from provider completion → **auto-confirmed** with evidence on file, dispute window extended                                        |
| **Dispute eligibility**    | From activation to completion + warranty window; grounds include work not performed, defective workmanship, damage, no-show, overcharging against the snapshot |
| **Review unlock**          | On confirmation or auto-confirmation                                                                                                            |

Access failure: if the provider checks in and the customer is absent or refuses access, the
provider records a **failed visit** with evidence. A failed visit is a customer-fault event
that may carry the snapshot's declared callout fee, is recorded on buyer conduct, and moves
the component back to `scheduled` for a re-attempt or to a cancellation with cause
`access_refused`.

---

## 5. Workshop service

*The customer brings an item to the Craftsman's or Business's workshop.*

| Dimension                  | Definition                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Required scheduling**    | **Mandatory, two-sided:** a drop-off appointment and an estimated ready date. Handover has its own window                                        |
| **Evidence**               | **Intake record** — item description, condition notes, and condition photos at drop-off, captured **before work starts**; work photos; completion photos; **handover record** (code or mutual confirmation) |
| **Provider completion**    | Two steps: *Mark ready for collection* → `awaiting_collection`; then *Confirm handover* when the item is actually returned                        |
| **Customer confirmation**  | Confirms **collection** at handover, then confirms the **work** within the confirmation window running from handover                             |
| **Revisions / corrections**| Rectification within the warranty window; the item returns to the workshop as a new scheduled sub-round                                          |
| **Inactivity fallback**    | **Never auto-completes before handover.** `awaiting_collection` escalates: reminders → storage-policy notice → admin-visible stale flag. After handover, the work-confirmation window auto-confirms normally |
| **Dispute eligibility**    | From activation through warranty; grounds include work not performed, defect, **damage to the item in the provider's care**, and unreturned property |
| **Review unlock**          | After handover and work confirmation (or auto-confirmation post-handover)                                                                        |

The **intake record is the single most valuable artefact in this type.** "It was already
cracked when you brought it in" is unadjudicable without it, and it protects the provider more
than the customer. It is mandatory, not encouraged.

Uncollected property is never disposed of by a timer. The provider's declared storage policy
governs, escalation is administrative, and a suspended provider can always complete handover
([03 §18](./03-role-craftsman.md)).

---

## 6. Physical product

*An existing item supplied by a Craftsman or Business.*

| Dimension                  | Definition                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Required scheduling**    | Only through its attached modifier — a delivery window or a pickup window. The product component itself needs none            |
| **Evidence**               | Item photos as dispatched or as prepared for collection; variant and quantity confirmation against the snapshot; packing notes where fragility was declared |
| **Provider completion**    | *Mark prepared/dispatched*, then completion passes to the attached `delivery` or `pickup` modifier                            |
| **Customer confirmation**  | *Confirm receipt and condition* within the window after handover                                                              |
| **Revisions / corrections**| No revisions. **Return / replacement request** within the provider's declared policy window — the platform **records** the request and the parties' responses and **executes nothing** |
| **Inactivity fallback**    | Window runs from the handover event → **auto-confirmed**                                                                      |
| **Dispute eligibility**    | From activation to receipt + policy window; grounds include non-delivery, wrong variant, wrong quantity, damage in transit, item not as described |
| **Review unlock**          | On receipt confirmation or auto-confirmation. The review records the **variant** purchased                                    |

Out-of-stock after acceptance is a provider-fault cancellation with cause `out_of_stock`, is
measured, and — given Wave 3's manual stock model
([08 §9](./08-craftsman-storefront.md)) — is a recognised MHC re-grant candidate only when the
platform's own staleness prompting failed, not as a routine remedy.

---

## 7. Made-to-order product

*An item produced to specification.*

| Dimension                  | Definition                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Required scheduling**    | A **production lead time** running from spec confirmation, plus a handover window on the attached modifier                                     |
| **Evidence**               | **Spec confirmation record** — the provider states the specification, the customer confirms it, both timestamped. Then optional progress photos, mandatory completion photos, and dimensional evidence where tolerances were declared |
| **Provider completion**    | *Confirm spec* → (customer confirms) → *Start production* → *Mark ready*, then the attached modifier completes handover                        |
| **Customer confirmation**  | Two confirmations: the **spec**, before production; and **receipt and conformity**, after handover                                             |
| **Revisions / corrections**| **Before spec confirmation:** free iteration. **After spec confirmation:** changes require an **Amendment**, which the provider may decline. **After production:** rectification within the warranty window, adjudicated against the declared tolerances |
| **Inactivity fallback**    | Buyer silence at the spec gate stops the clock, triggers reminders, and eventually **expires the engagement without penalty to the provider** (MHC re-grant candidate). Post-handover, the receipt window auto-confirms normally |
| **Dispute eligibility**    | From activation through warranty; grounds include non-conformity to the confirmed spec, out-of-tolerance dimensions, material substitution, non-delivery |
| **Review unlock**          | On receipt confirmation or auto-confirmation                                                                                                   |

The **spec-confirmation gate is mandatory and blocking.** Production before confirmation is at
the provider's own risk and is not a defensible dispute position. Declared tolerances are what
make "it's 2cm off" adjudicable.

Deposits attach naturally here: the payment plan's deposit trigger is spec confirmation
([12 §7](./12-payment-and-settlement.md)).

---

## 8. Delivery *(modifier)*

| Dimension                  | Definition                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Required scheduling**    | **Mandatory** — a delivery date and window agreed with the buyer. The exact address is available from activation              |
| **Evidence**               | Dispatch record; recipient name; **handover photo or handover code**; timestamp. For `customer_arranged`, the courier handover record is the provider's completion evidence |
| **Provider completion**    | *Mark dispatched* → *Mark delivered*, with handover evidence                                                                  |
| **Customer confirmation**  | *Confirm receipt* within the window                                                                                           |
| **Revisions / corrections**| **Failed delivery** (nobody present, address unreachable) is recorded with evidence and triggers the provider's declared re-attempt policy; repeated failure moves to `awaiting_collection`, not cancellation |
| **Inactivity fallback**    | Auto-confirmed after the receipt window, **only where handover evidence exists**. No evidence → escalation, not auto-confirmation |
| **Dispute eligibility**    | Non-delivery, wrong recipient, damage in transit, delivery outside the agreed window                                          |
| **Review unlock**          | Contributes to the parent engagement's completion; no separate review                                                         |

No carrier integration, no tracking numbers, no labels. Delivery is a scheduled, evidenced
handover.

---

## 9. Pickup *(modifier)*

| Dimension                  | Definition                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Required scheduling**    | **Mandatory** — a pickup window at the declared location, plus the provider's storage policy from the snapshot                   |
| **Evidence**               | *Ready for collection* notice; **handover code** entered by the collecting party, or mutual confirmation with a handover photo; timestamp; collector name where the collector is not the buyer |
| **Provider completion**    | *Mark ready* → `awaiting_collection`; then *Confirm handover*                                                                    |
| **Customer confirmation**  | Confirms collection at handover; then confirms the goods/work within the window running from handover                            |
| **Revisions / corrections**| Condition objections at handover are raised immediately and recorded before the item leaves; later objections run through the return/rectification path |
| **Inactivity fallback**    | **Never auto-completes.** Reminders → storage-policy notice → stale flag → administrative escalation. A customer's property is never disposed of by a timer, and an uncollected item is never recorded as a completed engagement |
| **Dispute eligibility**    | Item not ready as promised, item not released, condition at handover, storage charges not in the snapshot                        |
| **Review unlock**          | Contributes to parent completion after handover                                                                                  |

---

## 10. Installation *(modifier)*

| Dimension                  | Definition                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Required scheduling**    | **Mandatory**, and sequenced **after** the delivery or pickup it depends on. Its own arrival window                            |
| **Evidence**               | Arrival check-in; site-readiness confirmation; installation photos; **functional check** result; customer sign-off             |
| **Provider completion**    | *Mark installed*, with the functional check recorded                                                                           |
| **Customer confirmation**  | On-site sign-off preferred (tap or handover code); otherwise remote confirmation within the window                             |
| **Revisions / corrections**| Rectification within the installation's **own warranty window**, which is distinct from the product's warranty                 |
| **Inactivity fallback**    | Auto-confirmed after the window with evidence on file                                                                          |
| **Dispute eligibility**    | Not installed, incorrectly installed, damage during installation, non-functional after install, site left unsafe or unclean    |
| **Review unlock**          | Contributes to parent completion                                                                                               |

Site-readiness failure (no power, no clearance, wrong preparation) is recorded with evidence,
carries the snapshot's declared abortive-visit fee if any, is recorded on buyer conduct, and
reschedules rather than cancels.

---

## 11. Hybrid product plus service

*A composite engagement — an item supplied **and** fitted, commissioned or serviced.*

There is **no hybrid component type and no tenth enum value**. A hybrid engagement is one
carrying **two or more of the nine component types**, and this section defines only how those
components interact. Hybrid is a property of the engagement's component set, never of a
component.

| Dimension                  | Definition                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Required scheduling**    | Per component, with **declared dependencies**: installation cannot be scheduled before its delivery or pickup completes                    |
| **Evidence**               | Each component's own evidence profile, independently satisfied                                                                             |
| **Provider completion**    | Per component. The engagement does not complete until **every required component** is confirmed or auto-confirmed                          |
| **Customer confirmation**  | Per component. Partial confirmation is normal and visible: "goods received, installation pending"                                          |
| **Revisions / corrections**| Per component, under that component's own rules and its own warranty window                                                                |
| **Inactivity fallback**    | Per component. A component that never auto-completes (pickup, workshop handover) **blocks** engagement completion regardless of the others |
| **Dispute eligibility**    | May target a **single component** or the whole engagement. A dispute on one component sets the engagement's `disputed` overlay but does not stop the others |
| **Review unlock**          | **At engagement completion only** — when all required components are confirmed. Never on partial completion                                |

Price attribution: the price snapshot's breakdown lines are attributed to components, so a
component-level dispute has a component-level value to argue about, and settlement coverage
can be reasoned about per component even though settlement itself is engagement-level.

---

## 12. Summary matrix

**The nine component types**, followed by the hybrid **composition** row — which describes an
engagement shape, not a tenth type.

| Type                   | Scheduling | Auto-confirms? | Correction mechanism        | Holds customer property |
| ---------------------- | ---------- | -------------- | --------------------------- | ----------------------- |
| Digital delivery       | No         | Yes            | Revisions (counted)         | No                      |
| Consultation / session | Mandatory  | Only with a call log | Reschedule; no-show handling | No                 |
| On-site service        | Mandatory  | Yes            | Rectification (warranty)    | No                      |
| Workshop service       | Mandatory  | **Not before handover** | Rectification (warranty) | **Yes**              |
| Physical product       | Via modifier | Yes          | Return/replacement (recorded only) | No               |
| Made-to-order product  | Lead time from spec confirmation | Yes, post-handover | Amendment before production; rectification after | Sometimes |
| Delivery *(mod)*       | Mandatory  | Yes, with evidence | Re-attempt policy       | In transit              |
| Pickup *(mod)*         | Mandatory  | **Never**      | Objection at handover       | **Yes**                 |
| Installation *(mod)*   | Mandatory, dependent | Yes  | Rectification (own warranty)| No                      |
| *Hybrid — **composition** of 2+ of the above, not a type* | Per component | Per component | Per component | Per component |

---

## 13. Evidence retention

Evidence is retained **beyond** the engagement, the dispute window, the offer's archival and
the provider's suspension or termination. It is the only proof of performance either party
has, and destroying it converts a resolvable dispute into an unresolvable one. Retention
periods are admin-configurable with a floor; deletion of evidence attached to a live or
recently closed case is prohibited under all circumstances, including account deletion
requests, which pseudonymize the actor rather than remove the artefact.
