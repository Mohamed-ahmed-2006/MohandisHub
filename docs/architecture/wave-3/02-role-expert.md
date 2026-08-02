# 02 — Expert

> Expert is one of the two shapes a **Personal Commercial Identity** can take. It is the
> knowledge-work shape: work whose value is judgement, design, analysis, supervision and
> documentation, and whose output is usually a file, a report, a drawing, a decision or an
> hour of attention.

---

## 1. Purpose

To let a verified individual sell professional and knowledge services — freelance,
consulting, engineering, review, supervision, teaching — with the two pricing shapes that
this work actually takes: **standardized packages** for repeatable scopes, and **custom
proposals** for everything else.

Expert exists as a distinct role from Craftsman because the two need genuinely different
machinery, not different labels: deliverables and revisions versus site visits and
installation; delivery days versus service areas; a portfolio versus a storefront.

---

## 2. Commercial identity

- **Personal Commercial Identity (PCI), type `expert`.** One per identity, at most.
- The legal person **is** the commercial identity. An Expert may present a professional
  display name, but it must not imply a company, an organization, a team, or plural
  personnel. Anything that does is a **Business**.
- Owns its own: public profile, offers, packages, portfolio, availability, reputation,
  reliability metrics, **MHC balance**, and enforcement state.
- Is **not** the same actor as the person's `personal_buyer` context. Purchases the person
  makes never appear on the Expert profile, and Expert reputation never applies to their
  buying.
- Cannot coexist with a Craftsman PCI on the same identity. Conversion to Craftsman is
  **permitted, and delivered in Wave 3 as an Admin/Support-executed operation**
  ([00 §3.5](./00-overview-and-terminology.md)) — an audited archival-and-replacement, never a
  settings change, never a self-service button, and never available while any unresolved
  commercial obligation exists. The Expert identity is **archived, not retyped**; its reviews
  and reputation stay with it permanently, and its **available MHC balance carries over exactly
  once** to the replacement Craftsman identity.

---

## 3. Main advantages

- **Two pricing shapes in one offer.** Publish fixed packages for the repeatable 80% and
  still take bespoke work through custom proposals, without maintaining two listings.
- **Structured revisions.** Revision count is part of the sold scope and is enforced by the
  fulfillment machinery, so "one more small change" has a defined boundary and a defined
  price (an add-on or an Amendment).
- **Requirements collected up front.** Intake questions are answered *at purchase*, so the
  clock does not start on a brief the Expert has not received.
- **Portfolio as evidence.** Verified credentials (V2) plus a curated portfolio plus verified
  settled volume give a signal that a rating alone cannot.
- **Remote-first.** No service area, no travel, no delivery logistics — an Expert is
  discoverable nationally by default.
- **Low, predictable platform cost.** A flat MHC charge per accepted engagement, never a
  percentage of the fee, and never a deduction from money the Expert receives — because the
  platform never touches that money.
- **Free proposals.** Bidding on Needs costs nothing.

---

## 4. Main limitations

- **Must pay MHC to accept work.** No credit means no acceptance, and an award can lapse
  while the Expert tops up ([13 §5](./13-mhc-activation.md)).
- **MHC is spent, not held.** It is non-refundable outside narrowly defined circumstances,
  non-transferable and non-cashable. Work that collapses after activation is a real loss.
- **No platform payment guarantee.** The Expert invoices and collects directly; if a
  customer does not pay, the platform can find facts and enforce reputation, but cannot
  produce money.
- **Cannot sell physical goods, on-site labour, delivery or installation.** Those are
  Craftsman or Business capabilities.
- **Cannot operate under an organizational identity, present a team, or have anyone else
  deliver.** Subcontracting is invisible to the platform and remains the Expert's own
  liability.
- **One PCI.** No second Expert identity for a second niche; categories exist for that.
- **Cannot buy under the Expert identity.** Buying happens in `personal_buyer` context.

---

## 5. Registration and activation

**Enablement path** (all steps are on the identity, which already has customer capability):

1. Choose to become a personal provider → choose **Expert** (exclusive, and the choice is
   presented with its consequences, including that Craftsman is not available afterwards).
2. Complete **V1 (KYC)**: government ID, liveness match, name reconciliation.
3. Complete the Expert profile minimum: headline, bio, at least one category, working
   language(s), timezone, and either one published package-bearing offer or one quote-only
   offer.
4. Optionally complete **V2** — mandatory if any chosen category is flagged
   `credential_required`.
5. Accept the provider terms, which state plainly: the platform holds no money, guarantees
   no payment, and charges MHC to accept work.
6. → **Provider Enablement granted.** Offers become publishable; proposals become
   submittable.

**Engagement Activation** is separate and per-engagement: see
[13](./13-mhc-activation.md). An enabled Expert with zero MHC is enabled but cannot accept.

**Ordering rule:** enablement must not be granted before V1 is *approved*, not merely
submitted. A pending KYC yields a `pending_verification` state where the Expert can build
drafts but publish nothing.

---

## 6. Verification requirements

| Requirement                         | Status                                                           |
| ----------------------------------- | ------------------------------------------------------------------ |
| V0 contact verification             | Mandatory (inherited from customer capability)                    |
| **V1 identity (KYC)**               | **Mandatory** before enablement                                   |
| V2 professional credential          | Mandatory per credential-required category; optional badge elsewhere |
| Sanctions / duplicate-identity check| Mandatory at V1; one PCI per verified natural person              |
| Re-verification                     | On document expiry, on ownership/name change, on enforcement flag |

Additional rules:

- **One verified natural person → one PCI.** Two accounts resolving to the same ID document
  is a duplicate-identity enforcement case, not two Experts.
- V2 credentials carry **issuer, reference number, scope and expiry**, and the badge shows
  the scope — an Expert credentialed for structural review must not read as credentialed
  for electrical sign-off.
- Verification tier and credential scope are **snapshotted onto every engagement** at
  activation.
- A lapsed V2 in a credential-required category **hides** the affected offers and blocks new
  proposals in that category; it does not touch existing engagements.

---

## 7. Profile capabilities

| Element                                                       | Tier |
| ------------------------------------------------------------- | ---- |
| Display name, avatar, headline, categories, languages         | D0   |
| Rating, review count, completed engagements, verification tier and credential badges | D0 |
| Verified settled volume band, response time, on-time rate     | D0   |
| Coarse location and timezone                                  | D0   |
| Bio, experience, education, skills, certifications            | D1   |
| **Portfolio**: cases with title, scope, category, media, outcome; optional client name with recorded consent | D1 |
| Availability: accepting/paused, working hours, lead time, concurrent-work cap | D1 |
| Published offers and packages with prices                     | D0   |
| Full legal name, phone, email, address, payment instructions  | **D3** |

Portfolio rules that matter:

- Portfolio media is **moderated for contact leakage** exactly like every other surface —
  a drawing title block containing a phone number is the classic bypass.
- Client names and logos require **recorded consent**, and consent is auditable.
- Portfolio items may optionally be **linked to a completed platform engagement**, which
  earns a "verified on MohandisHub" marker. Unlinked items are permitted but unmarked. This
  distinction is the honest version of a portfolio and should not be blurred.

---

## 8. Search and discovery capabilities

**Being discovered:** appears in offer search, provider search, category browse and
recommendations, filtered by category, price, delivery time, rating, verification tier,
credential, language and availability. Remote-capable by default, so not geo-restricted.

**Discovering work:**

- **Opportunity feed** of open Needs filtered to eligible types (`professional_service`,
  `consultation`) and the Expert's categories, with saved filters and new-Need alerts.
- Sees each Need at **D2**: brief, structured requirement attributes, budget mode, timeline,
  coarse location, attachment **manifest only**, proposal count, buyer conduct band.
- Never sees: buyer contact, exact address, attachment contents, other providers' proposal
  amounts, or the buyer's identity beyond display name.
- **Cannot see or propose on** Needs whose type is Craftsman-only, needs outside its
  eligible categories, or Needs from a related identity.

**Buying:** searching as a customer happens in `personal_buyer` context and is a separate
surface, deliberately, so the Expert always knows which hat is on.

---

## 9. Buying capabilities

The person behind an Expert PCI is a full customer in `personal_buyer` context and may do
everything in [01](./01-role-customer.md). The Expert identity itself buys nothing.

Two hard consequences:

- An Expert's purchases, Needs and buyer conduct never appear on the Expert profile or in
  Expert analytics.
- The self-dealing boundary applies: the person cannot buy from their own Expert identity,
  nor from a Business they own.

---

## 10. Providing capabilities

| Capability                  | Wave 3                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Publish offers              | ✅ `expert_service` only                                                                                   |
| Packages                    | ✅ 0–3 tiers per offer, optional; see [07](./07-expert-packages.md)                                        |
| Add-ons                     | ✅ priced, optional, with delivery-day deltas                                                              |
| Requirements intake         | ✅ structured questions answered at purchase                                                               |
| Quote-only offers           | ✅ an offer may carry no package and take custom proposals only                                            |
| Custom proposals            | ✅ against a Need, or against a buyer Quote Request                                                        |
| Proposals on Needs          | ✅ free, quota-limited, types `professional_service` and `consultation`                                    |
| Availability and bookings   | ✅ consultation/session slots                                                                              |
| Digital deliverables        | ✅ with revisions, per the sold scope                                                                      |
| Physical products           | ❌                                                                                                          |
| On-site / workshop service  | ❌                                                                                                          |
| Delivery, pickup, installation | ❌                                                                                                        |
| Staff or delegated delivery | ❌ Wave 4                                                                                                   |

Fulfillment types an Expert may attach to an engagement:
**digital delivery**, **consultation/session**, and their combination. Nothing else.

### 10.1 Applying to recruitment Jobs

Separately from providing, an Expert may **apply as a candidate** to a Business's job vacancy
in the **Jobs** recruitment module ([00 §10](./00-overview-and-terminology.md)).

- The Expert applies **through their active Personal Commercial Identity**.
- **A job application is recruitment candidacy, not a Proposal.** It creates no Proposal row,
  no pre-activation intent object and no Engagement, and it consumes no proposal quota.
- **Applying and being hired cost no MHC.** Hiring is not an Engagement Activation.
- **Recruitment outcomes do not alter the Expert's service reputation.** A rejection, a
  withdrawal or a failed interview changes no rating, no reliability metric and no ranking
  signal ([14 §12](./14-reviews-and-reputation.md)).
- **Being hired is an employment outcome.** Any resulting salary is outside the platform's
  settlement model entirely ([12 §12A.5](./12-payment-and-settlement.md)).

---

## 11. Communication capabilities

- **D1:** may answer **public offer Q&A** on its own offers — visible to all viewers, redacted
  and moderated. Cannot initiate private contact with a buyer who has not engaged.
- **D2:** **pre-award communication** on a pending proposal, purchase request, booking request
  or quote request — structured clarification **and** free-form text, plain text only,
  strictly contact-redacted, moderated, turn-capped. No attachments of any type, no
  unrestricted links, no exact location, no payment instructions.
- **D3:** full messaging with file exchange, and on-platform voice/video for consultations.
  Session records from on-platform calls become fulfillment evidence automatically.
- **Never:** unsolicited outreach, bulk messaging, marketing broadcasts, or contact with a
  buyer outside an engagement thread.
- With the platform: cases at any time, including while suspended.

Every message is retained, moderated and admissible as case evidence. Redaction applies to
the Expert's own text with the same force as the customer's — an Expert appending a phone
number to a proposal is the single most likely bypass in this product.

---

## 12. File and attachment capabilities

| Surface                              | Rule                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| Portfolio media                      | Public at D1, moderated, contact-scanned, consent-recorded                               |
| Offer / package media                | Public at D0, moderated, no contact, no external links                                   |
| Proposal attachments                 | **Not permitted.** A proposal is text and numbers only                                   |
| Custom proposal attachments          | **Not permitted** pre-acceptance; the scope must be expressible in structured fields     |
| Pre-award communication              | **No attachments of any type**                                                           |
| Need attachments received            | **Manifest only** at D2 — no content, no preview, no rendition; full access at D3        |
| **Deliverables**                     | Full upload at D3, versioned per revision round, retained for the dispute window and beyond |
| External delivery links              | Permitted at D3 only, recorded, and never a substitute for evidence — an unreachable link is not a delivery |
| Case evidence                        | Permitted per case rules, even while suspended                                           |

Deliverable retention is a product commitment, not a storage detail: the files that prove
what was delivered must outlive the engagement, the offer and the dispute window, because
they are the only record of performance either side has.

---

## 13. Payment-related capabilities

- **Sets and displays payment instructions at D3 only** — bank/InstaPay/wallet handle,
  account name, and accepted methods. These are **the Expert's own** instructions; the
  platform relays them and disclaims them.
- Defines the **payment plan** as part of the sold or proposed terms: single payment,
  deposit + balance, or N instalments, each with an amount and a trigger (on activation, on
  milestone, on delivery, on acceptance).
- May **report** payments received and **confirm or reject** customer-reported payments.
- May attach **payment proof**; proof is evidence and never self-verifies.
- Sees settlement coverage per engagement and verified settled volume in analytics.
- **Holds MHC** in a balance owned by the Expert PCI: purchases it, spends it on activation,
  sees its ledger. MHC is **not money**: it cannot be withdrawn, transferred to another
  identity, converted, gifted or refunded to cash under any circumstance.
- **Holds no cash balance, no earnings wallet, and no withdrawal surface.** No screen may
  imply the platform owes the Expert anything.

---

## 14. Fulfillment responsibilities

1. **Accept or decline promptly.** An unanswered award or purchase request lapses and
   damages the reliability metrics; declining is neutral, silence is not.
2. **Start on the received brief.** Where requirements are unanswered, use the
   `pending_requirements` state rather than starting and disputing scope later.
3. **Deliver against the snapshot, not the conversation.** The engagement's scope snapshot
   is what is owed; anything else needs an Amendment.
4. **Submit evidence with every delivery.** Files, or a recorded external link plus a
   written delivery statement.
5. **Honour the sold revision count**, and route further changes to a priced add-on or an
   Amendment rather than absorbing or refusing them informally.
6. **Attend booked sessions** or reschedule within the allowed count.
7. **Report and confirm settlements honestly.** Verified settled volume is the Expert's most
   valuable long-term asset and the basis of any future GMV-based commercial model.
8. **Never route the customer off-platform** for payment before activation, or for the work
   itself at any time.

---

## 15. Review capabilities

- **Receives** customer reviews on completed engagements, attached to the Expert PCI and,
  where applicable, to the specific offer and package version.
- **May respond once** per review, publicly, within the response window; the response is
  editable once, moderated, and may not contain contact details, links or accusations that
  the case record does not support.
- **May report** a review for moderation (contact leakage, PII, off-topic, extortion,
  competitor abuse). Reporting never silently removes it.
- **May not** buy, solicit, incentivize, trade or condition reviews, nor make a settlement
  or dispute withdrawal contingent on one.
- **Writes** a structured buyer conduct rating on completed engagements — no public free
  text, aggregated to a band.
- **Reputation is bound to the PCI.** It does not transfer to a Business the person later
  creates, does not merge with their buyer conduct signal, and **does not carry across a PCI
  conversion** — on conversion to Craftsman, every review stays permanently attached to the
  archived Expert identity and the replacement starts at zero
  ([00 §3.5](./00-overview-and-terminology.md), [14 §10](./14-reviews-and-reputation.md)).

---

## 16. Dispute capabilities

- May open a case against an activated engagement: non-payment, disputed settlement,
  customer non-cooperation, out-of-scope demands, abusive conduct, fraudulent Need,
  contact-harvesting, or off-platform solicitation by the customer.
- May respond to cases opened against it, submit evidence, and appeal outcomes once.
- **Retains complete case and evidence access under both commercial and profile
  suspension** — this is an invariant, not a courtesy.
- May request **MHC re-grant** where the circumstances match the narrow list in
  [13 §9](./13-mhc-activation.md). Re-grant is credit, never cash, and is at admin
  discretion within a bounded, audited allowance.
- Understands the platform's honest limit: it can determine facts, enforce, and adjust
  reputation and credit; it cannot compel payment.

---

## 17. Analytics capabilities

Scoped to the Expert PCI only.

| Group          | Metrics                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Demand         | Offer views, package-level views, quote requests, conversion by package, saved/favourited counts, search impressions       |
| Proposals      | Submitted, quota remaining, win rate, time-to-first-response, award-to-activation rate, lapse rate                        |
| Engagements    | Active, by state, by fulfillment type, on-time delivery rate, revision rate, cancellation rate (by cause), completion rate |
| Settlement     | Agreed vs reported vs **confirmed** vs **verified** volume, coverage distribution, average days-to-confirmation           |
| MHC            | Balance, spend by action key, effective MHC cost per engagement and per confirmed settled unit, re-grants received        |
| Reputation     | Rating trend, per-criterion breakdown, review volume, response rate, reliability metrics with their inputs                |

Presentation rules that are product requirements, not UI preferences:

- Reported-but-unconfirmed amounts must **never** be presented as earnings, revenue or GMV.
  Three separate figures, three separate labels.
- Verified settled volume is the only figure that may be used in badges, tier calculations
  or any future GMV-based commercial model.
- No competitor-level data, no other provider's figures, no buyer identities in aggregates.

---

## 18. Suspension behaviour

| Axis                      | Effect on the Expert                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Restriction**           | Reduced proposal quota, publication of new offers paused, or messaging rate-limited. Existing activity untouched.                                                        |
| **Commercial suspension** | All offers hidden from D0/D1; no new proposals, quote replies, purchase acceptances, bookings or activations; MHC purchase blocked; MHC balance frozen but **not** forfeited. |
| **Profile suspension**    | Public Expert profile and all offers removed from discovery and from direct links; reviews authored are hidden pending review.                                          |
| **Termination**           | Only after open engagements are completed, cancelled with customer remedy, or administratively closed with a written determination.                                      |

Under **every** state above the Expert keeps: existing engagement access, delivery and
evidence upload, revision handling, engagement messaging, settlement reporting and
confirmation, case participation and appeal, and read access to its own history and
analytics. A suspended Expert that cannot deliver would convert a provider penalty into a
customer penalty, which the baseline forbids.

---

## 19. Actions explicitly prohibited

1. Holding a Craftsman PCI, publishing craftsman offers, or selling physical goods,
   on-site labour, delivery or installation.
2. Presenting as a company, team, agency or organization under a personal identity.
3. Obtaining or transmitting contact details, exact addresses, external links, handles or
   payment instructions at D0/D1/D2 — including inside portfolio media, offer text,
   proposal text, display names and file names.
4. Attaching files to proposals, custom proposals or pre-activation Q&A.
5. Accepting any engagement without a successful MHC charge.
6. Soliciting the customer to cancel and re-transact off-platform, at any stage.
7. Requesting or accepting payment routed through MohandisHub, or implying the platform
   holds, guarantees or will refund funds.
8. Transferring, selling, gifting or cashing out MHC.
9. Publishing portfolio work not performed by the Expert, or client names without consent.
10. Buying from, proposing to, or reviewing a related commercial identity.
11. Claiming a credential scope beyond the verified V2 record.
12. Editing a published package to alter the terms of an engagement already sold.
13. Soliciting, trading or conditioning reviews.
14. Delegating delivery to another platform identity as if it were the Expert's own work
    (Wave 4 introduces the legitimate mechanism; until then this is misrepresentation).

---

## 20. Features deferred to Wave 4 or later

- **Teams and delegation:** associates, sub-experts, assigning delivery to another person,
  shared calendars, capacity pooling.
- **Workspace-owned assets:** portfolio, offers, templates or reputation owned by an entity
  rather than the person.
- **Milestone-structured engagements** with per-milestone acceptance and evidence.
- **Retainers, subscriptions and recurring engagements.**
- **Paid proposal promotion, featured placement, advertisements** — explicitly unapproved,
  not merely unbuilt ([16 group 3](./16-wave-3-scope.md)).
- **Multi-currency pricing and FX presentation.**
- **Platform-issued contracts, NDAs, e-signature, and legal invoicing.**
- **Time tracking, hourly billing meters, and work-in-progress reporting.**
- **Automated deliverable licensing / IP transfer records.**
- **Any escrow, milestone hold, or platform-mediated payment**, in this or any later wave,
  unless the money model itself changes.
