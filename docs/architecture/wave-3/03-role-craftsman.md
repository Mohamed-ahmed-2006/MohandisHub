# 03 — Craftsman

> Craftsman is the second shape a **Personal Commercial Identity** can take. It is the
> physical-work shape: work that happens at an address, in a workshop, or as an object that
> has to be made, moved, handed over and sometimes installed.

---

## 1. Purpose

To let a verified individual tradesperson, shop owner or workshop operator sell local
services and physical goods with the machinery that physical work actually requires:
a **storefront**, a **service area**, **availability**, **delivery, pickup and
installation**, and **made-to-order production**.

Craftsman is separate from Expert because geography, handover and physical evidence are
first-class here and absent there. A Craftsman engagement can fail for reasons an Expert
engagement cannot — nobody was home, the van could not reach the site, the item was never
collected — and the fulfillment machinery must model those.

---

## 2. Commercial identity

- **Personal Commercial Identity (PCI), type `craftsman`.** One per identity, at most.
- The legal person is the commercial identity. A **trade name** ("Al-Nour Metalworks") is
  permitted as a storefront display name, but the Craftsman is not a registered
  organization, must not present as one, and the verified natural person remains the
  contracting party. A registered organization is a **Business**.
- Owns its own: storefront, service and product catalogs, service areas, availability,
  reputation, reliability metrics, **MHC balance**, and enforcement state.
- Distinct from the person's `personal_buyer` context in every respect.
- Cannot coexist with an Expert PCI on the same identity. Conversion to Expert is
  **permitted, and delivered in Wave 3 as an Admin/Support-executed operation**
  ([00 §3.5](./00-overview-and-terminology.md)) — audited, archival rather than mutation, never
  a self-service button, and blocked while any unresolved commercial obligation exists. The
  Craftsman identity is **archived, not retyped**; its reviews and reputation stay with it
  permanently, and its **available MHC balance carries over exactly once** to the replacement
  Expert identity.

The trade-name allowance carries an obligation: at D3, and on every engagement snapshot,
the **verified legal name** of the person is disclosed alongside the trade name. A customer
must always be able to learn who they are actually dealing with once they have engaged.

---

## 3. Main advantages

- **A real storefront.** One place that carries the shop's identity, services, products,
  hours, areas and reputation — rather than a list of disconnected listings.
- **Geography works for them.** Service areas, per-area travel fees and minimum order values
  mean a Craftsman is discoverable exactly where they can actually serve, and priced for
  the distance.
- **Both services and goods.** Callout repairs, workshop jobs, off-the-shelf products and
  made-to-order production live under one identity with one reputation.
- **Variants without a warehouse.** Sizes, materials and finishes are expressible as product
  variants with their own prices and lead times, without any inventory system to operate.
- **Bookings.** Slot-based availability with lead-time buffers and daily job caps prevents
  the classic small-shop failure of over-committing.
- **Physical evidence protects them.** Intake photos, arrival check-in and handover
  confirmation give a Craftsman the record that "it was fine when I collected it" disputes
  normally lack.
- **Flat platform cost.** A fixed MHC charge per accepted engagement, never a cut of the
  job value, and never a deduction from cash the Craftsman receives directly.

---

## 4. Main limitations

- **Must pay MHC to accept.** Same gate as Expert; no credit, no acceptance.
- **No inventory system in Wave 3.** Stock is a manually maintained status per variant, not
  a tracked quantity. Overselling is possible and the product must say so honestly to both
  sides ([08 §9](./08-craftsman-storefront.md)).
- **No cart, no basket, no multi-provider order.** Several products from _this_ shop can be
  one request; two shops are two engagements.
- **No shipping-carrier integration, no tracking numbers, no logistics.** Delivery is the
  Craftsman's own arrangement, recorded as a handover event.
- **No platform payment guarantee**, no escrow, no card acceptance through the platform.
- **Cannot sell knowledge-only digital services** as an Expert would — a Craftsman may
  attach documentation to a physical job, but consulting is not a Craftsman offer.
- **Cannot operate staff, branches or a second location** — Wave 4.
- **Service area is a promise.** Declaring an area the Craftsman cannot actually reach
  produces cancellations, which are recorded.

---

## 5. Registration and activation

1. Choose to become a personal provider → choose **Craftsman** (exclusive, consequences
   shown).
2. Complete **V1 (KYC)**.
3. Complete the storefront minimum: trade/display name, trade category, at least one
   service area **or** a workshop location, operating hours, and at least one publishable
   catalog item.
4. Complete **V2** where the trade category is flagged `credential_required` (electrical,
   gas, lifting, and similar — the flag is admin-configured per category).
5. Accept provider terms, including the explicit statements that the platform holds no
   money and charges MHC to accept work.
6. → **Provider Enablement granted.**

**Location evidence:** a Craftsman declaring a fixed workshop must record its address. The
**coarse part is public (D0); the exact address and coordinates are D3 only**, released solely
to authorized participants after a successful Engagement Activation.

**There is no walk-in address exception.** No opt-in, no toggle, no "published premises" mode
and no moderation determination publishes an exact workshop address, at any tier below D3, for
any operating model — `mobile_only`, `workshop_only` or `both` alike. What a shop with public
premises may publish instead is in [08 §1](./08-craftsman-storefront.md): workshop name, city,
district, coarse service zone, service area, an approximate map area that cannot identify the
premises, and moderated public storefront media.

**Engagement Activation** remains separate and per-engagement.

---

## 6. Verification requirements

| Requirement                          | Status                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------ |
| V0 contact verification              | Mandatory                                                                |
| **V1 identity (KYC)**                | **Mandatory** before enablement                                          |
| V2 trade credential / licence        | Mandatory in credential-required categories; optional badge elsewhere    |
| Workshop location evidence           | Required when a fixed workshop is declared; verified at admin discretion |
| Sanctions / duplicate-identity check | Mandatory; one PCI per verified natural person                           |
| Re-verification                      | On expiry, on trade-name or location change, on enforcement flag         |

- A trade name must not duplicate a verified Business's registered name, and name collisions
  are a moderation matter at publication time.
- Credential scope is displayed with the badge; an unlicensed Craftsman must not appear
  licensed for a regulated trade.
- Verification tier, credential scope and trade name are **snapshotted** onto every
  engagement at activation.
- **The legacy `platform_verified_at` badge enables nothing.** It is not V1, not V2, and not a
  partial substitute for either. It never enables a PCI, never permits storefront or catalog
  publication, never authorizes proposals, MHC spend or D3 access, and never rescues a lapsed
  tier — a revoked or expired Wave 3 credential blocks new commercial actions even where the
  legacy timestamp remains populated. Existing Craftsmen are classified **unverified for Wave 3
  commercial authority** until they hold valid new verification evidence
  ([00 §12](./00-overview-and-terminology.md)).

---

## 7. Profile capabilities

The Craftsman profile **is** the storefront. Full model in
[08](./08-craftsman-storefront.md); the disclosure split is:

| Element                                                                                                                                            | Tier                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Trade name, logo, cover, trade categories, storefront description                                                                                  | D0                                         |
| Rating, review count, completed engagements, verification and credential badges                                                                    | D0                                         |
| Workshop **name**, coarse workshop location (city/district), coarse service zone, **service areas served**, travel-fee bands                       | D0                                         |
| Approximate map area that cannot identify the exact premises                                                                                       | D0                                         |
| Operating hours, typical lead time, response time, on-time rate                                                                                    | D0                                         |
| Service catalog and product catalog with prices, variants and stock status                                                                         | D0                                         |
| Work gallery (past work, moderated, consent-recorded)                                                                                              | D1                                         |
| Availability calendar and bookable slots                                                                                                           | D1                                         |
| Delivery options, fees, minimum order values, warranty terms                                                                                       | D1                                         |
| **Exact workshop address, building number, floor/unit, exact map pin, GPS coordinates, any map link or directions identifying the exact premises** | **D3 only — no exception**                 |
| Pickup instructions containing the exact premises or directions to it                                                                              | **D3**                                     |
| Verified legal name, phone, email, payment instructions                                                                                            | **D3**                                     |
| External links controlled by the Craftsman — website, social handles, booking pages                                                                | **D3** (and never a route around the gate) |

---

## 8. Search and discovery capabilities

**Being discovered:** offer search, provider search, category browse, map/area browse and
recommendations. Ranking inputs include service-area coverage of the searcher's coarse
location, rating, verification tier, response time, on-time rate and availability.

Geography is a **filter, not a hint**: a Craftsman whose declared areas do not cover the
buyer's location is excluded from location-scoped results rather than shown and rejected
later.

**Verification tier as a ranking input means the Wave 3 tier.** The legacy
`platform_verified_at` badge confers **no search preference** and is never a filter, facet or
ranking input ([00 §12](./00-overview-and-terminology.md)).

**Discovering work:**

- Opportunity feed of open Needs of eligible types — `local_service`, `product_supply`,
  `custom_product`, `product_plus_service` — filtered to the Craftsman's categories **and**
  intersected with its declared service areas.
- Sees Needs at **D2**: brief, **structured requirement attributes**, budget mode, timeline,
  **coarse** location only, attachment **manifest only**, proposal count, buyer conduct band.
- Never sees at D2: exact address, buyer contact, other proposal amounts, or **any attachment
  content** — no previews, no thumbnails, no sanitized renditions.

The coarse-location rule is the sharpest tension in this role: a Craftsman genuinely needs
to know the distance to price travel. Wave 3 resolves it by making the **coarse unit
granular enough to price** (city/district), publishing **travel-fee bands by area** so the
Craftsman prices from their own table rather than from the exact address, and disclosing the
exact address only at D3.

The rule is symmetrical, and this is the correction the readiness audit required: **the
Craftsman's own exact workshop address and coordinates are equally D3-only.** The buyer's exact
address and the provider's exact premises are the same class of protected data, released to
authorized participants by the same event — a committed activation — and by nothing else.

**Pricing physical work without seeing the photographs.** This is the second sharp tension in
this role, and it is resolved the same way — by structure rather than by exception. The
instruments are:

1. **Category-specific structured intake.** `local_service` and `custom_product` Needs carry
   typed fields chosen for the trade: symptom, dimensions with units, material, model and make,
   age, quantity, floor and lift access, power availability, clearance, hazards. These are
   filterable, comparable and adjudicable, which a photograph never is.
2. **Free-form descriptive text** at D2, contact-masked, where the buyer explains what the
   fields cannot.
3. **The manifest**, so the Craftsman knows evidence exists and will be released the moment
   they activate.
4. **`survey_required` pricing and the priced site survey** ([08 §2](./08-craftsman-storefront.md))
   for work that genuinely cannot be priced remotely. The survey is itself an engagement — it
   is the honest, paid answer to "I need to see it first", and it is a better outcome for the
   Craftsman than a free look at a photograph.

A preview would be the fifth instrument and is not available: the same image that shows a
cracked wall shows the street sign, the door number and the van in the driveway.

---

## 9. Buying capabilities

The person behind a Craftsman PCI is a full customer in `personal_buyer` context, with
everything in [01](./01-role-customer.md). The Craftsman identity itself buys nothing —
there is no supplier-side procurement, no materials purchasing and no B2B ordering under
the Craftsman identity in Wave 3.

Self-dealing applies: no buying from one's own Craftsman identity or from an owned Business.

---

## 10. Providing capabilities

| Capability                                     | Wave 3                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Publish offers                                 | ✅ `craftsman_service`, `physical_product`, `made_to_order_product`                |
| Service pricing models                         | ✅ fixed, from-price, per-unit, survey-required (with optional inspection fee)     |
| Product variants                               | ✅ option types → values → variants with own price, lead time and stock status     |
| Made-to-order products                         | ✅ with spec intake and a mandatory spec-confirmation gate                         |
| Service areas and travel fees                  | ✅ per-area fee and minimum order value                                            |
| Delivery                                       | ✅ provider delivery with per-area fee, free-above-threshold, or customer-arranged |
| Pickup                                         | ✅ with pickup window and handover confirmation                                    |
| Installation                                   | ✅ as a priced, separately scheduled component                                     |
| Bookings and availability                      | ✅ slots, working hours, blackout dates, daily job cap, lead-time buffer           |
| Proposals on Needs                             | ✅ free, quota-limited, eligible types only                                        |
| Custom proposals / quotes after survey         | ✅                                                                                 |
| Warranty / rectification terms                 | ✅ declared per offer and snapshotted onto the engagement                          |
| Digital-only knowledge services                | ❌ (Expert)                                                                        |
| Inventory quantities, reservations, backorders | ❌ Wave 4                                                                          |
| Staff, second location, branch                 | ❌ Wave 4                                                                          |

Fulfillment component types a Craftsman may attach: **on-site service**, **workshop service**,
**physical product**, **made-to-order product**, **delivery**, **pickup** and **installation**.
Also **consultation/session** where a category supports a paid site survey or remote diagnosis,
but never a purely digital deliverable as the whole engagement. A **product + service** job is
a **hybrid composition** of two or more of those component types, not a component type of its
own ([11 §11](./11-fulfillment-models.md)).

### 10.1 Applying to recruitment Jobs

Separately from providing, a Craftsman may **apply as a candidate** to a Business's job vacancy
in the **Jobs** recruitment module ([00 §10](./00-overview-and-terminology.md)).

- The Craftsman applies **through their active Personal Commercial Identity**.
- **A job application is recruitment candidacy, not a Proposal.** It creates no Proposal row,
  no pre-activation intent object and no Engagement, and it consumes no proposal quota.
- **Applying and being hired cost no MHC.** Hiring is not an Engagement Activation.
- **Recruitment outcomes do not alter the Craftsman's service reputation** — no rating, no
  reliability metric, no ranking signal ([14 §12](./14-reviews-and-reputation.md)).
- **Being hired is an employment outcome.** Any resulting salary is outside the platform's
  settlement model entirely ([12 §12A.5](./12-payment-and-settlement.md)).

---

## 11. Communication capabilities

Identical gate structure to Expert, with two physical-work additions at D3:

- **Scheduling messages** tied to a fulfillment component: arrival windows, delays,
  reschedules, "on my way" notices — surfaced as structured events, not just chat, because
  they are the evidence for punctuality metrics.
- **Handover coordination**: pickup readiness notices, collection reminders, and
  handover-code exchange.

At D2, **pre-award communication** — structured clarification and free-form text — is bounded,
strictly contact-redacted and moderated, and is the _only_ pre-activation channel. Site
photographs **cannot be obtained before activation by any route**: not by asking in a message,
not as a preview, not as a thumbnail. The Craftsman prices from the structured attributes, the
redacted description and the manifest, or sells a priced survey. The photographs are released
in full the moment the engagement is activated.

---

## 12. File and attachment capabilities

| Surface                                       | Rule                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Storefront gallery, product and service media | Public at D0/D1, moderated, contact-scanned, consent-recorded for customer sites                                  |
| Proposal / custom proposal attachments        | **Not permitted**                                                                                                 |
| Pre-award communication                       | **No attachments of any type**                                                                                    |
| Need attachments received                     | **Manifest only** at D2 — no content, no preview, no rendition; full at D3                                        |
| **Intake evidence**                           | Required at D3 for workshop jobs: item condition photos at drop-off                                               |
| **Progress and completion evidence**          | Required at D3 per fulfillment type: before/after photos, arrival check-in, installation photos, functional check |
| **Handover evidence**                         | Recipient confirmation, handover code, or signed/photographed handover record                                     |
| Warranty and rectification records            | Attached to the engagement, retained beyond the warranty window                                                   |
| Case evidence                                 | Permitted per case rules, including while suspended                                                               |

Evidence media is a **product requirement of the fulfillment type**, not an optional nicety
— minimum counts and required moments are defined in [11](./11-fulfillment-models.md) and
configurable per category, but the requirement itself is not optional.

---

## 13. Payment-related capabilities

- **Payment instructions at D3 only**, including cash-on-completion, cash-on-delivery,
  InstaPay, bank transfer, or in-shop card — all of which are the Craftsman's own
  arrangements. The platform relays and disclaims.
- **Deposits are first-class here.** Made-to-order production and material purchase
  legitimately require money up front, so the payment plan supports deposit + balance with
  the deposit tied to the spec-confirmation gate.
- May **report** payments received (including cash), **confirm or reject** customer-reported
  payments, and attach proof. Cash payments are reportable and confirmable exactly like
  transfers — the record is the parties' agreement, not a bank feed.
- **Holds MHC** on the Craftsman PCI. Non-transferable, non-cashable, non-convertible.
- **Holds no cash balance and no withdrawal surface.**

---

## 14. Fulfillment responsibilities

1. **Only accept what the service area, calendar and stock status can actually support.**
   Accepting outside the declared area or on a full day converts a shop problem into a
   customer problem, and cancellations are recorded by cause.
2. **Attend the slot.** Arrival check-in is required for on-site work; lateness and no-shows
   are measured.
3. **Record intake condition** for workshop jobs before touching the item. This protects the
   Craftsman more than the customer.
4. **Produce the required evidence** at each moment its fulfillment type demands it —
   arrival, before/after, dispatch, handover, installation, functional check.
5. **Obtain spec confirmation before production** on made-to-order work. Producing against
   an unconfirmed spec is at the Craftsman's own risk and is not a valid dispute position.
6. **Honour the declared warranty / rectification window**, or route the change to an
   Amendment.
7. **Do not hand over against an unpaid balance and then rely on the platform to collect** —
   the platform records; it does not recover. The payment plan exists so the Craftsman can
   sequence handover and payment as they choose.
8. **Store, notify and escalate uncollected items** per the declared pickup policy;
   uncollected work is never auto-completed.

---

## 15. Review capabilities

- **Receives** reviews on completed engagements, attached to the Craftsman PCI and to the
  specific service or product where applicable. Product reviews aggregate at the **product**
  level across variants, with the purchased variant recorded on each review.
- Per-criterion sub-ratings suited to physical work: workmanship, punctuality, cleanliness,
  price accuracy, communication, and — where relevant — item condition on arrival.
- **One public response** per review, editable once, moderated, no contact details.
- May report reviews for moderation; may not buy, solicit or condition them.
- **Writes** structured buyer conduct ratings, which matter more here than for Expert:
  access refused, site not ready, item not collected, no-show.
- **Reputation is bound to the PCI.** It does not transfer to a later Business, and **does not
  carry across a PCI conversion** — on conversion to Expert, every review stays permanently
  attached to the archived Craftsman identity and the replacement starts at zero
  ([00 §3.5](./00-overview-and-terminology.md)).

---

## 16. Dispute capabilities

- May open cases for: non-payment, disputed settlement, customer no-show, refused access,
  site conditions materially different from the brief, uncollected items, abusive conduct,
  fraudulent Need, and off-platform solicitation by the customer.
- Physical-work disputes turn on evidence the platform can actually hold: intake photos,
  arrival timestamps, before/after media, handover confirmations. The fulfillment model is
  designed to generate exactly that evidence, so disputes are decidable without financial
  records — which is the mitigation the launch model requires.
- Retains full case and evidence access under any suspension.
- May request **MHC re-grant** under the narrow circumstances in
  [13 §9](./13-mhc-activation.md).
- The platform cannot compel payment, order a refund, or take possession of goods.

---

## 17. Analytics capabilities

| Group      | Metrics                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Demand     | Storefront views, service and product views, views by area, quote requests, booking requests, conversion by catalog item and variant            |
| Geography  | Requests by area, accepted vs declined by area, travel-fee realization, out-of-area demand the shop is missing                                  |
| Proposals  | Submitted, quota remaining, win rate, award-to-activation rate, lapse rate                                                                      |
| Operations | Bookings per day vs cap, on-time arrival rate, average lead time, rework/rectification rate, uncollected-item count, cancellation rate by cause |
| Settlement | Agreed vs reported vs **confirmed** vs **verified**, deposit realization, coverage distribution                                                 |
| MHC        | Balance, spend by action key, MHC cost per engagement and per confirmed settled unit, re-grants                                                 |
| Reputation | Rating trend, per-criterion breakdown, review volume by product and service, reliability metrics                                                |

Same honesty rules as Expert: reported ≠ confirmed ≠ verified, three labels, and only
verified feeds badges or any future GMV-based model.

---

## 18. Suspension behaviour

| Axis                      | Effect                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Restriction**           | Reduced proposal quota, capped daily bookings, new catalog publication paused.                                                                                                          |
| **Commercial suspension** | Storefront and every catalog item hidden from D0/D1; no proposals, quote replies, purchase or booking acceptances, or activations; MHC purchase blocked; balance frozen, not forfeited. |
| **Profile suspension**    | Storefront removed from discovery and direct links; authored reviews hidden pending review.                                                                                             |
| **Termination**           | Only after open engagements complete, are cancelled with customer remedy, or are administratively closed with a determination.                                                          |

Under every state the Craftsman keeps: existing engagement access, scheduling, delivery,
evidence upload, handover, warranty/rectification handling, messaging, settlement reporting
and confirmation, case participation and appeal.

One physical-work specific rule: **a suspended Craftsman holding a customer's property must
still be able to complete handover.** Suspension never traps an item in a workshop, and the
`awaiting_collection` and handover paths remain fully operable in every suspension state.

---

## 19. Actions explicitly prohibited

1. Holding an Expert PCI or selling purely digital knowledge deliverables as a standalone
   engagement.
2. Presenting the trade name as a registered company, or concealing the verified legal name
   at D3.
3. **Publishing an exact workshop address, building number, floor or unit, exact map pin, GPS
   coordinates, a map link exposing the exact premises, or directions sufficient to locate the
   workshop exactly — at D0, D1 or D2, for any operating model, under any opt-in.** This
   includes embedding an address in gallery media, product photos, pickup instructions or item
   titles.
4. Transmitting contact details, links, handles or payment instructions at D0/D1/D2 by any
   means, including images and file names.
5. Attaching files to proposals, custom proposals or pre-activation Q&A.
6. Accepting an engagement without a successful MHC charge.
7. Accepting work outside the declared service area and then cancelling as a matter of
   routine.
8. Marking a variant available with no intention or ability to supply it.
9. Producing made-to-order work before spec confirmation and then disputing on that basis.
10. Beginning work at a site before arrival check-in, where the fulfillment type requires it.
11. Soliciting the customer to cancel and transact off-platform.
12. Requesting payment through MohandisHub or implying the platform holds or guarantees
    funds.
13. Withholding a customer's property to force a settlement outside the declared policy.
14. Transferring, selling or cashing out MHC.
15. Soliciting, trading or conditioning reviews.
16. Buying from, proposing to, or reviewing a related commercial identity.

---

## 20. Features deferred to Wave 4 or later

- **Real inventory:** tracked quantities, reservations on request, decrement on completion,
  low-stock alerts, backorders, multi-location stock.
- **Staff and branches:** employees, job assignment, per-branch service areas and hours,
  branch-level reputation.
- **Workspace-owned storefront** — catalog and reputation owned by an entity rather than the
  person.
- **Logistics:** carrier integration, tracking numbers, shipping-label generation, delivery
  routing and live driver tracking.
- **Route and capacity optimization**, travel-time-aware slot generation.
- **Cart and multi-shop checkout.**
- **Supplier-side procurement** under the Craftsman identity.
- **Recurring maintenance contracts** and scheduled service plans.
- **Structured warranty claims** as their own object, separate from cases.
- **Paid promotion and featured shop placement** — unapproved.
- **Priced advertisements.** The advertisement machinery is implemented, wired and operational
  at a **zero price**; what is deferred is non-zero pricing, which requires explicit
  configuration and commercial approval ([00 §14.1](./00-overview-and-terminology.md)).
- **Any escrow, cash-on-delivery collection by the platform, or platform-held funds.**
