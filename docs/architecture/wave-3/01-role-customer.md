# 01 — Customer

> Customer is **not an account type**. It is a capability every identity holds from the
> moment it exists, and which cannot be switched off, downgraded or revoked while the
> account is alive. An Expert is a customer. A Craftsman is a customer. A business owner is
> a customer personally, and their business is separately a buyer.

---

## 1. Purpose

To let any identity state demand and acquire work or goods from verified providers, with
enough structure that a provider can price the request without ever seeing protected
information first.

The customer is the **demand-side actor**. Wave 3 gives that actor exactly two ways to
create demand — post a **Need**, or engage an existing **Offer** — and one way to convert it
into an obligation: the provider accepts.

---

## 2. Commercial identity

**None.** There is no customer commercial identity, no trade name, no logo, no KYB, no
storefront, no MHC balance and no provider reputation.

The buyer party on an engagement is either:

- the **identity itself**, acting in `personal_buyer` context, or
- a **BCI**, acting in `business:<id>` context (covered in [04](./04-role-business.md)).

A customer accumulates a **buyer conduct signal** (see §15 and §17), which is a reliability
measure, not a public star rating, and never appears on any provider profile.

---

## 3. Main advantages

- **Zero cost.** Posting, browsing, proposing-to, awarding, messaging, disputing and
  reviewing are all free. The customer never spends MHC and never can.
- **No verification burden to start.** V0 (verified email and phone) is enough to transact.
- **Protected by default.** The customer's phone, email, exact address and attachments are
  invisible to providers until a provider has paid to accept the work.
- **Comparison before commitment.** Multiple free proposals against one Need, with price,
  scope, delivery time and provider verification tier side by side.
- **Sees verification honestly.** Provider tier, credential badges and verified settled
  volume are displayed as what they are, without implying a platform guarantee.
- **One demand surface.** Professional work, local labour, physical goods and made-to-order
  goods are all requested the same way and tracked in the same engagement list.

---

## 4. Main limitations

- **The platform holds no money and guarantees no payment.** There is no escrow, no
  buyer protection fund, no chargeback, no platform-issued refund. This must be stated
  in-product at Need creation and at activation, not buried in terms.
- **Completion is attested, not proven.** The platform records evidence; it does not
  witness the work.
- **A Need does not oblige anyone.** Providers may ignore it, and an awarded provider may
  fail to activate.
- **No cart, no multi-provider checkout, no order aggregation.** One engagement is with one
  provider.
- **No stock guarantees.** Craftsman product availability is a manually maintained status,
  not tracked quantity — an "available" item can turn out not to be (see
  [08 §9](./08-craftsman-storefront.md)).
- **Cannot reach a provider outside the gate.** Pre-award communication exists and accepts
  free-form text, but every character is contact-masked and moderated, and **no attachment of
  any type is shareable before activation** — not a photo, not a PDF, not a drawing.
- **No customer-side commercial identity.** A buyer who wants a logo, a trade name and an
  organizational profile must create a Business.

---

## 5. Registration and activation

**Registration:** email or phone → OTP → password/credential → display name → locale. The
identity exists at this point and holds customer capability immediately.

**Enablement gates** (there is nothing to "activate"; these are readiness thresholds):

| Action                                        | Requires                                     |
| --------------------------------------------- | -------------------------------------------- |
| Browse D0                                     | Nothing (guests included)                    |
| Browse D1, save favourites, follow providers  | Signed in                                    |
| Post a Need, request a quote, request booking | **V0** — verified email _and_ verified phone |
| Buy a made-to-order or on-site engagement     | V0 + at least one saved coarse location      |
| Confirm delivery, report payment, dispute     | V0 (and being a party to the engagement)     |

Phone verification is required before demand creation specifically because an unverified
buyer costs providers real MHC when they activate. The cost of a fake Need is borne by the
provider, so the friction belongs on the buyer.

---

## 6. Verification requirements

- **V0 mandatory** to create demand.
- **V1 (KYC) is not required** and must not be requested for ordinary buying. Asking a
  buyer for a government ID to post a Need is a conversion tax with no matching risk
  reduction; the platform holds no buyer money.
- **Optional V1** is available and, if completed, surfaces a "verified buyer" badge to
  providers. This is a _provider-confidence_ feature, not a gate.
- An **abuse-triggered** verification step-up exists: an identity flagged for repeated
  abandoned awards, fake Needs, or contact-harvesting may be required to complete V1 before
  creating further demand. This is an enforcement action, described in
  [15](./15-suspension-and-enforcement.md), not a default.
- **The legacy `platform_verified_at` badge is not a buyer verification signal.** A populated
  legacy timestamp is never presented as, or counted as, the optional V1 "verified buyer"
  badge, and it never substitutes for an abuse-triggered step-up
  ([00 §12](./00-overview-and-terminology.md)). Where a historical badge is still shown, it is
  labelled under clearly legacy semantics until it is retired.

---

## 7. Profile capabilities

The customer's profile is **private by default and minimal by design**.

| Field                                            | Tier        | Note                                                  |
| ------------------------------------------------ | ----------- | ----------------------------------------------------- |
| Display name, avatar                             | D0          | Shown on reviews the customer writes                  |
| Coarse location (governorate/city)               | D2          | Given to providers considering a proposal             |
| Buyer badges (verified buyer, engagements count) | D2          | Confidence signal for providers                       |
| Saved locations, labels, access notes            | D3          | Released only on activation, per engagement           |
| Full name, phone, email                          | D3          | Released only on activation, per engagement           |
| Buyer conduct signal                             | D2 (banded) | Shown to providers as a band, never as a public score |

A customer may maintain **multiple saved locations** (home, site A, office) with per-location
access notes and a coarse/exact split. Selecting a saved location on a Need publishes only
its coarse part until activation.

There is no public customer profile page. A provider cannot browse customers.

---

## 8. Search and discovery capabilities

- Search **Offers** across all four kinds, with filters: category, provider kind
  (Expert / Craftsman / Business), price range, delivery time, rating, verification tier,
  credential badge, service area / delivers-to, availability window, fulfillment type
  (remote, on-site, workshop, pickup, delivery, installation), language.
- Search **Providers** directly, with the same verification and reputation filters.
- **Location-aware discovery** for Craftsman and Business supply: results are filtered and
  ranked by whether the provider's declared service area covers the customer's coarse
  location, with travel fees shown before engagement.
- **Recommendations** and **saved searches** with new-match alerts.
- **Favourites** on both providers and offers.
- Ranking must be explainable and must not silently sell placement: any promoted or featured
  result is labelled. Paid promotion itself is out of Wave 3 scope
  ([16 group 3](./16-wave-3-scope.md)).
- **Verification filters and trust indicators read Wave 3 verification tiers only.** The legacy
  `platform_verified_at` badge is never a search filter, a ranking input, a facet, or a trust
  indicator that implies identity or credential verification
  ([00 §12](./00-overview-and-terminology.md)).
- Guests may search at D0 and are prompted to sign in at the point of action, not the point
  of browsing.

---

## 9. Buying capabilities

Five ways to create a pending arrangement. All five converge on
[the Engagement spine](./10-engagement-model.md).

| Route                 | Customer action                                                                | Becomes engagement origin |
| --------------------- | ------------------------------------------------------------------------------ | ------------------------- |
| Post a Need → award   | Publish a Need, receive Proposals, select one → **Award Offer**                | `need_award`              |
| Buy a package/service | Choose an Offer/package + add-ons + answer requirements → **Purchase Request** | `service_purchase`        |
| Book a slot           | Choose an availability slot → **Booking Request**                              | `booking`                 |
| Request a product     | Choose product + variant + quantity + delivery method → **Product Request**    | `product_request`         |
| Accept bespoke terms  | Send a Quote Request → receive a **Custom Proposal** → accept                  | `custom_order`            |

Rules the customer experiences:

- **Nothing is an order until the provider accepts.** Every route produces a _pending
  request_ with a visible deadline. This is a direct consequence of the MHC gate: the
  provider must pay to accept, so the provider must be able to decline.
- The customer may **withdraw** any pending request before activation, at no cost, and the
  provider is not charged.
- A Need in `award_pending` accepts no new proposals; the customer may revoke the award and
  select another provider at any time before activation.
- **No cart and no multi-item checkout.** Several products from one Craftsman may be
  combined into **one** Product Request; products from two providers are two engagements.

---

## 10. Providing capabilities

**None.** A customer cannot publish offers, submit proposals, appear in provider search,
hold MHC or receive engagements as a provider.

To provide, the identity must enable a **PCI** (Expert or Craftsman) or create a
**Business**. Doing so does not change or replace the customer capability — it adds a second
context.

---

## 11. Communication capabilities

| Stage                     | Channel                                                                                                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before any request (D1)   | None privately with a provider. **Public offer Q&A** only, visible to all viewers of that offer, redacted and moderated.                                                                                                                                                                           |
| Pending request (D2)      | **Pre-award communication**: structured clarification Q&A **and** free-form text, plain text only, **strictly contact-redacted**, moderated, rate-limited and turn-capped. No attachments of any type, no unrestricted links, no external identifiers, no exact location, no payment instructions. |
| Activated engagement (D3) | Full threaded messaging with the counterparty, file exchange, and — where the category supports it — on-platform voice/video. Moderated, retained, and admissible as case evidence.                                                                                                                |
| After completion          | Thread stays open for the warranty/dispute window, then becomes read-only but permanently retained.                                                                                                                                                                                                |
| With the platform         | Help & Resolution cases at any time, at any tier, including while suspended.                                                                                                                                                                                                                       |

The customer can never initiate contact outside these channels, and the redaction engine
applies to customer-authored text exactly as it does to provider-authored text — a customer
pasting their own phone number into a Need body is the most common bypass vector, not a
convenience.

**Why free-form is permitted at D2 and attachments are not.** They are different risks. Text
can be masked in place: a redacted phone number conveys nothing, and the message still delivers
the clarification that lets a provider quote. A file cannot be masked in place — its payload is
the whole object, and any rendition of it that is useful enough to price from is also useful
enough to carry a letterhead, a title block, a business card on a workbench, or a van door with
a number on it. So the channel stays open and the payload stays closed.

---

## 12. File and attachment capabilities

| Placement                                  | Pre-activation visibility to provider                                                              | Post-activation |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- | --------------- |
| Attachments on a **Need**                  | **Manifest only** — file count, type, size, customer caption. No content, no preview, no download. | Full            |
| Attachments in **pre-award communication** | Not permitted at all                                                                               | n/a             |
| Attachments in **engagement messaging**    | n/a                                                                                                | Full            |
| **Requirement answers** on a purchase      | Structured attributes and text answers visible; attached files manifest-only                       | Full            |
| **Evidence** on a case                     | Visible to the counterparty and to admins per case rules                                           | —               |

**No attachment type is accessible before activation.** Images, documents, PDFs, CAD files,
drawings, spreadsheets, archives, audio and video are all manifest-only at D2. There is no
preview class, no sanitized rendition, and no per-file opt-in that would create one. A
downscaled, EXIF-stripped, watermarked, contact-scanned image is still a disclosure of the
customer's file, and none of those treatments authorizes it ([00 §5.1](./00-overview-and-terminology.md)).

**What replaces it.** A cracked wall or a broken pump is priced from the **structured intake**
the Need type defines — dimensions and units, material, symptom, age, model and make,
accessibility, floor and lift, hazards — plus **free-form descriptive text** under redaction,
plus the manifest telling the provider that four photos and a specification exist and will be
released on activation. Where a category genuinely cannot be priced that way, the honest
instruments are a **richer structured intake** for that category or a **priced survey
engagement**, not a preview.

Limits (counts, sizes, accepted MIME types, retention) are admin-configurable. Malware
scanning is mandatory on every upload regardless of tier.

---

## 13. Payment-related capabilities

- **Pays the provider directly, off-platform.** The platform never receives, holds, routes
  or refunds the money.
- Sees the provider's **payment instructions** only at D3.
- May **report a payment**: amount, currency, date, method, reference, optional proof file.
- May **confirm or reject** a provider-reported payment.
- May **dispute** a settlement record.
- Sees the engagement's agreed amount, payment plan (single / deposit + balance /
  instalments), and settlement coverage (`none`, `partial`, `full`, `over`).
- **Holds no wallet, no balance and no MHC.** There is no top-up, no withdrawal, no
  customer-side credit of any kind, and no surface that implies one.
- May record an **off-platform refund** received, subject to the same confirmation ladder.

Everything about what the platform may and may not say about these records is in
[12](./12-payment-and-settlement.md).

---

## 14. Fulfillment responsibilities

The customer is not a passive party. Wave 3 makes four obligations explicit, because each
one is a place where a provider can be harmed by inaction.

1. **Provide requirements.** Where a fulfillment type has a `pending_requirements` gate
   (made-to-order specs, intake answers, site access details), the clock does not start
   until the customer supplies them — and prolonged silence expires the engagement without
   penalty to the provider.
2. **Be available.** For scheduled types, attend the slot or reschedule within the allowed
   count. Customer no-shows are recorded on the buyer conduct signal.
3. **Confirm or object.** Accept delivery, request a revision, or raise a defect within the
   confirmation window. Silence resolves via the inactivity fallback for that type
   ([11](./11-fulfillment-models.md)).
4. **Report payment honestly.** Reported settlements are the only record either party will
   have. Deliberate false reporting is an enforcement matter.

The customer is **not** responsible for: verifying the provider's credentials, computing
tax, arranging insurance, or guaranteeing site safety — but must disclose known site
hazards and access constraints at Need creation for on-site types.

---

## 15. Review capabilities

- May review **only** as a party to a **completed** engagement (confirmed or
  auto-confirmed). One review per engagement.
- Reviews target the **provider's commercial identity**, and additionally attach to the
  specific Offer and Offer version where the engagement originated from one.
- Structure: an overall star rating, per-criterion sub-ratings appropriate to the
  fulfillment type (e.g. _quality, communication, timeliness_ for digital;
  _workmanship, punctuality, cleanliness, price accuracy_ for on-site), and free text.
- Editable **once**, within the review window; the edit is marked and history retained.
- Cannot review a **cancelled** engagement. Cancellations feed reliability metrics instead —
  this is deliberate, so a provider cannot dodge a bad review by cancelling
  ([14 §8](./14-reviews-and-reputation.md)).
- Cannot delete a published review on request; only moderation removes reviews.
- **Receives** a provider-authored buyer conduct rating: structured criteria only, no public
  free text, aggregated into a band visible to providers at D2.

---

## 16. Dispute capabilities

- May open a **Case** against an activated engagement at any point from activation until the
  dispute window closes (completion + a configurable period; extended while a case is open).
- Dispute grounds available to a customer: non-delivery, late delivery, scope shortfall,
  defective work or goods, no-show, misrepresented provider identity or credentials,
  off-platform solicitation, harassment, and disputed settlement records.
- May submit evidence: files, messages, photographs, settlement records.
- **Retains full case access while suspended** — profile suspension, commercial suspension
  and even account closure do not remove a party from a live case
  ([15](./15-suspension-and-enforcement.md)).
- Outcomes the platform can produce: findings of fact, enforcement against the provider,
  reputation consequences, MHC re-grant to a wronged provider, Need re-opening at no cost,
  and a written determination. **The platform cannot order, execute or guarantee a money
  refund**, and must never present its determination as one.
- Opening a case does not pause the customer's own obligations, and a case may not be traded
  for a review (soliciting "withdraw the review and I'll settle" is a violation by either
  party).

---

## 17. Analytics capabilities

Buyer-side only, private to the identity:

- Engagement history with status, provider, agreed amount and settlement coverage.
- Spend view: agreed vs reported vs confirmed totals, per period, per category, per provider.
  Clearly labelled as **self-reported records**, never as invoices or receipts of payment.
- Need performance: views, eligible-provider reach, proposals received, time-to-first-proposal,
  award-to-activation outcome.
- Saved-search and favourite activity.
- Own buyer conduct signal, with the inputs that produced it.

Customers do not receive provider analytics, marketplace aggregates, or any other buyer's
data.

---

## 18. Suspension behaviour

Because the customer capability is universal, suspending it is the bluntest tool in the
system and it is scoped narrowly.

| State                           | Effect on the customer                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Warning / restriction**       | Rate limits on Need creation, quote requests or messaging. Existing activity untouched.                                                                                              |
| **Buyer commercial suspension** | Cannot post Needs, request quotes, place purchase/booking/product requests, or award. Open Needs are unpublished; pending requests are withdrawn **before** any provider is charged. |
| **Profile suspension**          | Reviews authored are hidden pending review; the identity cannot appear anywhere public.                                                                                              |
| **Account closure / ban**       | No new activity of any kind.                                                                                                                                                         |

In **every** state above, the customer retains: access to existing activated engagements,
the ability to receive deliveries, confirm completion, request revisions, upload evidence,
report and confirm settlements, participate in cases, and appeal. This is the baseline rule
that commercial suspension cannot erase obligations, applied to the buyer side — a suspended
buyer who cannot confirm delivery would harm the _provider_, who did nothing wrong.

---

## 19. Actions explicitly prohibited

1. Holding, buying, earning, receiving, transferring or spending MHC.
2. Holding any platform balance, wallet or credit; requesting any withdrawal.
3. Publishing offers, submitting proposals, or appearing in provider discovery.
4. Obtaining provider contact details, the provider's exact premises address or coordinates,
   external links the provider controls, unredacted attachments, or payment instructions
   before that engagement is activated.
5. Sharing or requesting contact details, external handles, links, QR codes, or
   number-as-words in any D0/D1/D2 surface.
6. Paying the platform for an engagement, or being asked to.
7. Proposing on, awarding to, or purchasing from a commercial identity controlled by the
   same person (self-dealing).
8. Reviewing a cancelled engagement, or an intent that lapsed or never activated — the latter
   produced no engagement at all ([10 §7](./10-engagement-model.md)).
9. Conditioning a review or its removal on a settlement, discount or dispute withdrawal.
10. Bulk-harvesting provider data, scraping, or automating quote requests.
11. Posting a Need whose actual purpose is to obtain contact details rather than to buy.

---

## 20. Features deferred to Wave 4 or later

- **Organization-buying without a Business** — procurement on behalf of a team, shared
  buyer identity, colleagues visible on one engagement.
- **Delegated buying** — assistants, approvers, spend limits, purchase approval chains.
- **Multi-provider carts and basket checkout.**
- **Recurring / subscription engagements** and standing orders.
- **Saved payment relationships** (a remembered provider payment channel across engagements).
- **Buyer-side escrow substitutes of any kind**, including third-party escrow integration.
- **Public buyer profiles and buyer-to-buyer visibility.**
- **Structured RFQ tooling** — comparison matrices, weighted scoring, sealed proposals.
- **Contract templates and e-signature.**
- **Tax documents and legal invoices** issued by the platform.
- **Pre-activation attachment sharing in any form** — including previews, sanitized
  renditions, thumbnails and "safe" images. Permanently out, not deferred
  ([00 §5.1](./00-overview-and-terminology.md)).
- **Structured-only pre-award communication** as an optional per-category or
  under-enforcement mode. A possible future enhancement, and explicitly _not_ a replacement for
  the free-form channel that Wave 3 ships.
