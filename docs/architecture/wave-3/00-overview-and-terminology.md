# 00 — Overview, Identity Model and Terminology

---

## 1. The approved baseline (restated, not reopened)

These are inputs to the architecture, not outputs of it. Nothing in this document set may
contradict them.

1. Every user has customer capability.
2. A personal provider is **either** an Expert **or** a Craftsman, never both under the same
   personal commercial identity.
3. Business is a **separate organizational** commercial identity.
4. Business may buy and provide.
5. Expert serves freelance, consulting, engineering, professional and knowledge-service work.
6. Expert supports service packages, custom proposals, portfolio, availability, digital
   deliverables and revisions.
7. Craftsman serves local services, shops, workshops, physical products, custom products,
   bookings, service areas, delivery and installation.
8. Workspace-owned assets, business members, delegated authority, branches, staff assignment
   and granular permissions are **Wave 4**.
9. Customer-to-provider payment is **direct and off-platform**.
10. MohandisHub does **not** hold customer money.
11. There is **no** escrow, withdrawal system, provider cash balance or platform-managed
    refund mechanism.
12. MHC is **non-transferable, closed-loop, provider-side** platform credit.
13. Paid bidding is **not** approved.
14. **Commercial activation is the main anti-bypass revenue gate.**
15. Contact information, exact locations, unrestricted communication, attachments and
    authoritative payment instructions are protected until activation.
16. Providers require KYC. Businesses require KYB plus owner/controller verification **to
    provide**. Ordinary Business *buying* runs on graduated verification — owner KYC plus
    basic organization verification — see §4.1.
17. Payment proof is **evidence**, not final settlement confirmation.
18. Settlement may be reported, counterparty-confirmed, verified, disputed or rejected.
19. Only **confirmed or verified** settled values count toward verified GMV.
20. A future verified-GMV commercial model uses **tiered monthly MHC rent**, not an uncapped
    revenue percentage.
21. Commercial suspension must not prevent completion of existing obligations or disputes.

---

## 2. The word "activation" is overloaded — disambiguate it permanently

The codebase and the baseline both use "activation" for two unrelated things. Wave 3 gives
them separate names and they must never be conflated again.

| Term                       | Level      | Meaning                                                                                          | Costs MHC |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------ | --------- |
| **Provider Enablement**    | Identity   | A commercial identity has passed verification and may publish offers and submit proposals.       | No        |
| **Engagement Activation**  | Engagement | A provider accepts one specific arrangement; protected information unlocks for that arrangement. | **Yes**   |

Wherever this document set says "activation" without a qualifier, it means **Engagement
Activation**. Enablement is always written out in full.

---

## 3. Identity model

### 3.1 The three layers

```
IDENTITY  (one authenticated person — one login, one KYC subject)
│
├── Customer capability            always on, cannot be removed, no verification tier beyond contact
│
├── Personal Commercial Identity   optional, at most ONE, typed  expert XOR craftsman
│   (PCI)                          carries its own profile, offers, reputation, MHC balance
│
└── Business Commercial Identities optional, zero or more, each a separate organizational entity
    (BCI)                          carries its own profile, offers, reputation, MHC balance
                                   Wave 3: an identity may only act for a BCI it OWNS
```

An identity is a **person**. A commercial identity is a **market participant**. Reputation,
verification, credit and enforcement all attach to commercial identities — never to the
person across all of them.

### 3.2 Why the PCI is exclusive

The baseline forbids one person holding both Expert and Craftsman under a single personal
commercial identity, and Wave 3 enforces the stronger reading: **an identity holds at most
one PCI, period.** A person cannot hold an Expert PCI and a Craftsman PCI side by side.

The reason is not tidiness. Expert and Craftsman have different verification requirements,
different fulfillment machinery, different discovery surfaces and different buyer
expectations. Two personal identities under one person would produce one reputation that
customers read as one person's competence while the platform treats it as two — the exact
reputation-mixing the baseline prohibits. A person who genuinely does both is a **Business**,
which is what the organizational identity is for.

Changing PCI type after the fact is a lifecycle question, not a configuration toggle. It is
**permitted, through the controlled conversion process in §3.5** — never as a settings change
and never as a mutation of the existing identity.

### 3.3 Acting Context

Every commercial write executes in **exactly one** acting context, resolved server-side and
never inferred from the shape of the payload.

| Context kind        | Exists when                        | Buys | Provides | Reputation carrier         |
| ------------------- | ---------------------------------- | ---- | -------- | -------------------------- |
| `personal_buyer`    | Always (universal customer)        | ✅   | ❌       | Buyer conduct signal       |
| `personal_provider` | A PCI exists and is enabled        | ❌   | ✅       | Expert **or** Craftsman    |
| `business:<id>`     | A BCI exists and caller owns it    | ✅   | ✅       | Business (provider rating) |

Consequences that engineering must be able to test:

- A person's purchases never appear on their Expert or Craftsman profile.
- A person's Expert work never appears in their buyer history as supply.
- A business is the only context where buying and providing share one commercial identity —
  and even there they are two **surfaces**, kept separate by the rules in
  [09](./09-business-buying-and-providing.md).
- The context is part of every commercial record's snapshot. It is not recomputed later.

### 3.4 Self-dealing boundary

Two commercial identities are **related** if the same identity controls both. Related
identities may not transact with each other: a PCI may not propose on a need posted by its
own person's `personal_buyer` context or by a business that person owns, and a business may
not propose on its own need.

This is not a fairness rule — it is an MHC-integrity rule. Without it, an operator could
manufacture verified GMV and reputation by transacting with themself, at the cost of MHC
they paid themself.

### 3.5 Personal Commercial Identity conversion (Expert ⇄ Craftsman)

**Conversion is permitted.** An identity whose PCI is Expert may become a Craftsman, and the
reverse, through a controlled, audited process. Trades and careers change; the alternative —
telling a real person to abandon an account and register again — produces duplicate identities
and a worse data model than the one it avoids.

Conversion is a **lifecycle event with archival**, never a type toggle. The old PCI is
preserved intact; a new PCI of the other type is created beside it at zero reputation.

**Preconditions — conversion is forbidden while any of these exist on the current PCI:**

| Blocker                                                                      |
| ---------------------------------------------------------------------------- |
| An **active** engagement in any live state                                    |
| A **pending-activation** arrangement (award offer, purchase, booking, product or custom request) |
| An **incomplete** engagement — anything not `completed`, `cancelled` or `lapsed` |
| A **disputed** engagement, or any open Case in either direction                |
| An open appeal, or an unexpired enforcement action under review               |

The provider clears these by completing, cancelling or resolving them. There is no
administrative override that converts around a live obligation, because conversion would
strand a counterparty mid-engagement.

**What happens to the old PCI:**

- It is **archived**, not mutated and not deleted. Its record, its type and its history are
  frozen as they stood.
- Its offers are archived; it publishes nothing and proposes on nothing.
- **Historical reviews and reputation remain permanently attached to the archived PCI** and
  remain readable on the archived profile. Reviews are never moved, re-pointed, re-aggregated
  or merged into the replacement.
- Its completed engagements, evidence, settlement records and case history stay bound to it.

**What does and does not carry to the replacement PCI:**

| Item                                                                | Carries? |
| ------------------------------------------------------------------- | -------- |
| Reputation — rating, review count, distribution, reliability metrics | **No**   |
| Offers, packages, products, variants, storefront                     | **No**   |
| Portfolio and work gallery                                           | **No**   |
| Provider analytics and historical series                             | **No**   |
| Verified settled volume / verified-GMV attribution                   | **No**   |
| Account-level **KYC evidence** (V1 identity documents)               | **Yes, where still valid** — it is evidence about the *person*, and re-collecting an unexpired government ID proves nothing new |
| **MHC balance**                                                      | **Yes** — see the note below |
| Role-specific onboarding, eligibility and verification               | **No — must be completed again** |

**Role-specific verification is redone in full.** The replacement PCI is not enabled until its
own onboarding is complete: the new type's profile or storefront minimum, its category
eligibility, and **V2 credential verification for every credential-required category of the new
trade**. An Expert's structural-review credential does not enable a Craftsman's gas
certification, and the reverse. Enablement follows the ordinary path in
[02 §5](./02-role-expert.md) / [03 §5](./03-role-craftsman.md).

**MHC balance.** The balance stays on the identity's single PCI slot and is available to the
replacement. This is **not** a transfer between commercial identities and does not weaken
non-transferability: it is the same natural person, the same one-per-identity slot, and no
second identity gains spendable credit. Nothing else about the conversion moves value.

**Governance:**

- Every conversion is an **administratively reviewed** request with a recorded decision,
  rationale and actor, and the full before/after state is retained in the audit record.
- An **admin-configurable cooldown** applies before another conversion may be requested. The
  cooldown's length is configuration; its existence is product.
- The archived PCI is never reactivated. Converting back creates a further archival and a
  further new identity — it does not resurrect the first.
- Reputation isolation is absolute across the boundary: no aggregate, badge, ranking signal,
  cold-start prior, search facet or "previously traded as" display may connect an archived PCI
  to its replacement in any market-facing surface ([14 §10](./14-reviews-and-reputation.md)).
  Administrators can see the relation; the market cannot.

---

## 4. Verification tiers

| Tier   | Name                | Evidence                                                                   | Unlocks                                                              |
| ------ | ------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **V0** | Contact-verified    | Verified email **and** verified phone                                      | Customer capability: browse, post needs, purchase, message post-gate |
| **V1** | Identity-verified   | Government ID + liveness/selfie match + name reconciliation (KYC)          | PCI enablement (Expert or Craftsman): publish offers, propose        |
| **V2** | Credential-verified | Professional syndicate membership, licence, or trade certificate           | Categories flagged `credential_required`; a public badge elsewhere   |
| **V3a**| Business-basic      | Verified business email **and** business phone, organization identity (legal name + registration reference recorded and format/registry-checked), **plus V1 on the owner/controller** | BCI **buying** enablement — ordinary procurement |
| **V3b**| Business-verified (KYB) | V3a **plus** commercial registration document, tax card and premises evidence, admin-approved | BCI **selling** enablement, and everything in §4.1 |

Rules:

- V1 is a prerequisite for V3a and therefore for V3b. A business is never verified without a
  verified human behind it — this is the "owner/controller verification" the baseline requires.
- **V3a is not a weaker KYB; it is a different question.** V3b asks *is this a real registered
  company fit to sell*. V3a asks *is there a verified person behind a real organization,
  reachable and accountable, fit to buy*.
- V2 is **category-gated, admin-configurable**. Some engineering categories (structural
  sign-off, electrical, gas, lifting) must be flagged credential-required; others must not
  be. Whether a specific category requires it is an admin setting, not a product decision.
- Verification **expires**. Documents with expiry dates drive re-verification prompts, and a
  lapsed tier degrades enablement rather than deleting history: offers are hidden, existing
  engagements continue.
- Verification state is **snapshotted onto every engagement** at activation. A provider who
  later loses V2 does not retroactively change what a past customer was told.

### 4.1 Graduated Business verification — what each stage unlocks

Full KYB is **not** required merely to participate in the market as a buyer. Requiring it there
imposes a multi-day dead period at the moment an organization is most motivated, and pushes
owners to buy through their personal identity instead — which defeats the separation the
Business identity exists to provide.

| Activity                                                                  | Requires |
| ------------------------------------------------------------------------- | -------- |
| Browse, search, save, follow                                              | V3a      |
| Post a Need, request proposals, send quote requests                       | V3a      |
| Place purchase, booking and product requests; award; ordinary buying      | V3a      |
| Receive D3 disclosure as the **buyer** counterparty; report and confirm settlements; review suppliers | V3a |
| **Publishing commercial offers or products**                              | **V3b**  |
| **Submitting provider proposals or custom proposals**                     | **V3b**  |
| **Providing** — accepting any arrangement as the provider party           | **V3b**  |
| **Earning Business reputation** — receiving provider reviews              | **V3b**  |
| **Receiving provider payment disclosures** — publishing payment instructions as a provider | **V3b** |
| **Accumulating provider verified GMV**                                    | **V3b**  |

- The owner must hold **approved V1 before acting through the Business at all**, in either
  direction. This is the accountability anchor: a fake Business's Needs cost providers real
  MHC on activation, so the platform must have a verified person to enforce against.
- **Administrators may configure higher verification requirements** for high-risk or
  high-value procurement — by category, by declared budget, by cumulative period volume, or by
  risk flag — requiring V3b, or a per-period cap on procurement engagements, before demand of
  that shape may be created. The thresholds are configuration; the ability to impose them is
  product.
- A Business at V3a is visibly and honestly labelled to providers as organization-verified
  rather than KYB-verified. Providers price counterparty risk with accurate information.

---

## 5. Disclosure tiers — the product's central mechanic

Disclosure is what MohandisHub sells. It is modelled explicitly as four tiers, and every
field in the system is assigned to exactly one.

| Tier   | Audience                                                                    | Visible                                                                                                                                                                  |
| ------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D0** | Anyone, including signed-out                                                | Display name, avatar/logo, headline, categories, coarse location (governorate/city), ratings and counts, published offers and their prices, badges                       |
| **D1** | Signed-in identities                                                        | Full public profile, portfolio, availability calendar, response-time stats, the ability to place a proposal / purchase request / quote request                           |
| **D2** | A counterparty with a **pending, unactivated** arrangement                   | Pre-award communication — structured Q&A **and** contact-masked free-form text; coarse location; attachment **manifest** (count, type, size, caption) with **no content of any kind**; structured requirement attributes; indicative budget |
| **D3** | A counterparty on an **activated engagement**                                | Full legal/contact details of both parties, exact address and geolocation, all attachments, unrestricted (moderated) messaging with file exchange, **payment instructions** |

Hard rules:

- Nothing in D3 may leak into D0, D1 or D2 by any route, including profile free-text,
  offer descriptions, need bodies, review text, provider responses, file names, image
  content, portfolio items, or display names.
- D3 is reached **only** by a successful Engagement Activation. There is no other door.
- D3, once reached, persists for the parties to that engagement. The provider paid for it.
- Contact redaction is **defence in depth, not a wall** — this is inherent and must be said
  in-product, not hidden (carried forward from `KNOWN_LIMITATIONS.md` L1.3).

### 5.1 The two D2 rules that carry the most weight

**Rule 1 — no transaction attachment content before activation, of any type.**

No transaction-specific attachment is accessible below D3. This covers **images, documents,
PDFs, CAD files, drawings, archives, spreadsheets, audio, video and every other uploaded
medium**, without exception and without a bounded case.

Watermarking, EXIF stripping, downscaling, resolution limits, OCR screening, contact scanning,
or a determination that a particular image is "safe" **do not authorize pre-activation
access**. They are quality controls on a disclosure that is not permitted to happen. A
sanitized rendition of a protected file is still the protected file.

What a provider gets instead, and what is enough to price:

- The **manifest** — count, MIME type, size and the buyer's caption per file.
- **Structured attributes** — the typed requirement fields the Need or offer intake defines:
  measurements with units, materials, quantities, symptoms, dimensions, model and make,
  condition, access constraints, site hazards. These carry the pricing signal that an image was
  previously being used to smuggle.
- **Free-form descriptive text**, under contact redaction.

Where a category genuinely cannot be priced from those, the answer is a **richer structured
intake for that category** or a **priced survey engagement** ([08 §2](./08-craftsman-storefront.md)),
not a preview.

Public **portfolio and storefront media** are a different object entirely: they are the
provider's own published listing media, not a counterparty's transaction attachments. They
remain visible at D0/D1 under moderation and the anti-contact rules, and nothing in this rule
restricts them.

**Rule 2 — pre-award communication exists, and is contact-masked rather than removed.**

Buyer and provider may communicate before activation. The channel carries **structured
clarification and free-form text**, and every character of it passes through contact redaction
and anti-bypass moderation.

| At D2                                          | Status                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| Structured clarification Q&A                   | ✅ Available                                                      |
| Free-form message text                         | ✅ Available, **strictly redacted**, moderated, rate-limited      |
| Contact information — phone, email, handles, QR | ❌ Blocked and redacted, including evasion forms                  |
| Payment instructions or account details        | ❌ Blocked                                                        |
| Unrestricted links                             | ❌ Blocked                                                        |
| Exact location or anything that identifies an address | ❌ Blocked                                                 |
| Transaction attachments of any type            | ❌ Blocked (Rule 1)                                               |

The trade-off is deliberate and was decided on its merits: too little communication and
providers cannot price, so both parties leave to talk elsewhere and the gate loses the
transaction entirely; too much unmoderated channel and the channel *becomes* the bypass.
Masking is the position that keeps the conversation on-platform while denying it the payload.

**Structured-only communication is not the model.** A future optional enhancement may offer a
structured-only mode for specific categories or for identities under enforcement, but it must
be introduced as exactly that — an option — and must not replace pre-award free-form
communication.

---

## 6. The core nouns

| Noun                       | Definition                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Need**                   | A buyer-authored statement of demand, open to proposals from eligible providers.                                               |
| **Offer**                  | A provider-authored, published unit of supply. Four kinds; see [06](./06-offer-model.md).                                      |
| **Package**                | A named, priced, scoped tier within an Expert service offer.                                                                   |
| **Proposal**               | A provider's bid against a Need. Free in Wave 3.                                                                               |
| **Quote Request**          | A buyer-initiated, structured request for bespoke terms against an Offer or a provider.                                        |
| **Custom Proposal**        | A provider-authored bespoke set of terms, offered to one named buyer.                                                          |
| **Purchase Request**       | A buyer's commitment to an Offer's published terms, pending provider acceptance.                                               |
| **Award Offer**            | A buyer's selection of one Proposal, pending provider acceptance.                                                              |
| **Engagement Activation**  | The provider's acceptance, charged in MHC, that converts a pending arrangement into an Engagement and opens D3.                |
| **Engagement**             | The single record of an accepted commercial arrangement. Carries immutable snapshots.                                          |
| **Fulfillment Component**  | One typed unit of work or handover inside an Engagement. An Engagement has one or more.                                        |
| **Amendment**              | A mutually accepted, append-only change to an Engagement's agreed terms. Never rewrites the original.                          |
| **Settlement Record**      | A reported money event (payment, deposit, instalment, refund) attached to an Engagement, carrying an evidence state.           |
| **Settlement Tranche**     | A settlement record that has reached a **counted** state — `counterparty_confirmed` or `admin_verified`. Tranches are the only input to verified GMV. |
| **Verified GMV**           | The sum of settlement **tranches**, net of confirmed refunds, attributed to a provider commercial identity over a closed period. Nothing else. |
| **Verified-GMV Rent**      | A tiered monthly MHC charge derived from a closed period's verified GMV. **Shadow mode in Wave 3**: calculated and recorded, never deducted. |
| **Archived PCI**           | A Personal Commercial Identity retired by a conversion (§3.5). Retains its reviews and history permanently; publishes nothing. |
| **MHC**                    | Non-transferable, non-cashable, closed-loop provider-side credit. Held per commercial identity.                                |
| **Case**                   | A dispute, report or appeal in the Help & Resolution Center. Survives suspension.                                              |
| **Reliability metrics**    | Non-review behavioural signals: response rate, activation rate, cancellation rate, on-time rate, no-show rate.                 |

---

## 7. Legacy concept mapping

Wave 3 does not invent a parallel vocabulary for things that already exist. This mapping is
conceptual; the migration design is out of scope here.

| Wave 1/2 concept                                     | Wave 3 concept                                        | Note                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `needs`                                              | **Need**                                              | Gains typing, visibility modes, buyer-context ownership                           |
| `bids`                                               | **Proposal**                                          | Stays free; paid/promoted proposals remain unapproved                             |
| `services`                                           | **Offer** (kind `expert_service` / `craftsman_service`) | Splits by provider kind; gains packages and variants                              |
| `reservations`                                       | **Engagement** with origin `booking`                  | Settlement/hold semantics removed entirely                                        |
| `jobs`, milestone escrow                             | **Engagement** with components; escrow retired        | `ESCROW_AND_DISPUTES.md` is obsolete for Wave 3                                   |
| `users.primary_role`                                 | Identity + PCI type + acting context                  | Role-string authorization is replaced by context authorization                    |
| `business_teams`, `business_members`                 | **Team administration, retained and available**       | `business_teams.business_id` **is** the BCI — the immutable commercial and billing principal. `manage_team` stays enforced; the six reserved permissions stay disabled. Delegated commercial authority is Wave 4. See [09 §4](./09-business-buying-and-providing.md) |
| Workspace selection (Wave 2G/2H)                     | **Team-administration scope only**                    | It does not set an application-wide commercial acting context and must not be extended to do so in Wave 3 |
| `support_tickets` / unified cases (Wave 2I)          | **Case**                                              | Becomes the single dispute, appeal and settlement-escalation surface              |
| `mhc_action_prices`                                  | Activation price table, keyed per engagement origin   | Shape confirmed in [13](./13-mhc-activation.md); values stay admin-configurable   |

---

## 8. Actors outside the four roles

Named here only so the four role definitions do not have to keep gesturing at them.

- **Guest** — signed-out. Sees D0 only. Cannot post, propose, purchase or message.
- **Administrator** — platform staff with granular permissions. Performs verification
  decisions, moderation, settlement verification, dispute resolution and enforcement.
  Never a party to an engagement, never a payment intermediary, and cannot alter an
  engagement's commercial snapshots.
- **System** — automated actors: redaction, expiry, auto-confirmation, reminders,
  reliability metric computation. Every system action is attributed and auditable, and no
  system action may create disclosure or charge MHC without an explicit human trigger.

---

## 9. Inherited security correction — pre-activation conversation disclosure

Recorded here because it concerns the disclosure gate, which is the core mechanic of this
document set, and because Wave 3's D2 rules are built on the assumption that the pre-activation
surface leaks nothing.

**The issue was real and is confirmed.** A Wave 2 defect exposed `other_email` on the
conversation-list response. A counterparty's email address is D3 data by
[§5](#5-disclosure-tiers--the-products-central-mechanic); serving it on a pre-activation
conversation list disclosed protected contact information without a committed activation and
without an MHC charge. Historical locked previews carried the same exposure.

**It is fixed.** Commit `bc1681b5cee9f772402bc5ba8a5599e161da871d` — *fix(chat): close
pre-activation conversation disclosure*:

- **removes `other_email`** from the conversation-list response entirely;
- **prevents email fallback** — no code path substitutes an email address where a display name
  is missing, on any surface;
- introduces an **allowlisted conversation-summary contract** (`ConversationSummary` and
  `CONVERSATION_SUMMARY_FIELDS` in `packages/shared/src/chat.ts`) so the response is a closed
  set of permitted fields rather than a repository row filtered by convention — repository rows
  legitimately carry participant data used for authorization decisions, and only the allowlist
  may cross the API boundary;
- **re-redacts locked historical previews**, so the exposure is closed for conversations that
  already existed and not only for new ones.

**Architectural status: not an unresolved Wave 3 blocker**, from the moment the fix is
published. It is a shipped correction, not an open question.

**What remains a standing requirement.** The following are permanent security invariants of
this architecture, not one-off regression fixes ([17 §3](./17-product-invariants.md),
INV-101 to INV-103):

1. **Conversation-list regression tests** proving no D3 field — email, phone, external handle,
   exact address, payment instruction — appears on any pre-activation conversation-list
   response, and that the response conforms to the allowlisted contract.
2. **Historical-preview regression tests** proving locked previews stay redacted for
   conversations created before the fix as well as after it.
3. The allowlist discipline itself: the pre-activation conversation surface serializes from an
   explicit permitted-field contract, and adding a field to it is a disclosure decision
   requiring the tier assignment in [§5](#5-disclosure-tiers--the-products-central-mechanic).
