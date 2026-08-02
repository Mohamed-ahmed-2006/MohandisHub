# A — Customer Need Model

> A **Need** is a buyer-authored statement of demand, published to eligible providers, that
> converts into an Engagement when the buyer awards a Proposal and the awarded provider pays
> to accept it.

The Need is the demand-side half of the marketplace. Its design is dominated by one
constraint: **providers spend real credit to accept an award**, so a Need must carry enough
information to price without carrying anything that would let a provider bypass the gate.

---

## 1. Need types

Six types. The type is chosen at creation, is immutable after the first proposal, and drives
eligibility, required fields and the default fulfillment shape.

| Type                   | What it is                                                              | Eligible providers   | Default fulfillment                       |
| ---------------------- | ------------------------------------------------------------------------ | -------------------- | ------------------------------------------ |
| `professional_service` | Knowledge work with a deliverable: design, analysis, review, drawings   | Expert, Business     | Digital delivery                          |
| `consultation`         | Time-boxed attention: advice, diagnosis, remote or on-site session      | Expert, Business (+ Craftsman for paid site surveys) | Consultation/session |
| `local_service`        | Labour at a place: repair, installation, maintenance, fabrication on site | Craftsman, Business | On-site or workshop service               |
| `product_supply`       | An existing physical item to be bought                                  | Craftsman, Business  | Physical product + delivery or pickup     |
| `custom_product`       | A physical item to be made to specification                             | Craftsman, Business  | Made-to-order + delivery or pickup        |
| `product_plus_service` | An item supplied **and** fitted, commissioned or installed              | Craftsman, Business  | Hybrid product + service                  |

Rules:

- **Type → eligible provider kind is a product rule**, not configuration. Category → type
  mapping *is* admin-configurable, so a new category can be routed to the right type without
  a release.
- Business is eligible for **every** type. That is the point of the organizational identity.
- Craftsman eligibility for `consultation` is limited to categories flagged as
  survey-capable; it exists so a paid site survey can precede a quote, not so Craftsmen can
  sell advice.
- A Need whose type does not match its content is a moderation matter; the type cannot be
  changed once a proposal exists, because proposals were priced against it.

---

## 2. Visibility

Two orthogonal axes: **who may see it** and **how much of it they see**. Do not collapse them.

### 2.1 Audience

| Mode              | Audience                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `open`            | Every eligible, enabled, unsuspended provider whose categories and (for local types) service areas match |
| `open_verified`   | As `open`, further restricted to providers at or above a buyer-chosen verification tier (V1/V2/V3b)   |
| `directed`        | One named provider only. Nobody else sees it, and it produces at most one proposal                   |

- `directed` is the Need equivalent of a quote request against a provider rather than an
  offer. It is not a private auction and cannot be re-broadcast; converting a directed Need
  to `open` republishes it as a new Need with no proposals carried over.
- Buyers may **exclude** specific providers (blocked or previously disputed).
- Guests never see Needs at all. The demand side is signed-in only — an open Need index is
  the easiest possible scrape target for contact harvesting.

### 2.2 Depth (fixed, not buyer-chosen)

| Field group                                                                | Eligible provider | Any other signed-in identity |
| -------------------------------------------------------------------------- | ----------------- | ---------------------------- |
| Title, type, category, brief, **structured requirement attributes**, timeline, budget mode, coarse location, proposal count, buyer conduct band | **Visible (D2)** | Not visible |
| Attachment **manifest** — count, MIME type, size, caption                  | Visible (D2)      | Not visible                  |
| Buyer display name                                                         | Visible (D2)      | Not visible                  |
| Buyer full name, phone, email, exact address, **attachment contents of every type** | **D3 only** | Never                        |
| Other providers' proposals, amounts, counts of who viewed                  | Never             | Never                        |

Proposal amounts are **never** visible to competing providers. Wave 3 runs sealed proposals
by construction, not as a feature.

---

## 3. Proposal eligibility

A provider may submit a Proposal only when **every** condition holds:

1. The commercial identity is **enabled** (V1 for a PCI, V3b KYB-approved for a BCI).
2. Its kind is eligible for the Need's **type**.
3. Its categories intersect the Need's category.
4. For local types, its **service areas cover** the Need's coarse location.
5. Where the category is `credential_required`, it holds a **valid V2** with matching scope.
6. It is not commercially suspended and not restricted from proposing.
7. The Need is in state `open` (not `award_pending`, `engaged`, `cancelled` or `expired`).
8. The identity is **not related** to the buyer (self-dealing boundary).
9. It has **proposal quota remaining** for the period.
10. It has not already proposed on this Need (one live proposal per identity; editable and
    withdrawable, not duplicable).
11. For `open_verified`, it meets the required tier.
12. For `directed`, it is the named provider.

**Proposals are free.** Paid bidding, proposal boosts, promoted proposals and pay-to-see-Need
are all unapproved and must not be implemented ([16 group 3](./16-wave-3-scope.md)). Quota is
the only scarcity mechanism, and its size is admin-configurable per identity type and
verification tier.

**Proposal content** is structured: price, currency, payment plan shape, scope statement,
inclusions/exclusions, delivery time or proposed dates, revision count where applicable,
travel/delivery/installation line items where applicable, validity period, and a cover note.
**No attachments, no links, no contact details** — and the cover note passes through
redaction like every other free-text field.

A proposal may be **withdrawn** before award, and **edits** create a new version visible to
the buyer with an "updated" marker.

---

## 4. Budget modes

| Mode                | Buyer supplies              | Shown to providers                     | Binding?  |
| ------------------- | --------------------------- | -------------------------------------- | --------- |
| `fixed`             | One amount                  | "Budget: X"                            | No        |
| `range`             | Min and max                 | "Budget: X–Y"                          | No        |
| `open_to_proposals` | Nothing                     | "Budget: open"                         | n/a       |
| `hidden`            | An amount, kept private     | "Budget: not disclosed"                | No        |

Rules that must be enforced, not merely displayed:

- **No budget mode is binding.** The engagement's agreed amount comes from the **accepted
  proposal**, never from the Need. A proposal above or below the stated budget is permitted
  and is flagged to the buyer, not blocked — an out-of-budget proposal is often the honest
  one.
- `hidden` still records the amount, so analytics can measure realism (stated vs awarded)
  without exposing it. It must never be leaked through filtering, sorting or ranking
  side channels.
- Currency is single-currency per Need in Wave 3, and the proposal must match it.
- The budget is **not** a payment commitment. The platform holds nothing; the number is a
  scoping signal.

---

## 5. Location rules

Every Need carries a **location precision model**, chosen by its type.

| Precision  | Required for                                    | Public at D2                     | Released at D3   |
| ---------- | ----------------------------------------------- | -------------------------------- | ---------------- |
| `remote`   | `professional_service`, remote `consultation`   | Nothing                          | Nothing          |
| `area`     | Optional on remote types                        | Governorate + city/district      | —                |
| `exact`    | **Mandatory** for `local_service`, `product_plus_service`, on-site `consultation`, and any delivery/installation fulfillment | Governorate + city/district only | Full address, geolocation, access notes, floor, landmark |

Hard rules:

- **Exact location is D3. Always.** No exception for "the provider needs it to quote", no
  exception for map pins, no exception for distance calculators that reveal a radius small
  enough to identify an address.
- Coarse granularity must be **fine enough to price travel** — city or district, not
  governorate alone — because otherwise Craftsmen either overprice or refuse.
- **Travel and delivery pricing is provider-declared per area**
  ([08 §5](./08-craftsman-storefront.md)), so a provider prices from its own table against
  the coarse unit rather than needing the address.
- Buyers may reuse **saved locations**; selecting one publishes only its coarse part.
- Site hazards, access constraints and parking/lift availability are structured fields
  visible at D2 in generic form ("no lift, 4th floor") and in full at D3. These affect price
  and refusing to surface them at D2 produces cancellations.

---

## 6. Attachments

**One rule, no exceptions: no transaction attachment is accessible before activation.**

| Attachment class     | Allowed on a Need                | Provider access at D2                     | At D3    |
| -------------------- | -------------------------------- | ----------------------------------------- | -------- |
| Images               | Yes                              | **Manifest only**                         | Full     |
| Documents, PDFs, spreadsheets, drawings, CAD | Yes              | **Manifest only**                         | Full     |
| Archives             | Yes                              | **Manifest only**                         | Full     |
| Video / audio        | Yes, within limits               | **Manifest only**                         | Full     |
| Executables, scripts | No                               | —                                         | —        |

The **manifest** exposes: file count, MIME type, size, and a buyer-written caption per file.
That is enough for a provider to know a Need has three photos and a PDF specification, and
not enough to extract anything.

**There is no preview class.** No sanitized rendition, no downscaled thumbnail, no watermarked
copy, no per-file buyer opt-in that would create one. Explicitly:

- **Watermarking, EXIF stripping, downscaling, OCR screening, contact scanning, or a
  determination that a particular image is "safe" do not authorize pre-activation access.**
  They are hygiene applied to a disclosure that is not permitted to occur.
- The rule covers images, documents, PDFs, CAD files, archives, drawings, audio, video and
  every other uploaded medium, without distinction between them.
- No route around it exists: not a message request, not a caption long enough to be a
  transcription, not an admin tool, not a support action.

**What carries the pricing signal instead.** Where an image used to be the brief, the brief is
now typed:

| Instrument                        | What it carries                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Structured requirement attributes** | Per-type, per-category typed fields: measurements with units, material, finish, quantity, symptom, model and make, age, condition, tolerances, floor, lift access, power, clearance, declared hazards |
| **Free-form brief text**          | The buyer's own description, at D2, under strict contact redaction                                |
| **Attachment manifest**           | Proof that four photos and a specification exist and are released on activation                   |
| **Travel-fee bands by area**      | Lets a Craftsman price distance from their own table without the address ([08 §6](./08-craftsman-storefront.md)) |
| **`survey_required` / priced site survey** | The honest, paid instrument for work that genuinely cannot be priced remotely ([08 §2](./08-craftsman-storefront.md)) |

Where a category's structured intake is too thin to price from, the remedy is **to enrich that
category's intake fields** — an admin-configurable, per-category exercise — not to reintroduce
a preview. A thin intake is a content problem with a content fix.

The trade-off is accepted deliberately. A watermarked thumbnail is a smaller disclosure than a
full file, but it is still the customer's file, and the images that make a Need priceable are
the same images that carry a street sign, a door number, a business card on a workbench or a
van with a phone number on it. The gate cannot be defended with an exception whose whole
purpose is to be informative.

Malware scanning is mandatory on upload regardless of tier. Counts, sizes and MIME
allowlists are admin-configurable.

---

## 7. Award flow

```
open
 └─ buyer selects one proposal
      → AWARD OFFER issued to that provider   (Need → award_pending)
        · no MHC charged yet
        · no D3 disclosure yet
        · Need closed to new proposals; other proposals remain live, not rejected
        · activation deadline starts
           ├─ provider ACCEPTS  → MHC charge attempted
           │     ├─ charge succeeds → ENGAGEMENT created, D3 opens, Need → engaged
           │     └─ charge fails    → award offer stays open until deadline; provider prompted to top up
           ├─ provider DECLINES → award offer closed, Need → open, buyer may award another
           ├─ buyer REVOKES     → award offer closed, no charge, Need → open
           └─ DEADLINE PASSES   → award offer lapses, no charge, Need → open, provider reliability recorded
```

Rules:

- **Award is not acceptance.** The buyer's award is an offer to the provider; the
  arrangement exists only after activation. Every surface must say so, because "I awarded
  it, why hasn't it started" is the predictable support case.
- **The charge, the engagement creation and the D3 disclosure are one atomic step.** If any
  part fails, none of it happened. A charge without disclosure is a refundable fault
  ([13 §9](./13-mhc-activation.md)).
- **The buyer is never told why acceptance is pending.** Insufficient credit is the
  provider's private financial state; the buyer sees a neutral pending state and a deadline.
- Only **one** award offer is live at a time. Awarding a second provider requires revoking
  the first.
- **Non-awarded proposals are not auto-rejected** at award time — only when the Need reaches
  `engaged`, so that a lapse can fall back cleanly.
- Losing providers are notified when the Need closes, with the outcome and no counterparty
  detail.
- The **activation deadline** is admin-configurable per origin, and for bookings is capped by
  the slot start minus a buffer ([13 §7](./13-mhc-activation.md)).

---

## 8. Cancellation and expiry

### 8.1 Need states

`draft` → `open` → `award_pending` → `engaged` → `closed`
with `cancelled` and `expired` reachable from `open` and `award_pending`.

| State           | Proposals accepted | Visible to providers | Buyer may cancel | Notes                                                             |
| --------------- | ------------------ | -------------------- | ---------------- | ------------------------------------------------------------------ |
| `draft`         | —                  | No                   | n/a (delete)     | Not published, not indexed                                        |
| `open`          | Yes                | Yes (D2)             | Yes, free        | The normal state                                                  |
| `award_pending` | No                 | Yes, marked awarded  | Yes, free        | One live award offer; no charge yet                                |
| `engaged`       | No                 | No                   | **No**           | An Engagement exists; cancellation is an engagement action        |
| `closed`        | No                 | No                   | —                | Engagement completed or terminally closed                          |
| `cancelled`     | No                 | No                   | —                | Buyer-initiated before activation                                  |
| `expired`       | No                 | No                   | —                | Open window elapsed with no award                                  |

### 8.2 Cancellation

- **Before award:** free, immediate, no notification beyond "this Need was withdrawn" to
  providers who proposed.
- **During `award_pending`, before activation:** free. The awarded provider is notified with
  a neutral reason. **No MHC is charged**, because no charge has occurred.
- **After activation:** the Need cannot be cancelled. The Engagement can be, under
  [10 §10](./10-engagement-model.md), and the provider's MHC is already spent.
- **Repeated late cancellation** (cancelling during `award_pending` more than a configured
  number of times in a window) is an abuse signal: it wastes provider attention and is a
  known contact-harvesting pattern. It feeds the buyer conduct signal and triggers
  restriction, not silent tolerance.
- A cancelled Need may be **re-posted**, but re-posting is a new Need with no proposals; the
  system detects near-duplicate re-posting and flags serial re-posters.

### 8.3 Expiry

- Every `open` Need has an expiry, defaulting to an admin-configured window and buyer-
  adjustable within bounds.
- Reminders fire before expiry; the buyer may **extend** a bounded number of times.
- Expiry with zero proposals is a distinct outcome from expiry with unactioned proposals, and
  is reported to the buyer with guidance (widen area, adjust budget, add detail) — this is
  the main lever against a demand side that thinks the marketplace is empty.
- `award_pending` has its own, much shorter clock: the activation deadline. Its expiry
  returns the Need to `open` and extends the Need's own expiry by the time it spent waiting,
  so a provider's inaction never costs the buyer their window.
- Expired Needs are retained, searchable by the buyer, and re-postable in one action.

---

## 9. Anti-abuse obligations specific to Needs

Collected here because the Need is the cheapest object in the system to create and therefore
the most attacked.

- **Contact redaction** on title, brief, captions, structured attribute answers, and every
  pre-award message — structured and free-form alike — including number-as-words, spaced
  digits, homoglyphs, and external handles.
- **Caption and filename scanning**, since with previews gone these are the remaining
  attachment-adjacent text surfaces a buyer controls.
- **Duplicate and near-duplicate detection** across a buyer's Needs and across the platform.
- **Rate limits** on creation, per identity and per period, tightened for V0-only buyers.
- **Award-to-activation ratio monitoring** per buyer and per buyer-provider pair — a pair
  that repeatedly awards and lets it lapse is the signature of an off-platform handshake.
- **Fake-Need enforcement**: a Need created to harvest contact details is a terminating
  offence and is grounds for MHC re-grant to any provider charged on it.
- Honest framing: none of this is a guarantee. It raises cost; it does not build a wall
  (carried forward from `KNOWN_LIMITATIONS.md` L1.3).
