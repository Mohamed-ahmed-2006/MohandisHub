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

**Conversion is permitted, and Wave 3 supports it operationally — through an Admin/Support
controlled workflow only.** An identity whose PCI is Expert may become a Craftsman, and the
reverse. Trades and careers change; the alternative — telling a real person to abandon an
account and register again — produces duplicate identities and a worse data model than the one
it avoids.

Conversion is a **lifecycle event with archival**, never a type toggle. The source PCI is
preserved intact and archived; a **replacement PCI** of the other type is created beside it at
zero reputation. **The source identity's commercial type is never mutated in place.**

### 3.5.1 Who may execute it — Admin/Support only

Wave 3 delivers conversion as an **operator-executed operation**, not a user-executed one.

| In Wave 3                                                        | Not in Wave 3                                         |
| ---------------------------------------------------------------- | ----------------------------------------------------- |
| Conversion-safe data and domain architecture                     | A user-facing "Switch to Expert / Switch to Craftsman" button |
| PCI archival                                                     | Self-service conversion                               |
| Replacement PCI creation                                         | Automatic conversion approval                         |
| Eligibility validation                                           | Repeated user-controlled switching                    |
| Blocking validation for active obligations (§3.5.2)              | A general MHC transfer interface                      |
| **Audited MHC carryover** (§3.5.4)                               |                                                       |
| **Admin/Support authorization** on every conversion              |                                                       |
| A recorded **conversion reason**                                 |                                                       |
| **Immutable conversion audit history**                           |                                                       |
| Appropriate notifications to the user                            |                                                       |
| **Safe rollback or failure behaviour before final commit**       |                                                       |
| **Idempotency protection**                                       |                                                       |

A user may *request* a conversion. Only an authorized Admin/Support actor may *execute* one,
and the execution records who authorized it and why. This is deliberate: conversion moves
credit, archives a commercial identity and resets a reputation, and each of those is a decision
that deserves a named human behind it before self-service is considered.

### 3.5.2 Preconditions — conversion is rejected while any unresolved obligation exists

| Blocker                                                                                        |
| ---------------------------------------------------------------------------------------------- |
| **Pending provider activation** — any pre-activation intent object awaiting the provider's charged acceptance ([10 §7](./10-engagement-model.md)) |
| An **active engagement** in any live state                                                     |
| **Any non-final MHC state** — the full blocking list is in §3.5.6a                             |
| **Incomplete fulfillment** — any required component not confirmed or auto-confirmed            |
| **Pending customer confirmation** — a component in `awaiting_customer_confirmation`             |
| An **open correction request** — a revision round, rectification or objection in progress      |
| An **open dispute or resolution case**, in either direction                                    |
| An **unresolved settlement issue** — a disputed record, or an open settlement escalation       |
| An **active commercial suspension investigation** where conversion could evade enforcement     |
| Any **other unresolved commercial obligation** defined by the engagement lifecycle             |

The provider clears these by completing, cancelling or resolving them. **There is no
administrative override that converts around a live obligation** — not by Admin, not by Support,
not by a determination. Converting around one would strand a counterparty mid-engagement.

### 3.5.3 What happens to the source PCI

- It is **archived** — never mutated, never retyped, never deleted. Its record, its type and its
  history are frozen as they stood.
- It **remains available** for historical engagement, review, dispute, settlement, audit and
  administrative views. Archival is a change of capability, not of visibility.
- It **cannot**: publish new offers, submit proposals, accept bookings, activate engagements,
  spend MHC, or acquire new commercial work of any kind.
- **Existing historical records continue to reference the archived PCI.** Nothing is re-pointed
  at the replacement.
- **Historical reviews and reputation remain permanently attached to the archived PCI** and
  remain readable on the archived profile. Reviews are never moved, re-pointed, re-aggregated
  or merged into the replacement.
- Its completed engagements, evidence, settlement records, case history and **MHC ledger
  history** stay bound to it.
- The archived PCI and the replacement PCI are **linked by an audited conversion record**
  (§3.5.4). That link is administrative; it is never surfaced to the market.

### 3.5.4 Conversion must not become an escape route

Conversion is **prohibited as a means of evading**: commercial suspension, disputes, poor
reputation, settlement review, verified-GMV obligations, rent obligations, or any platform
enforcement action.

This is what §3.5.2's blocker list and the Admin/Support gate exist to enforce, and it is why
reputation cannot carry: a conversion that both cleared a bad record and preserved standing
would be a reputation reset with extra steps.

### 3.5.5 What does and does not carry to the replacement PCI

| Item                                                                 | Carries? |
| -------------------------------------------------------------------- | -------- |
| Reviews                                                              | **No**   |
| Reputation, ratings, distributions, reliability metrics              | **No**   |
| Offers and services                                                  | **No**   |
| Products                                                             | **No**   |
| Portfolio and work gallery                                           | **No**   |
| Provider analytics and historical series                             | **No**   |
| Search ranking and any ranking signal derived from the source        | **No**   |
| Fulfillment history                                                  | **No**   |
| Commercial verification specific to the provider type (V2 scope, trade credentials) | **No** |
| Verified settled volume / verified-GMV attribution                   | **No**   |
| Role-specific onboarding and eligibility                             | **No — completed again in full** |
| **Available MHC balance**                                            | **Yes — exactly once, by the audited operation in §3.5.6** |
| Account-level **identity evidence** (V1 KYC documents)               | **Yes, only where still valid and applicable** — it is evidence about the *person*, and re-collecting an unexpired government ID proves nothing new |

**Role-specific verification is redone in full.** The replacement PCI is not enabled until its
own onboarding is complete: the new type's profile or storefront minimum, its category
eligibility, and **V2 credential verification for every credential-required category of the new
trade**. An Expert's structural-review credential does not enable a Craftsman's gas
certification, and the reverse. Enablement follows the ordinary path in
[02 §5](./02-role-expert.md) / [03 §5](./03-role-craftsman.md).

The replacement PCI starts with a **new provider profile and new provider-type-specific
commercial history**. It is not a continuation of the source presented under a different label.

### 3.5.6 MHC carryover

**The remaining available MHC balance carries over to the replacement PCI.** It is neither
forfeited nor permanently frozen — a provider who converts does not lose credit they paid for.

**This is a special audited system conversion operation, not a transfer feature.**

| Property                              | Rule                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Not user-accessible**               | No user, provider or Business owner can invoke it. It exists only inside an Admin/Support-executed conversion |
| **Not a general capability**          | It must not enable transfers between arbitrary personal identities, between Business identities, between users, or between any two commercial identities that are not a conversion source and its replacement |
| **Source ends at zero**               | The archived PCI finishes with a **zero available MHC balance**                                            |
| **Replacement receives exactly**      | The replacement PCI receives **exactly the archived PCI's remaining available balance** — no more, no less  |
| **Conservation**                      | **No MHC is created, destroyed, duplicated, or left spendable by both identities**                          |
| **Atomic**                            | The carryover, the archival and the replacement creation commit together or not at all                     |
| **Idempotent**                        | Re-running or double-submitting a conversion produces **exactly one** carryover                             |
| **Ledger history preserved**          | Nothing in the source's ledger is deleted, rewritten or re-pointed                                          |
| **Historical attribution unchanged**  | **Historical MHC transactions remain attributable to the archived PCI** — its spend history is its own      |

**Only the remaining *available* balance carries, and the rule is deterministic and fails
closed.** Credits that are pending, reserved, disputed, reversed or otherwise not available are
**never silently treated as available balance**, and they are never partially carried.

### 3.5.6a Non-available MHC blocks conversion

**Conversion is blocked while the source PCI has any non-final MHC state.** This is a
precondition, not a reconciliation step performed during the conversion.

| Blocking non-final MHC state          |
| ------------------------------------- |
| Pending MHC purchase                  |
| Pending credit approval               |
| Reserved MHC                          |
| Held MHC                              |
| Pending action charge                 |
| Disputed action charge                |
| Pending refund                        |
| Pending reversal                      |
| Unresolved chargeback                 |
| In-flight idempotent ledger operation |
| Unreconciled balance discrepancy      |
| Any other non-final MHC state         |

**Every one of these must reach a final ledger outcome before conversion may execute.** There
is no "settle it during the conversion" path, no operator override, and no partial carryover of
a balance that is still moving. A conversion that cannot determine the available balance
unambiguously **does not proceed**.

**Final treatment, once the blockers are clear:**

| Rule                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ |
| The **available balance transfers exactly once**                                                            |
| **Pending, reserved, held and disputed balances do not transfer** — they blocked the conversion until resolved |
| **Reversed, refunded, expired, cancelled and failed ledger entries remain immutable historical records.** They are history, and history never becomes available carryover |
| **Historical ledger entries remain attributed to the archived PCI**                                         |
| After success: **source available balance equals zero**                                                     |
| After success: **the source PCI cannot spend**                                                              |
| After success: **the replacement receives exactly the source's final available balance**                     |
| **Atomic conservation holds** — no credit created, no credit destroyed, no duplicated spendable balance      |
| **Retry and concurrency remain idempotent** — one carryover, one credit, regardless of retries or concurrent requests |

The rule applied to each category is recorded on the immutable conversion record, so a reader
can see not only what moved but why nothing else did.

**The conversion audit record must identify:**

| Field                                    |
| ---------------------------------------- |
| Source PCI                               |
| Replacement PCI                          |
| User / account owner                     |
| Amount moved                             |
| Original ledger balance                  |
| Conversion event                         |
| Administrator or Support actor           |
| Timestamp                                |
| Reason                                   |

The audit record is **immutable** and is the link between the archived and replacement
identities.

**Why this does not weaken non-transferability.** MHC remains non-transferable between
commercial identities as an ordinary capability ([13 §1](./13-mhc-activation.md)). This is a
single, narrowly scoped, operator-executed lifecycle operation on **one natural person's one PCI
slot**, in which the source is emptied in the same transaction that the replacement is funded.
No second identity ever gains spendable credit, no balance is ever pooled, and there is no
surface through which a user could invoke it. Treating it as a transfer feature — or building
anything reusable out of it — is prohibited.

### 3.5.7 Governance

- Every conversion carries an **Admin/Support authorization**, a recorded **reason**, a decision
  and an actor, and the full before/after state is retained in the immutable audit record.
- An **admin-configurable cooldown** may apply before another conversion is executed. **Cooldown
  configuration does not create self-service conversion** — the workflow remains
  Admin/Support-controlled regardless of how the cooldown is set, including when it is set to
  zero.
- **Failure is safe.** Any validation failure, any unresolved obligation, and any inability to
  resolve the available balance aborts the conversion **before final commit**, leaving the
  source PCI untouched, enabled and in possession of its balance.
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
| **D0** | Anyone, including signed-out                                                | Display name, avatar/logo, headline, categories, **coarse location only** (governorate/city/district, coarse service zone, approximate map area), ratings and counts, published offers and their prices, badges, platform-hosted moderated media |
| **D1** | Signed-in identities                                                        | Full public profile, portfolio, availability calendar, response-time stats, the ability to place a proposal / purchase request / quote request                           |
| **D2** | A counterparty with a **pending, unactivated** arrangement                   | Pre-award communication — structured Q&A **and** contact-masked free-form text; coarse location; attachment **manifest** (count, type, size, caption) with **no content of any kind**; structured requirement attributes; indicative budget |
| **D3** | A counterparty on an **activated engagement**                                | Full legal/contact details of both parties, **exact address and geolocation of both parties — including a Craftsman's workshop and a Business's premises**, **every external link a commercial identity controls**, all attachments, unrestricted (moderated) messaging with file exchange, **payment instructions** |

**Two protections the readiness audit made explicit**, because both were previously softened by
an exception:

1. **Exact location is D3 in both directions.** The buyer's exact address and the provider's
   exact premises — workshop address, building number, floor/unit, exact map pin, GPS
   coordinates, a map link exposing the premises, or directions sufficient to locate it
   exactly — are the same class of data and unlock at the same moment. **There is no walk-in
   address exception, for any role or operating model**
   ([08 §1.1](./08-craftsman-storefront.md)).
2. **External links are D3.** A website, external company site, Facebook, LinkedIn, Twitter/X,
   Instagram, WhatsApp, Telegram, an external booking page, an external contact form, an
   external marketplace profile, or **any unrestricted navigable URL a commercial identity
   controls**, is a direct off-platform contact channel and is protected data
   ([04 §7.1](./04-role-business.md)).

Hard rules:

- Nothing in D3 may leak into D0, D1 or D2 by any route, including profile free-text,
  offer descriptions, need bodies, review text, provider responses, file names, image
  content, portfolio items, display names, **structured profile URL fields**, or **map,
  radius and geolocation representations**.
- **Public profile responses serialize from an explicit allowlist**, never from a repository
  row filtered by convention. A field's presence in a public DTO is a disclosure decision
  requiring a tier assignment under this section (§11, INV-103).
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
| Unrestricted links, external handles, external profile URLs | ❌ Blocked                           |
| Exact location of **either** party, or anything that identifies an address or premises | ❌ Blocked |
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
| **Commercial Intent Object** | The origin-specific pre-activation object — need award offer, accepted service purchase intent, booking request/accepted booking intent, product request, custom order intent. It is **not** an Engagement, carries no engagement state and opens no D3 ([10 §7](./10-engagement-model.md)). |
| **Engagement Activation**  | The provider's acceptance, charged in MHC, that **creates** the Engagement from its origin intent and opens D3, in one transaction committing exactly once. |
| **Engagement**             | The single record of an **activated** commercial arrangement. Carries immutable snapshots. **It does not exist before activation.** |
| **Fulfillment Component**  | One typed unit of work or handover inside an Engagement. An Engagement has one or more.                                        |
| **Amendment**              | A mutually accepted, append-only change to an Engagement's agreed terms. Never rewrites the original.                          |
| **Settlement Record**      | A reported money event (payment, deposit, instalment, refund) attached to an Engagement, carrying an evidence state.           |
| **Settlement Tranche**     | A settlement record that has reached a **counted** state — `counterparty_confirmed` or `admin_verified`. Tranches are the only input to verified GMV. |
| **Verified GMV**           | The sum of settlement **tranches**, net of confirmed refunds, attributed to a provider commercial identity over a closed period. Nothing else. |
| **Verified-GMV Rent**      | A tiered monthly MHC charge derived from a closed period's verified GMV. **Shadow mode in Wave 3**: calculated and recorded, never deducted. |
| **Archived PCI**           | The source Personal Commercial Identity retired by a conversion (§3.5). Retains its reviews, history and MHC ledger permanently; publishes nothing, proposes on nothing, spends nothing. |
| **Replacement PCI**        | The new-typed PCI created by a conversion. Starts at zero reputation with a new provider profile; receives exactly the archived PCI's available MHC balance. |
| **PCI conversion**         | The Admin/Support-executed lifecycle operation that archives a source PCI and creates a replacement of the other type (§3.5). Never a mutation of the source's type. |
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
| `jobs`, `job_applications`, job milestones/escrow    | **Not mapped.** Remains the **recruitment subsystem** | **Jobs are not Needs, Offers, Proposals, Bookings, Product Orders, Custom Orders or Engagements.** No job or job application is migrated into the Engagement spine; historical Jobs data keeps its recruitment semantics. Legacy job money flows stay disabled and read-only. See §10 |
| `users.primary_role`                                 | Identity + PCI type + acting context                  | Role-string authorization is replaced by context authorization                    |
| `business_teams`, `business_members`                 | **Team administration, retained and available**       | `business_teams.business_id` references **`users.id`** — a **legacy Business-account surrogate**, *not* a BCI. Wave 3 adds an **additive BCI spine** with deterministic mapping ([09 §4.4](./09-business-buying-and-providing.md)). `manage_team` stays enforced; the six reserved permissions stay disabled. Delegated commercial authority is Wave 4 |
| `business_profiles.user_id`                          | Compatibility anchor for the BCI mapping              | Also references `users.id`. A distinct BCI entity does not yet exist; assets are user-owned and are re-associated non-destructively ([09 §4.4](./09-business-buying-and-providing.md)) |
| Workspace selection (Wave 2G/2H)                     | **Team-administration scope only**                    | It does not set an application-wide commercial acting context and must not be extended to do so in Wave 3 |
| `support_tickets` / unified cases (Wave 2I)          | **Case**                                              | Becomes the single dispute, appeal and settlement-escalation surface              |
| `mhc_action_prices`                                  | Activation price table, keyed per engagement origin   | Shape confirmed in [13](./13-mhc-activation.md); values stay admin-configurable   |

---

## 8. Actors outside the four roles

Named here only so the four role definitions do not have to keep gesturing at them.

- **Guest** — signed-out. Sees D0 only. Cannot post, propose, purchase or message.
- **Administrator / Support** — platform staff with granular permissions. Performs verification
  decisions, moderation, settlement verification, dispute resolution, enforcement, and — in
  Wave 3 — **execution of PCI conversion** (§3.5), which is the one lifecycle operation that
  moves MHC and archives a commercial identity.

  Never a party to an engagement, never a payment intermediary, and cannot alter an
  engagement's commercial snapshots. The conversion authority is deliberately narrow: an
  operator may **execute a conversion that already passed every eligibility check**, and may
  not override a blocker, convert around a live obligation, choose a carryover amount, or use
  conversion to resolve an enforcement matter.
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

---

## 10. Jobs / recruitment — a separate subsystem, not part of the Wave 3 spine

The existing MohandisHub **Jobs** module is a **recruitment / employment marketplace**, in the
shape of Wuzzuf. It is not a service marketplace, and Wave 3's transactional models do not
apply to it. This section is the authority; the role- and spine-level consequences are in
[04 §10.1](./04-role-business.md), [09 §8](./09-business-buying-and-providing.md) and
[10 §15](./10-engagement-model.md).

### 10.1 The model

A **Business publishes a job vacancy**, which may carry employment-oriented details: job title,
description, required skills, experience, employment type, location or remote status, salary
range where applicable, and an application deadline. **Experts and Craftsmen may apply as
candidates.** The Business may review applications, shortlist, reject, schedule interviews,
accept or hire a candidate, and close the vacancy.

**A job application is recruitment candidacy, not a commercial service proposal. Hiring is an
employment/recruitment outcome, not activation of a service Engagement.**

Therefore, and without exception:

| #  | Rule                                                                                        |
| -- | -------------------------------------------------------------------------------------------- |
| 1  | Jobs are **not** Customer Needs                                                             |
| 2  | Jobs are **not** provider Offers                                                            |
| 3  | Job applications are **not** marketplace Proposals                                          |
| 4  | Jobs are **not** Bookings                                                                   |
| 5  | Jobs are **not** Product Orders                                                             |
| 6  | Jobs are **not** Custom Orders                                                              |
| 7  | **Jobs and job applications must not be migrated into the Wave 3 transactional Engagement spine** |
| 8  | **Historical Jobs data preserves its original recruitment semantics**                       |
| 9  | The recruitment module remains a **separately supported legacy/product subsystem** during Wave 3 |
| 10 | Its **long-term redesign may be considered separately after Wave 3**                        |

**A terminology note.** Elsewhere in this document set the word *job* sometimes appears in its
ordinary trade sense — "workshop jobs", "daily job cap", "job value". That colloquial usage
means **a piece of work**, and it always refers to an Engagement or a fulfillment component.
**Capital-J Jobs — the module, the vacancy, the application — is what this section governs**,
and the two never mean the same thing.

### 10.2 Wave 3 recruitment authority and boundaries

| Rule                                                                                                         |
| ------------------------------------------------------------------------------------------------------------- |
| **Only the verified Business owner** may create, edit, publish, manage, close or hire through Business Jobs   |
| **Business team members receive no delegated recruitment authority**                                          |
| The existing **`manage_jobs` team permission remains reserved and non-authoritative until Wave 4**            |
| **Experts and Craftsmen apply through their active Personal Commercial Identity**                             |
| **Candidate reputation as a service provider must not be automatically altered by recruitment application outcomes** |
| **Job hiring records must not count as provider verified GMV**                                                |
| **Recruitment salary or compensation must not be processed through the Wave 3 service settlement model**      |
| **Recruitment reviews, if retained, remain distinct from transactional service reviews**                      |

### 10.3 Legacy Jobs money flows — frozen, read-only, not revived

The current Jobs subsystem carries legacy assumptions that conflict with the approved
MohandisHub launch model: **application fees, interview fees, escrow, milestone money,
commissions, provider payouts and internal wallet movement.** The repository still holds the
columns that encode them.

The architecture requires:

| Requirement                                                                                     |
| ------------------------------------------------------------------------------------------------- |
| **No new customer-money wallet flow for Jobs**                                                   |
| **No Jobs escrow**                                                                               |
| **No internal salary payout**                                                                    |
| **No platform-held employment compensation**                                                     |
| **No provider withdrawal path**                                                                  |
| **No application fee or interview fee charged through retired EGP wallets**                      |
| **Existing historical financial records remain read-only and auditable** — never deleted, never rewritten |
| Any **future recruitment monetization must be designed separately**, using approved MHC platform actions, plans, advertisements, recruitment subscriptions or job-posting fees |

**No recruitment monetization model is invented or activated by this architecture.** Wave 3
freezes these paths; it does not replace them.

---

## 11. Inherited security correction — public profile external-link disclosure

Recorded alongside §9 because it is the same class of defect — protected data crossing a
public API boundary — found by the final readiness audit rather than the Wave 2 review.

**The issue is real and confirmed.** `business_profiles` carries `website`, plus
`linkedin_url`, `social_facebook`, `social_linkedin` and `social_twitter`, and the **public
profile response disclosed the Business website**. An unrestricted navigable URL the Business
controls is a direct off-platform contact channel — the phone number, the email address, the
premises address and an enquiry form are all one click away — and serving it on a public D0/D1
profile gives away what activation exists to sell, with no committed engagement and no MHC
charge.

**Its tier is D3** ([§5](#5-disclosure-tiers--the-products-central-mechanic),
[04 §7.1](./04-role-business.md)).

**It is fixed by a focused security hotfix implemented separately** — commit
`3027ea28b63eb60da60d90a1ddbe06e9993034e4`, *fix(profiles): close public contact disclosure*:

- **removes `website` and `linkedinUrl`** from the public profile contract;
- introduces **runtime allowlists** for `GET /api/profiles/public/:userId` —
  `PUBLIC_USER_PROFILE_FIELDS`, `PUBLIC_EXPERT_PROFILE_FIELDS`,
  `PUBLIC_BUSINESS_PROFILE_FIELDS`, `PUBLIC_CRAFTSMAN_PROFILE_FIELDS` and
  `PUBLIC_CUSTOMER_PROFILE_FIELDS` in `packages/shared/src/profiles.ts` — so the response is a
  closed set of permitted fields rather than a repository row filtered by convention;
- applies a **defensive allowlist in the web client** as well as at the API boundary;
- ships **regression tests** at all three layers: `apps/api/src/tests/public-profiles.security.test.ts`,
  `apps/web/tests/public-profile-client.test.ts` and `packages/shared/src/profiles.test.ts`.

It is a shipped correction on the same footing as `bc1681b`, **not an unresolved Wave 3
architecture blocker**.

**Standing requirements** ([17 §12](./17-product-invariants.md), INV-105 to INV-108):

1. **Public-profile allowlist discipline.** The public profile DTO/schema is an explicit
   permitted-field contract. No external link, exact address or coordinate may be added to it.
2. **Browser-client defensive allowlist.** The web client re-filters the profile payload rather
   than trusting the API to have filtered it — defence in depth, because the field exists in
   the row and one careless serializer change reintroduces the exposure.
3. **Private owner profile retains its editable contact fields.** The correction removes the
   fields from the *public* response, not from the owner's own profile management surface. A
   Business must still be able to record and edit its website and social links.
4. **Any future post-activation disclosure uses an activation-aware, participant-authorized
   endpoint**, never the public profile endpoint.
