# B — Provider Offer Model

> An **Offer** is a provider-authored, published unit of supply. Four kinds, one shared
> spine. Businesses do not get a fifth kind — they compose the same four under an
> organizational identity.

---

## 1. Shared attributes

Every Offer, of every kind, carries the following. These are the fields that discovery,
snapshotting, moderation and analytics all depend on, so they are shared by construction
rather than by convention.

| Group             | Attributes                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identity**      | Offer id; **owning commercial identity** (PCI or BCI) and its kind; slug; creation and publication timestamps                                                 |
| **Classification**| Offer kind; primary category; secondary categories; tags; language(s)                                                                                          |
| **Presentation**  | Title; summary; long description; media set (images, and video where allowed); ordered display                                                                 |
| **Commercial**    | Pricing model; currency; base price or price basis; add-ons; payment-plan shapes the provider will accept (single / deposit+balance / instalments)             |
| **Delivery**      | Fulfillment type(s) produced; lead time or delivery days; scheduling requirement; service-area or remote flag; delivery/pickup/installation options where applicable |
| **Buyer inputs**  | Requirements intake — structured questions the buyer answers before or at request time; which are mandatory                                                    |
| **Terms**         | Inclusions; explicit exclusions; revision or rectification allowance; warranty window; cancellation stance; validity of listed price                            |
| **Constraints**   | Availability state; concurrent-engagement cap; minimum order value; buyer verification requirement (e.g. V0 only, or verified-buyer only)                      |
| **Lifecycle**     | Status; moderation state and reason; **version number**; version history; archived-at                                                                          |
| **Reputation**    | Aggregated rating and review count **for this offer**, alongside the identity-level aggregate                                                                  |
| **Analytics**     | Impressions, views, quote requests, requests, acceptance rate, conversion, cancellation rate                                                                   |

Rules that apply to all kinds:

- **Every published Offer is versioned.** Any change to price, scope, inclusions,
  exclusions, delivery time, revisions, requirements or terms increments the version.
  Cosmetic edits (typo, media reorder) do not.
- **Engagements snapshot the version they bought.** Editing an Offer never changes a live
  engagement ([10 §5](./10-engagement-model.md)).
- **No contact information, external links, handles, QR codes or payment instructions** may
  appear in any Offer field, including titles, media, file names and captions. Redaction and
  moderation apply at publication and on every edit.
- **The price shown is the price offered.** A provider whose published price is systematically
  a lure for a higher quote is committing a bait pattern; the gap between listed price and
  agreed amount is measured and enforceable.
- Offers are D0 (publicly visible including to guests) unless the offer sets a buyer
  verification requirement, in which case the *request action* is gated, not the listing.

---

## 2. Offer kinds

| Kind                     | Publishable by            | Sells                                                | Fulfillment types produced                        |
| ------------------------ | ------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| `expert_service`         | Expert, Business          | Knowledge work, deliverables, sessions               | Digital delivery; consultation/session             |
| `craftsman_service`      | Craftsman, Business       | Labour at a site or in a workshop                    | On-site service; workshop service; consultation (survey) |
| `physical_product`       | Craftsman, Business       | An existing item, optionally with variants           | Physical product + delivery / pickup / installation |
| `made_to_order_product`  | Craftsman, Business       | An item produced to specification                    | Made-to-order + delivery / pickup / installation   |

Enforcement note: kind availability is derived from the **owning commercial identity's
kind**, not from a permission flag. An Expert cannot hold a `physical_product` offer in any
state, including draft.

---

## 3. Expert service offers

Full model in [07](./07-expert-packages.md). Distinguishing attributes:

- **Pricing shape** is one of: `packaged` (1–3 tiers), `quote_only` (no packages; custom
  proposals only), or `packaged_with_custom` (both).
- **Delivery time in business days**, per package, plus per-add-on deltas.
- **Revisions** are a first-class numeric part of scope, enforced by the fulfillment engine.
- **Requirements intake** is answered at purchase and gates the delivery clock.
- **Session offers**: an `expert_service` may be session-shaped (duration, platform, slot
  booking) rather than deliverable-shaped, or carry both.
- No service area, no delivery, no installation, no stock.

---

## 4. Craftsman service offers

Full model in [08](./08-craftsman-storefront.md). Distinguishing attributes:

- **Pricing models**: `fixed`, `from` (starting at), `per_unit` (per hour, m², item, point),
  `survey_required` (a quote follows an inspection, with an optional priced inspection).
- **Location model**: `at_customer_site` (needs service area + travel fee),
  `at_workshop` (customer brings the item), or `either`.
- **Service areas** with per-area travel fee and minimum order value.
- **Scheduling is mandatory** — every craftsman service produces a scheduled component.
- **Warranty / rectification window**, declared and snapshotted.
- **Evidence requirements** by category: minimum before/after photo counts, arrival
  check-in, functional check.
- No revisions in the Expert sense; corrections are rectification within the warranty window.

---

## 5. Physical product offers

For items that exist, or that the provider can supply from an existing line.

| Attribute            | Definition                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Product identity     | Title, description, brand/manufacturer where relevant, model, media set                                          |
| **Variants**         | Option types (size, material, colour, finish, capacity) → values → variant combinations                          |
| Per-variant fields   | Price, lead time, **stock status**, media, minimum order quantity, unit                                          |
| **Stock status**     | `available` · `made_to_order` · `out_of_stock` — a **manually maintained flag, not a tracked quantity**          |
| Condition            | New / refurbished / used, where the category allows                                                              |
| Fulfillment options  | Pickup, provider delivery (per-area fee, free-above-threshold), customer-arranged collection; optional installation |
| Handling             | Packaging notes, weight/dimension bands for delivery pricing, fragility/handling constraints                     |
| Returns stance       | The provider's own returns/replacement policy text and window — **recorded and snapshotted, never executed by the platform** |
| Warranty             | Window and coverage, declared                                                                                     |

Hard limits in Wave 3, stated on the product surface itself:

- **No quantity tracking, no reservation, no decrement, no overselling protection, no
  backorders.** `available` means "the provider says so".
- **No cart across providers.** Multiple items from **one** provider may form a single
  Product Request; two providers are two engagements.
- **No carrier integration, no tracking numbers, no shipping labels.** Delivery is a handover
  event with evidence, not a logistics pipeline.
- A Product Request is always a **request**, never an instant order: the provider must accept
  and pay MHC. This follows from the gate and is not negotiable.

---

## 6. Custom / made-to-order product offers

For items that do not exist until ordered.

| Attribute                | Definition                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Pricing model            | `fixed`, `from`, `per_unit` (per m², per metre, per piece), or `quote_required`                                    |
| **Specification intake** | Structured fields the buyer must supply: measurements with units, material, finish, quantity, drawings/reference images, delivery constraints |
| **Spec confirmation**    | A **mandatory gate**: production cannot start, and the production clock does not run, until the provider states the spec and the buyer confirms it |
| Production lead time     | Declared, and re-declared on the accepted terms; runs from spec confirmation, not from acceptance                 |
| Deposit stance           | Whether a deposit is required, its amount or percentage, and that it is due at spec confirmation                  |
| Change policy            | Whether changes after spec confirmation are possible, and that they require an **Amendment**                      |
| Tolerances               | Declared tolerances on dimensions, colour and material where the category warrants — the most common defect dispute |
| Fulfillment options      | Pickup, delivery, installation — same as physical products                                                        |
| Warranty / rectification | Window and coverage                                                                                                |

The **spec-confirmation gate** is the defining feature of this kind. It exists because
made-to-order disputes are almost always "that isn't what I asked for", and the only defence
is a recorded, mutually confirmed specification that predates production. It is a product
requirement, not an optional workflow.

---

## 7. Business offers

A Business publishes the **same four kinds**, with these differences and no others:

| Aspect                     | Business specifics                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| Kind availability          | **All four.** The Expert/Craftsman exclusivity is a rule about persons, not organizations     |
| Enablement                 | Requires **V3b (KYB) approval** plus owner V1. Publishing an offer is a providing action, and providing is the side KYB gates — buying needs only V3a ([00 §4.1](./00-overview-and-terminology.md)) |
| Identity shown             | Trade name **and verified legal name**, registration reference, KYB badge                     |
| Credentials                | Held in the company's name; scope displayed on the offer                                      |
| Ceilings                   | Higher catalog size, media allowance, proposal quota, concurrent-engagement cap               |
| Accountability             | The BCI is accountable for delivery regardless of who performs it; no staff attribution in Wave 3 |
| Surface separation         | Offers live on the **sales** surface only and never appear on the procurement surface         |
| Reputation                 | Aggregates to the BCI, never to the owner's personal identity or another BCI                  |

There is deliberately **no `business_service` kind**. Introducing one would duplicate the
package model, the storefront model, the variant model and the fulfillment mapping, and the
duplicates would drift.

---

## 8. Offer lifecycle: published, paused, hidden, rejected, archived

### 8.1 States

```
draft ──submit──▶ pending_review ──approve──▶ published ◀──resume── paused
  ▲                    │                          │  │                ▲
  │                    └──reject──▶ rejected      │  └───pause────────┘
  │                                    │          │
  └────────────edit & resubmit─────────┘          ├──enforcement──▶ hidden ──lift──▶ published|paused
                                                  │
                                                  └──archive──▶ archived  (terminal for discovery)
```

### 8.2 Behaviour of each state

| State            | In search / D0 | Direct link                       | New requests | Existing engagements | Who sets it            |
| ---------------- | -------------- | --------------------------------- | ------------ | -------------------- | ---------------------- |
| `draft`          | No             | Owner only                        | No           | n/a                  | Owner                  |
| `pending_review` | No             | Owner only                        | No           | n/a                  | Owner (on submit)      |
| `published`      | **Yes**        | Yes                               | **Yes**      | Unaffected           | Admin approval         |
| `paused`         | No             | Yes, marked *not currently accepting*, prices shown | No | **Unaffected**      | Owner                  |
| `hidden`         | No             | **No** — 404 to everyone except the owner and admins | No | **Unaffected**     | System / admin (enforcement, lapsed verification, moderation) |
| `rejected`       | No             | Owner only, with the rejection reason | No       | n/a                  | Admin                  |
| `archived`       | No             | Yes, read-only, marked *no longer offered*; reviews remain readable | No | **Unaffected** | Owner                  |

### 8.3 Rules

- **No state change ever touches a live engagement.** Pausing, hiding, rejecting or archiving
  an Offer changes discovery and the ability to create *new* arrangements. Everything already
  sold runs to completion on its snapshot. This is the single most important rule in this
  file.
- **`paused` vs `hidden` is owner-choice vs enforcement**, and they must be visually and
  behaviourally distinguishable to the owner: a paused offer keeps its link and its social
  proof; a hidden one is suppressed and carries a reason the owner can read and appeal.
- **`hidden` is also the automatic destination** for: commercial suspension, lapsed V2 in a
  credential-required category, lapsed KYB, and moderation takedown. Lifting the cause
  restores the previous state, not always `published`.
- **`archived` preserves reviews and history.** Archiving is not deletion; an archived offer
  remains linkable so that reviews and engagement snapshots referencing it are not orphaned.
- **Offers are never hard-deleted** once they have carried an engagement or a review.
  Drafts that never published may be deleted.
- **Resubmission after rejection** goes back through `pending_review` and increments the
  version.
- **Re-publication after a long pause** re-enters moderation if the offer's content changed
  or if the pause exceeded a configured window — a dormant listing is a common vector for
  post-approval edits.

---

## 9. Moderation

- **Every publish and every material edit is reviewable.** Whether review is pre-publication
  (queued) or post-publication (spot-checked with automated pre-screen) is an operational
  setting; the automated pre-screen is not optional in either case.
- Automated pre-screen covers: contact patterns in text and media, prohibited categories,
  price plausibility, duplicate listings, credential claims exceeding the verified V2 scope,
  and organizational claims on a personal identity.
- Rejections carry a **reason code and free-text explanation**, are appealable once, and are
  recorded against the identity for pattern detection.
- Approval is **not** an endorsement and must never be presented as one. A published offer
  carries no platform guarantee of quality, price or legality.

---

## 10. Offer-level analytics

Per offer and per version: impressions, views, quote requests, requests received, acceptance
rate, activation rate, conversion, cancellation rate by cause, average agreed amount vs
listed price, revision rate, rating and review count.

The **listed-price-vs-agreed-amount** gap is not a vanity metric. A persistent gap is either
a mispriced listing or a bait pattern, and the platform needs to see it to enforce §1.
