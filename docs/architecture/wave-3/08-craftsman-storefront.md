# D — Craftsman Storefront

> The **storefront** is the Craftsman's whole public presence: identity, catalogs,
> geography, availability and fulfillment options in one place. A Business publishing
> craftsman-shaped offers uses the same storefront model under its organizational identity.

---

## 1. Shop / workshop identity

| Element                              | Rule                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Trade name**                       | Optional display name (e.g. "Al-Nour Metalworks"). Must not imply a registered company, plural personnel, or an organization. Moderated at publication and on change |
| **Verified legal name**              | Held always; disclosed at **D3** on every engagement and in every engagement snapshot                                  |
| Logo, cover image, gallery           | D0/D1; moderated for contact leakage; customer-site photos require recorded consent                                    |
| Trade categories                     | Drive discovery, eligibility, credential requirements and evidence requirements                                        |
| Storefront description               | D0; no contact details, links, handles or addresses                                                                    |
| **Operating model**                  | `mobile_only` (goes to the customer) · `workshop_only` (customer comes) · `both`                                        |
| **Workshop name**                    | Optional public premises name. D0, moderated. It names a shop; it does not locate one    |
| **Workshop location**                | Required when the model includes workshop work. **Coarse part D0** — city, district, coarse service zone, and an approximate map area that cannot identify the exact premises. **Exact address, building number, floor/unit, exact map pin and GPS coordinates are D3 only, with no exception** |
| Operating hours, holidays            | D0                                                                                                                     |
| Typical lead time, response time, on-time rate | D0, computed, not self-declared                                                                              |
| Badges                               | V1 verified, V2 credential with scope, rating, completed engagements, verified settled-volume band                     |
| Payment methods accepted             | Method **types** at D1 (cash, transfer, InstaPay, in-shop card); **instructions and account details at D3 only**       |

### 1.1 Exact premises are D3 — there is no walk-in address exception

The earlier "walk-in address exception", which allowed an opt-in published premises address at
D1, is **removed**. It was a hole in the disclosure gate: an opt-in that publishes the exact
premises publishes exactly what activation is supposed to sell, and a `workshop_only` Craftsman
who took it had given away the gate for every engagement, not only for walk-in trade.

**Public and pre-activation disclosure (D0/D1/D2) may include:**

| Permitted below D3                                                          |
| --------------------------------------------------------------------------- |
| Workshop name                                                               |
| City                                                                        |
| District                                                                    |
| Coarse service zone                                                         |
| Service area(s) served                                                      |
| An **approximate map area** that cannot identify the exact premises         |
| Moderated public storefront media                                           |

**Public and pre-activation disclosure must not include:**

| Prohibited below D3                                                         |
| --------------------------------------------------------------------------- |
| Exact street address                                                        |
| Building number                                                             |
| Floor or unit                                                               |
| Exact map pin                                                               |
| GPS coordinates                                                             |
| A map link exposing the exact premises                                      |
| Directions sufficient to locate the workshop exactly                        |

**Exact workshop address and coordinates are D3-only**, and become accessible solely to
authorized participants after a successful MHC Engagement Activation
([13 §6](./13-mhc-activation.md)).

This applies to **every operating model** — `mobile_only`, `workshop_only` and `both` — with no
opt-in, no revocable toggle, no moderation determination and no per-category variation. The
customer-facing answer to "where is the shop" is the coarse area and the approximate map area,
which is enough to decide whether a shop is reachable and is not enough to arrive at its door
without engaging.

A pickup location is disclosed to the collecting party at D3, as part of the pickup component's
own handover flow ([§7.2](#72-pickup)) — never on the public storefront.

---

## 2. Service catalog

Craftsman service offers (`craftsman_service`), each with:

| Attribute            | Options                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Pricing model**    | `fixed` · `from` (starting at) · `per_unit` (hour, m², metre, point, item) · `survey_required`                    |
| Inspection fee       | For `survey_required`: optional priced survey, and whether it is credited against the job if the quote is accepted |
| **Location model**   | `at_customer_site` · `at_workshop` · `either`                                                                     |
| Duration estimate    | Expected on-site or workshop time; drives slot length                                                             |
| Crew / access needs  | What the site must provide: power, water, parking, clearance, lift access                                         |
| **Inclusions / exclusions** | Structured lists, minimum one exclusion — materials included or not is the single most disputed line       |
| Materials stance     | `materials_included` · `materials_extra` · `customer_supplies`                                                    |
| **Warranty window**  | Duration and coverage for rectification; snapshotted                                                              |
| Evidence profile     | Category-driven minimum: arrival check-in, before/after photo counts, functional check                            |
| Requirements intake  | Structured questions answered at request time                                                                     |
| Add-ons              | Priced extras with their own duration deltas (extra point, additional unit, out-of-hours)                         |

`survey_required` is the honest model for work that genuinely cannot be priced remotely, and
with no pre-activation attachment previews it is the primary instrument for work that has to be
seen. Its flow is: buyer requests survey → provider accepts (**MHC charged**, the survey is
itself an engagement) → survey performed → provider issues a **Custom Proposal** → buyer
accepts → **second engagement, second activation, second charge**.

Both charges stand. Every engagement origin passes through the same activation pipeline
([13 §2](./13-mhc-activation.md)), and there is no waiver mechanism: an unset or zero-configured
price **fails the action closed** rather than making it free
([17](./17-product-invariants.md), INV-065). Where the post-survey conversion warrants
different economics, the instrument is a **distinct configured action tier** for post-survey
custom orders with its own price — priced low if that is the commercial intent, never waived
and never zero. The survey engagement references forward to the custom order it produced, so
the chain is auditable and the two-charge sequence is measurable.

---

## 3. Product catalog

`physical_product` offers, per [06 §5](./06-offer-model.md). Storefront-level additions:

- Products are grouped into **provider-defined collections** for storefront navigation.
- A product may be marked **pickup-only**, **delivery-only**, or both.
- **Minimum order value** may be set at the storefront level and overridden per product.
- Products carry a **unit** (piece, metre, kg, m²) and a minimum order quantity.
- Bulk/tiered pricing by quantity is supported as a simple quantity-break table.

---

## 4. Variants

| Concept          | Definition                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Option type**  | A named dimension: size, material, colour, finish, capacity, thickness. Max count admin-configurable          |
| **Option value** | A value within a type, with optional swatch/image                                                             |
| **Variant**      | A combination of one value per option type — the actual purchasable unit                                      |
| Per-variant      | Price, lead time, **stock status**, media, minimum order quantity, weight/dimension band for delivery pricing |
| Default variant  | One variant is the display default and supplies the storefront price                                          |

Rules:

- The **variant is what is purchased and what is snapshotted** onto the engagement. A review
  records the variant purchased ([14 §5](./14-reviews-and-reputation.md)).
- Variants may be **individually paused** (`out_of_stock`) without pausing the product.
- Removing an option type or value is a **version increment**, never a rewrite; variants
  referenced by an engagement or a review are retained.
- The total variant count per product is capped (admin-configurable) — a combinatorial
  explosion is unmaintainable by hand, and Wave 3 has no bulk editing.

---

## 5. Made-to-order products

`made_to_order_product` offers, per [06 §6](./06-offer-model.md). The storefront-specific
points:

- Made-to-order items appear in the product catalog with a **"made to order"** marker and a
  lead time instead of a stock status.
- The **specification intake** is defined per product: measurements with units, material,
  finish, quantity, and reference images.
- The **spec-confirmation gate** is mandatory and is the point at which the production clock
  and any deposit become due.
- **Declared tolerances** (dimensional, colour, material grain) are a required field for
  categories where they matter, because "it's 2cm off" is the archetypal made-to-order
  dispute and an undeclared tolerance makes it unadjudicable.
- Post-confirmation changes require an **Amendment**, and the provider may decline one.

---

## 6. Service areas

| Element                | Definition                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Area unit**          | Administrative units — governorate → city → district. The finest declared unit governs matching        |
| Coverage set           | The list of units the Craftsman serves. Optionally a radius from the workshop, resolved to units       |
| **Travel fee per area**| A fee band per unit, or a single fee, or free. Displayed at D0 alongside the offer price               |
| **Minimum order value**| Per area, so distant work can carry a floor                                                            |
| Out-of-hours surcharge | Optional, declared                                                                                     |
| Excluded zones         | Explicit exclusions inside an otherwise-covered unit                                                   |

Rules:

- **Service area is a hard discovery filter**, not a ranking hint. A Craftsman is excluded
  from location-scoped results outside their coverage
  ([03 §8](./03-role-craftsman.md)).
- **Travel fees are published before engagement**, so a buyer's total is knowable at D2
  without either party's exact address ever being disclosed. This is what makes the
  coarse-location rule workable for physical trades in both directions (§1.1).
- **A radius declared from the workshop is resolved to administrative units before it is
  displayed.** A published radius with a centre point is a coordinate disclosure, and is
  prohibited below D3 exactly like a map pin ([17](./17-product-invariants.md), INV-024).
- Accepting work outside the declared coverage is possible only by the buyer's directed Need
  or quote request, and the travel fee then comes from the Custom Proposal.
- Coverage changes never affect live engagements.

---

## 7. Delivery, pickup, installation

These are **fulfillment components**, not offers. Any product or product-plus-service
engagement composes them.

### 7.1 Delivery

| Mode                    | Behaviour                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `provider_delivery`     | The Craftsman delivers. Fee per area, or free above a threshold. Delivery window scheduled          |
| `customer_arranged`     | The buyer sends a courier. The provider's obligation ends at **handover to the courier**, evidenced |
| `not_offered`           | Pickup only                                                                                         |

- **No carrier integration, no tracking numbers, no labels.** Delivery is a scheduled handover
  with evidence: dispatch record, recipient name, handover photo or code.
- Delivery fee, window and mode are snapshotted onto the engagement.
- Failed delivery (nobody present) is a recorded event with a re-attempt policy declared by
  the provider; repeated failure moves the component to `awaiting_collection`, not to
  cancellation.

### 7.2 Pickup

- Requires a **pickup location** (the workshop or a declared point), a **pickup window**, and
  the provider's **storage policy** (how long an item is held, any storage fee, and what
  happens after).
- **The pickup location's exact address and coordinates are D3**, released to the buyer through
  the activated engagement. The storefront advertises pickup availability and its coarse area;
  it never publishes the collection address (§1.1).
- Handover is confirmed by a **handover code** shared by the provider and entered by the
  buyer, or by mutual confirmation.
- **Pickup never auto-completes.** An uncollected item sits in `awaiting_collection` with
  reminders and an admin-visible stale flag ([11 §9](./11-fulfillment-models.md)).

### 7.3 Installation

- A **separately priced, separately scheduled** component that runs after delivery or
  collection.
- Carries its own requirements (site readiness, power, clearance), its own evidence
  (installation photos, functional check), and its own sign-off.
- May be sold as part of a `product_plus_service` offer, as an add-on to a product, or as a
  standalone `craftsman_service`.
- Has its own warranty window, distinct from the product's.

---

## 8. Availability

| Control                | Definition                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Working hours          | Per weekday, with break windows                                                                |
| Blackout dates         | Holidays, vacation, closures — with an auto-resume date shown to buyers                        |
| **Slot generation**    | Slot length per service, plus a buffer between slots                                           |
| **Lead-time buffer**   | Minimum notice before the earliest bookable slot                                               |
| **Daily job cap**      | Maximum accepted jobs per day; reaching it removes remaining slots                             |
| Booking horizon        | How far ahead slots are bookable                                                               |
| Concurrent cap         | Maximum live engagements across the storefront                                                 |
| Per-area day rules     | Optional: serve area A on certain days only — the standard way small shops batch travel        |
| Accepting / paused     | Storefront-level and per-catalog-item pause                                                    |

**Slots are not reservations until activation.** A booking request holds the slot
provisionally for the activation window; if the provider does not activate, the slot is
released. Holding a slot indefinitely on an unpaid request would let a competitor or a
careless buyer empty a calendar for free.

Travel time between jobs is **not** modelled in Wave 3 — buffers and daily caps are the
approximation, and route-aware scheduling is deferred.

---

## 9. Stock-status limitations — Wave 3 inventory reality

This section is written to be quoted directly into the product surface, because
under-communicating it produces the worst class of customer disappointment.

**What exists:**

- A per-variant **status flag** with three values, maintained manually by the provider:
  `available`, `made_to_order`, `out_of_stock`.
- A **stale-status prompt** that asks a provider to reconfirm status after a configured
  period of inactivity on that item.
- A **cancellation reason code** `out_of_stock`, which is measured and which damages
  reliability metrics.

**What does not exist in Wave 3:**

| Absent                          | Consequence the product must state honestly                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| Tracked quantities              | "Available" means the provider says so, not that a count is above zero                       |
| Reservation on request          | Two buyers can request the last item; both requests are valid until the provider accepts one |
| Decrement on completion         | Selling an item does not change its status; the provider must update it                      |
| Overselling protection          | Overselling is possible and is resolved by the provider declining or cancelling              |
| Low-stock alerts, backorders    | None                                                                                         |
| Multi-location stock            | None — a single storefront has one implicit location                                         |
| Bulk stock editing / import     | None; status is edited item by item                                                          |

**Mitigations that are part of the design, not afterthoughts:**

1. **Nothing is an order until the provider accepts**, so an out-of-stock item is declined
   before any obligation exists and before the provider pays MHC. The gate that exists for
   revenue reasons happens to be the correct inventory safety valve.
2. Buyers see a **"stock status is provider-maintained"** disclosure on every product
   request, not buried in terms.
3. `out_of_stock` cancellations after acceptance are recorded by cause and are visible in
   provider analytics and reliability metrics.
4. Providers with a high `out_of_stock` decline rate are prompted, then restricted.

Real inventory is [Wave 4](./16-wave-3-scope.md) and the architecture is compatible with it:
status is a per-variant field that a quantity model can later derive rather than replace.

---

## 10. Storefront-level analytics

Beyond the per-offer metrics in [06 §10](./06-offer-model.md):

- **Views and requests by area**, including demand from areas **not** covered — the single
  most actionable signal a small shop can get.
- Accept vs decline rate by area, by category and by cause.
- Slot utilization against the daily cap; lost slots from **booking intents that lapsed before
  activation** ([10 §7](./10-engagement-model.md)).
- Travel-fee realization: fees quoted vs fees on completed engagements.
- Stock-status hygiene: items not reconfirmed, `out_of_stock` decline rate.
- Rectification/callback rate within warranty, by category and by product.
- Uncollected-item count and age.
