# J — Reviews and Reputation

> Reputation attaches to the **commercial identity that did the work** — never to the person
> across their identities, never to a business's procurement side, never merged, never
> migrated. Reviews measure *outcomes*; a separate set of **reliability metrics** measures
> *behaviour*, and the two must not be conflated.

---

## 1. Review target

Every review targets a **commercial identity**, and additionally attaches to the specific
thing that was bought.

| Engagement origin  | Primary target                 | Secondary attachment                             |
| ------------------ | ------------------------------ | -------------------------------------------------- |
| `need_award`       | Provider commercial identity   | None (there was no offer)                        |
| `service_purchase` | Provider commercial identity   | Offer + **version** + package                    |
| `booking`          | Provider commercial identity   | Offer + version (+ session type)                 |
| `product_request`  | Provider commercial identity   | Product + **variant** purchased                  |
| `custom_order`     | Provider commercial identity   | Source offer + version, where one existed        |

The commercial identity is always the primary target. The secondary attachment is what makes
offer-level and product-level ratings possible without creating a second, divergent reputation
system.

---

## 2. Directions

Two directions, deliberately asymmetric.

| Direction              | Public? | Free text? | Structure                                                                 |
| ---------------------- | ------- | ---------- | --------------------------------------------------------------------------- |
| **Customer → provider**| **Yes** | Yes        | Overall stars + per-criterion sub-ratings + free text + optional media     |
| **Provider → customer**| **No**  | **No**     | Structured criteria only, aggregated into a **band** visible to providers at D2 |

Why the asymmetry: a public, free-text provider→customer review turns into a retaliation
weapon, and customers have no reputation to defend commercially. What providers actually need
is a *risk signal* before they spend MHC accepting work — and a band ("high", "typical",
"caution", "insufficient history") delivers that without creating a second public reputation
market. Free-text buyer reviews are deferred, not merely unbuilt.

Buyer conduct criteria: responsiveness, clarity of brief, availability for scheduling, site
readiness / access, payment reporting behaviour, respectfulness. Each is an ordinal rating,
not prose.

---

## 3. Personal provider reviews (Expert and Craftsman)

- Attach to the **PCI**, typed expert or craftsman.
- Per-criterion sets differ by role, because averaging incomparable things produces a useless
  number:
  - **Expert:** quality of work, communication, timeliness, scope accuracy, value.
  - **Craftsman:** workmanship, punctuality, cleanliness, price accuracy, communication, and
    item condition on return for workshop work.
- Aggregates are computed **per PCI** and displayed at D0 with the review count and the
  distribution, never as a bare average.
- Reviews are bound to the engagement and to the offer version they were earned on, so a
  provider who later repriced or rescoped cannot present old reviews as endorsements of new
  terms — the version is recorded and, where the version differs materially, surfaced.
- A PCI's reputation **does not transfer** to a Business the person later forms, does not
  merge with their buyer conduct, and **does not carry across a PCI conversion**.

**On conversion (Expert ⇄ Craftsman), reviews stay where they were earned.** The
Admin/Support-executed conversion process in [00 §3.5](./00-overview-and-terminology.md)
**archives the source PCI rather than mutating its type**, and:

- Every review, its text, its criteria, its version reference and its engagement binding remain
  **permanently attached to the archived PCI**, readable on the archived profile.
- Reviews are never moved, re-pointed, copied, re-aggregated or counted toward the replacement.
- The replacement PCI starts at **zero reviews, zero rating, zero reliability history**, and is
  displayed honestly as a new identity rather than as one with a suppressed past.
- **Aggregates are never merged across the boundary**, in either direction, and no combined
  figure exists at any layer — not in an API response, an export, a badge, a search facet, a
  ranking input or an admin view.
- No cold-start prior may be derived from the archived identity's reputation. Seeding the
  replacement from what the archived identity earned is reputation transfer by another name.
- No market-facing surface may link the two — no "previously traded as", no linked-accounts
  view, no same-operator marker. Administrators see the relation; the market does not.

This is the honest cost of the trade being different work. Craftsman reviews measure
workmanship, punctuality and cleanliness; Expert reviews measure analysis, scope accuracy and
documentation. Carrying one into the other would tell a buyer something the reviews never said.

It is also what stops conversion becoming a reputation reset: a provider carries their **credit**
across a conversion but not their **record**, and a provider with an unresolved case or an open
suspension investigation cannot start a conversion at all
([15 §9.1](./15-suspension-and-enforcement.md)).

---

## 4. Business reviews

- Attach to the **BCI**, entirely separate from the owner's personal identity, the owner's
  PCI, the owner's buyer conduct, and every other BCI the owner controls.
- Criteria are drawn from the **fulfillment types the engagement used**, so a Business selling
  both professional and physical work is rated on the right axes for each engagement, with a
  single overall aggregate plus per-fulfillment-type breakdowns.
- A Business acting as a **buyer** writes ordinary public customer reviews on its suppliers,
  and receives buyer conduct ratings that are **never merged** into its public seller rating.
- Two Businesses with a common owner are **not linked publicly**, and the platform must not
  surface the relationship.
- **No reputation migration in either direction.** A highly rated Expert forming a Business
  starts that Business at zero. This is the cost of separate commercial identities and is the
  correct trade: an organization is a different counterparty risk from a person.

---

## 5. Service and product-specific reviews

- **Offer-level ratings** aggregate all reviews attached to that offer, across versions, with
  the version recorded per review.
- **Package-level** counts and ratings are shown where a package was purchased, so a buyer can
  see that the top tier is well-reviewed and the entry tier is not.
- **Product-level ratings** aggregate across **all variants** of a product, and each review
  records the variant purchased. Variant is displayed on the review; ratings are not split per
  variant, because per-variant sample sizes are almost always too small to mean anything.
- Archiving an offer or product **preserves its reviews** and keeps its page readable —
  archival is not deletion, and orphaning reviews would let a provider clear a bad record by
  re-listing ([06 §8](./06-offer-model.md)).
- **Deleting a package or variant is impossible** once a review references it; it is paused
  instead.

---

## 6. Eligibility and timing

**Eligibility — all must hold:**

1. The reviewer is a **party** to the engagement.
2. The engagement is **`completed`** — by customer confirmation, by inactivity fallback, or by
   an administrative determination.
3. The reviewer has not already reviewed this engagement (one per engagement per direction).
4. The **review window** is open.
5. The engagement is not `lapsed` or `cancelled` (§8).

**Reviews unlock from legitimate fulfillment completion, and from nothing else.** Settlement
state is not an eligibility condition in either direction: an engagement completed with zero
confirmed settlement is **fully review-eligible**, and a fully paid engagement that never
completed is **not**. Completion and settlement are independent state dimensions
([10 §10](./10-engagement-model.md)), and making reviews wait on money would hand an
unresponsive party a lever over the other's reputation.

**Timing:**

- The window **opens at completion** and runs for an admin-configurable period.
- Auto-confirmed completions are **fully eligible**. Excluding them would let a silent customer
  suppress a provider's reputation, and would make the inactivity fallback a reputational
  penalty.
- Reviews **publish on submission**. There is no double-blind hold, because the reverse
  direction is non-public and structured, so the retaliation dynamic that justifies blind
  windows does not exist here.
- The window **closes** at expiry; late reviews are not accepted, which keeps aggregates
  reflecting recent performance.

---

## 7. Disputed engagements

- A review submitted while a **dispute is open** is **accepted and held from publication**
  until the case closes. It is then published unless moderation removes it.
- Rationale: publishing mid-dispute turns the review into leverage ("withdraw the review and
  I'll settle"), and blocking the review outright would let a provider stall publication by
  keeping a case open. Holding — with the case bound to a resolution SLA — is the only option
  that protects both sides.
- The review window is **extended** for the duration of the hold, so a long case does not
  consume the reviewer's opportunity.
- If a determination finds the review's factual basis false, moderation may remove it; a
  determination in the reviewer's favour never *adds* a review.
- **Soliciting or offering anything in exchange for a review, its wording, its removal, or a
  dispute withdrawal is a violation by either party**, and is a terminating offence when
  systematic.

---

## 8. Cancelled engagements

- **No reviews on unactivated or cancelled engagements**, in either direction. A `lapsed`
  arrangement was never activated, nothing was charged and nothing was agreed; a `cancelled`
  engagement has no completed performance to rate. Neither produces a review under any
  circumstance, including an administrative determination.
- The obvious objection — a provider dodging a bad review by cancelling — is answered by
  **reliability metrics**, which are separate from reviews and are exactly where cancellation
  belongs:

| Metric                       | What it counts                                                            |
| ---------------------------- | ---------------------------------------------------------------------------- |
| Activation rate              | Awards and requests accepted vs lapsed                                     |
| Cancellation rate **by cause** | Post-activation cancellations, attributed to the party at fault          |
| On-time rate                 | Deliveries and appointments met against the snapshotted dates              |
| No-show rate                 | Missed appointments, both directions                                       |
| Response time                | Time to first response on requests and messages                            |
| Rectification rate           | Warranty callbacks per completed engagement                                |
| Completion rate              | Activated engagements reaching completion                                  |

- Reliability metrics are **computed, not authored**; they cannot be gamed by text, cannot be
  disputed as opinions, and appear at D0 alongside the star rating.
- Cancellation by cause is what makes them fair: a provider cancelling because the buyer
  refused site access is not penalised the same way as one cancelling because they overbooked.

---

## 9. Edited reviews, moderation and responses

**Edits**

- One edit per review, within the review window.
- The edit is **marked** and the prior version retained in history.
- The aggregate uses the current version; the history is available to moderation and to a case.
- A provider response older than the edit is flagged as responding to a previous version, so a
  reviewer cannot make a fair response look unhinged by rewriting the review under it.

**Moderation**

- Automated screening on submission for: contact details, PII about third parties,
  off-platform solicitation, profanity, threats, and content unrelated to the engagement.
- Reported reviews are queued for human review; reporting never removes a review silently.
- Administrators may **hide** a review with a reason code; hidden reviews are excluded from
  aggregates and both parties are notified.
- **A review is never removed at the request of the reviewed party.** Only policy violations
  remove reviews, and the reason is recorded.
- Competitor abuse, review farms and coordinated rating attacks are enforcement matters
  against the *authoring* identities, with affected reviews removed and aggregates restated.

**Suspicious-review detection**

Detection is a **product requirement**; its scoring algorithm is **implementation-configurable**.
The architecture requires that the capability exists, that its outputs are actionable, and that
it never acts alone — not that it works one particular way.

| Requirement                                                                                  | Status |
| --------------------------------------------------------------------------------------------- | ------ |
| A detection pass runs on every submitted review                                              | Required |
| It produces a **suspicion signal** routed to the moderation queue                            | Required |
| Signals are recorded with their inputs, so a decision is reviewable                          | Required |
| **No review is hidden, removed or excluded from aggregates by the detector alone** — a human decides | Required |
| The reviewed party is never told a review was flagged, and flagging is never a service offered to them | Required |
| The specific features, weights, thresholds and model used                                    | **Implementation-configurable** |

Signals worth feeding it — burst timing, a reviewer whose only activity is reviews, repeated
buyer-provider pairs with minimal engagement substance, text similarity across reviews,
rating patterns inconsistent with reliability metrics, and engagements whose settlement was
never reported — are inputs, not a specification. Tuning them is an operational exercise, and
the architecture deliberately does not fix the algorithm, because a published scoring rule is a
gameable one.

**Provider responses**

- **One public response per review**, authored by the reviewed commercial identity, within the
  response window.
- Editable once; moderated on submission and on edit.
- May not contain contact details, links, third-party PII, or claims the engagement record does
  not support.
- A response is not a rebuttal channel for a dispute; the case is.

---

## 10. Preventing reputation mixing

The hardest rule in this file, and the one most likely to be violated by a well-meaning
"unified profile" feature.

| Boundary                                                       | Rule                                                                                   |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Expert PCI ↔ Craftsman PCI                                     | Cannot coexist; on conversion, reviews stay with the archived identity and **never carry over, merge or seed a prior** (§3) |
| Archived PCI ↔ its replacement PCI                             | Two separate reputations. No merged aggregate, no linkage in any market-facing surface     |
| PCI ↔ any BCI the person owns                                  | Completely separate. No display linkage, no aggregate, no "also operates" surface      |
| BCI ↔ BCI (same owner)                                         | Completely separate; the shared ownership is not public                                |
| Provider rating ↔ buyer conduct (same identity)                | Separate figures, separate labels, never averaged                                      |
| Business seller rating ↔ business buyer conduct                | Separate figures, separate labels, never averaged                                      |
| Offer/product rating ↔ identity rating                         | Related but distinct; both shown, neither substituted for the other                    |
| Person ↔ any commercial identity                               | **There is no person-level rating anywhere in the product**                            |

Enforcement points:

- Aggregates are computed **per commercial identity** at the source, not filtered from a
  person-level pool. There is no person-level pool to filter.
- No API response, export, badge, search facet, ranking input or admin view may present a
  combined person-level score.
- Ranking and recommendation must not use one identity's reputation as a signal for another,
  including as a cold-start prior — that is reputation transfer by another name.
- A **"verified same operator"** display, a linked-accounts view or a cross-identity trust
  transfer are all prohibited in Wave 3. Administrators can see the relationship; the market
  cannot.

---

## 11. Aggregate presentation rules

- Always show the **count and distribution**, not a bare average. A 5.0 from one review and a
  4.7 from two hundred are not comparable and must not look comparable.
- **Recency weighting** is permitted and must be disclosed in the methodology; silent
  weighting is not.
- **Transaction-value weighting is not introduced.** A star rating is one engagement, one
  review, one vote. A review of a large engagement does not count for more than a review of a
  small one, and no aggregate, badge or ranking input may weight ratings by agreed amount,
  settled amount or verified GMV.

  The reason is that value-weighting silently changes what a rating *means* — a 4.8 would stop
  being "customers rated this provider 4.8" and become "customers who spent more rated this
  provider 4.8", which no buyer reads it as. It would also make reputation partly purchasable
  by pricing strategy, and would couple the reputation system to the settlement series, so
  every restatement would move historical star ratings.

  Verified settled volume is already displayed **as its own distinct signal**
  ([12 §12](./12-payment-and-settlement.md)) alongside the rating. That is the honest way to
  show that a provider handles large work: as a separate band a buyer can read, never folded
  into the stars.
- A **minimum review count** applies before a rating is displayed as a headline figure; below
  it, show the count and "not enough reviews yet".
- **Verified settled volume bands** ([12 §12](./12-payment-and-settlement.md)) are displayed
  alongside reputation as a distinct signal, never folded into the star rating.
- Reliability metrics are displayed alongside, with their definitions available — an unexplained
  behavioural score is indistinguishable from an arbitrary one.
- Hidden and removed reviews are excluded and aggregates restated; the restatement is
  auditable.
