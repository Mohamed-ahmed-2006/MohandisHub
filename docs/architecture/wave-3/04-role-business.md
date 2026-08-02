# 04 — Business

> Business is the **organizational commercial identity**. It is not a bigger Expert and not a
> shop with staff. It is a separate market participant, owned by a verified person, that can
> both **buy** and **provide** — the only identity in Wave 3 that does both.

---

## 1. Purpose

To let a registered organization participate in the marketplace under its own name, with its
own verification, its own reputation, its own credit and its own commercial record —
distinct from the personal identity of whoever created it.

Business exists for three reasons the personal identities cannot serve:

1. **Legal reality.** A registered company contracts as itself, not as its founder.
2. **Scope breadth.** An organization legitimately sells professional services *and*
   physical work; the Expert/Craftsman exclusivity is a rule about *persons*, not about
   companies.
3. **Procurement.** Organizations buy — materials, subcontracted labour, professional
   review — and they need that activity to be organizational, not filed under the owner's
   personal purchases.

---

## 2. Commercial identity

- **Business Commercial Identity (BCI)** — an organizational entity, separate from the
  identity that owns it and separate from that identity's PCI.
- An identity may own **zero or more** BCIs. Each is independent: separate KYB, profile,
  offers, reputation, reliability metrics, **MHC balance** and enforcement state.
- In Wave 3 **only the verified owner may perform commercial actions** for a BCI. Team
  membership confers **team-administration** rights only and **no commercial authority**
  ([09 §4](./09-business-buying-and-providing.md)).
- **The BCI is a Wave 3 deliverable, not an existing schema fact.** The repository today has
  **no distinct BCI entity**: `business_teams.business_id` references `users.id`, and
  `business_profiles.user_id` references `users.id`. The current Business-role user account is
  a **legacy Business-account surrogate** — it may seed and map deterministically to a BCI, but
  it is **not itself the final BCI model**. Wave 3 therefore requires an **additive Business
  Commercial Identity spine** with a deterministic compatibility mapping
  ([09 §4.4](./09-business-buying-and-providing.md)). Nothing in this document set may describe
  the current schema as already satisfying multi-BCI ownership.
- A BCI is **both a provider party and a buyer party**, in one commercial identity, across
  two separated activity surfaces.
- Owning a Business does not consume the owner's PCI slot, does not change their PCI type,
  and does not merge any reputation. A person may simultaneously be an Expert, a personal
  customer, and the owner of two Businesses — four distinct market presences, four separate
  reputations.

---

## 3. Main advantages

- **Sells across the whole catalog.** Professional services *and* local services *and*
  physical products *and* made-to-order production, under one identity. This is the only
  role with no offer-kind restriction.
- **Buys as an organization.** Procurement Needs, quote requests, purchases and buyer-side
  engagements are recorded against the company, not the founder.
- **Organizational credibility.** KYB verification, registration details, trade licence
  scope and a company profile — signals a personal identity cannot produce.
- **Higher operating ceilings.** Proposal quotas, catalog size, media allowances and
  concurrent-engagement caps are configured per identity type and are higher for a verified
  Business.
- **Reputation that survives people.** Business reputation belongs to the organization, so
  it persists independently of any individual's personal identity.
- **Separate credit.** A business MHC balance is the company's operating expense, not the
  owner's personal spend, which keeps books, analytics and any future tiered-rent model
  coherent.
- **Wave 4 readiness.** Every Wave 4 capability — members, delegation, branches, staff
  assignment, workspace-owned assets — lands on this identity without a data migration,
  because the identity is already the owner of everything.

---

## 4. Main limitations

- **KYB before selling, not before buying.** No offer publishes and no proposal submits until
  **V3b** (KYB) and owner/controller verification are approved. Ordinary procurement runs on
  **V3a** ([00 §4.1](./00-overview-and-terminology.md)), so a genuine company can source from
  day one. The selling delay is real and must be signposted at registration.
- **Owner-only commercial authority in Wave 3.** Exactly one human can transact. Team members
  may administer the team; they may not publish, propose, accept, spend MHC, buy, deliver,
  confirm settlement or answer cases. No delegates, no approvers, no branch managers, no staff
  assignment. A business whose *commercial* operations require several people cannot run them
  on the platform yet, and should be told so plainly.
- **No platform payment machinery.** Same as every other role: direct, off-platform,
  evidence-based. No invoicing, no receivables, no ledger the platform will collect on.
- **Pays MHC to accept, exactly like a personal provider.** Being an organization buys no
  exemption.
- **Buying does not earn provider reputation**, and selling does not improve buyer standing.
  The two surfaces are separate on purpose.
- **No group structures.** No parent/subsidiary, no branches, no multi-entity rollups, no
  consolidated analytics across two BCIs owned by the same person.
- **Cannot subcontract visibly.** Delivery is attributed to the Business; the platform
  models no supply chain in Wave 3.

---

## 5. Registration and activation

**Creation** (the owner's identity must already be V0, and V1 is required in step 3):

1. Owner creates a Business from their identity → chooses legal name, trade name, entity
   type, jurisdiction, categories.
2. Business exists in `draft` — it may be configured but is invisible and inert.
3. Owner completes **V1** on themselves as the controller if not already held.
4. Owner completes **V3a**: verified business email, verified business phone, and organization
   identity (legal name and registration reference recorded and format/registry-checked).
5. → **Buying Enablement granted.** The Business may browse, post Needs, request proposals and
   quotes, place requests, award, receive D3 as the buyer, settle and review.
6. Owner submits **V3b (KYB)**: commercial registration, tax card, premises/address evidence,
   and the ownership/control declaration naming the beneficial owner(s).
7. Admin review → approve, request more, or reject with reason.
8. → **Provider Enablement granted** for the BCI: offers publishable, proposals submittable,
   provider payment instructions publishable, Business reputation earnable, provider verified
   GMV accruable, MHC purchasable.

**Buying enablement is separate from selling enablement**, and deliberately reachable first.
The full gate map is [00 §4.1](./00-overview-and-terminology.md). Administrators may configure
higher requirements — V3b, or a per-period procurement cap — for high-risk or high-value
procurement, by category, declared budget, cumulative volume or risk flag.

**Engagement Activation** remains per-engagement and is charged to the **business MHC
balance**, spendable by the owner only.

---

## 6. Verification requirements

| Requirement                                       | Status                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Owner V0                                          | Mandatory                                                                  |
| **Owner/controller V1 (KYC)**                     | **Mandatory before acting through the Business at all** — in either direction. A business is never verified without a verified human |
| **V3a**: business email, business phone, organization identity | **Mandatory** before buying enablement                        |
| **V3b KYB**: registration, tax card, premises     | **Mandatory** before selling enablement. **Not** required for ordinary buying |
| Beneficial-ownership declaration                  | Mandatory at KYB; changes require re-declaration                           |
| Trade licence / category credential (business V2) | Mandatory in credential-required categories, held in the company's name    |
| Legal-name uniqueness check                       | Mandatory at approval; collisions are a moderation decision                |
| Re-verification                                   | On document expiry, legal-name change, ownership change, enforcement flag  |

- **Ownership transfer is Wave 4.** In Wave 3 the owner is fixed at creation; a change of
  owner requires an administrative process and full re-verification, and must not be a
  self-serve action.
- Verification stage (V3a or V3b), credential scope, legal name and registration reference are
  **snapshotted onto every engagement** at activation, on both the buying and the selling side.
  A provider must be able to prove what the buyer's verification stage was when they spent MHC
  to accept.
- A Business that loses KYB validity has its offers hidden and its selling blocked; **its
  buying continues at V3a**, and existing engagements continue untouched on both surfaces.

---

## 7. Profile capabilities

The Business profile is **organization-facing**: it describes a company, not a person.

| Element                                                                                  | Tier |
| ---------------------------------------------------------------------------------------- | ---- |
| Trade name, logo, cover, categories, company description, founding year, size band       | D0   |
| **Verified legal name and registration reference**                                       | D0 — organizations are public entities; this is a credibility asset, not protected data |
| Rating, review count, completed engagements, KYB badge, credential badges                | D0   |
| Coarse location(s) served, service areas, delivery coverage                              | D0   |
| Platform-hosted moderated media                                                          | D0   |
| Published offers across all kinds, with prices                                           | D0   |
| Company portfolio / project gallery, capability statement, certifications                | D1   |
| Availability, lead times, operating hours                                                | D1   |
| **Exact premises address, geolocation, phone, email, named contact person, payment instructions** | **D3** |
| **Business website and every external link the Business controls** (§7.1)                | **D3** |
| Owner's personal identity                                                                | Never published. Disclosed to admins and, at D3, as the verified signatory name |

### 7.1 External links are protected D3 data

An unrestricted navigable URL under the Business's control is a **direct off-platform contact
channel**. It carries the phone number, the email address, the premises address and an
off-platform enquiry form on the far side of one click, and publishing it at D0/D1 hands over
everything activation is supposed to sell. It is protected data, in the same class as a phone
number — not a profile decoration.

**Classified as protected D3 data:**

| Field                                                            |
| ---------------------------------------------------------------- |
| Business website                                                 |
| External company website                                         |
| Facebook URL                                                     |
| LinkedIn URL                                                     |
| Twitter/X URL                                                    |
| Instagram URL                                                    |
| WhatsApp URL                                                     |
| Telegram handle                                                  |
| External booking page                                            |
| External contact form                                            |
| External marketplace profile                                     |
| **Any unrestricted navigable URL controlled by the Business**    |

**None of these may be returned through a public D0/D1 Business profile API**, in any field, in
any nesting, under any caller. Public Business discovery shows only **platform-controlled and
moderated** information: company name, logo, description, industry, company size, founded year,
coarse location, accurate verification indicators, platform reputation, and platform-hosted
moderated media.

**Repository status.** The readiness audit found a **current public-profile website
disclosure** — `business_profiles` carries `website`, `linkedin_url`, `social_facebook`,
`social_linkedin` and `social_twitter`, and the public profile response exposed the website
field. This is a confirmed live defect, **closed by a focused security hotfix implemented
separately** (`3027ea2`, *fix(profiles): close public contact disclosure*), which removes the
fields from the public contract and replaces convention-filtering with runtime field
allowlists at both the API and web-client boundaries. It is a shipped correction, not an open
Wave 3 architecture question ([00 §11](./00-overview-and-terminology.md)).

**Future post-activation disclosure.** If external links are ever disclosed to a counterparty
after activation, that must run through an **activation-aware, participant-authorized
endpoint** that verifies a committed Engagement between the caller and the Business. It must
**never** be added back to the public profile endpoint, and no allowlist entry on the public DTO
may reintroduce it.

Two further rules specific to organizations:

- **The public profile must not name the owner as a personal brand.** The Business is the
  participant; the owner is its controller. Presenting the profile as a person's page is the
  route by which personal and organizational reputation get mixed.
- **Procurement activity is absent from the public profile.** What the company buys is not a
  selling credential and is not published.

---

## 8. Search and discovery capabilities

**Being discovered (sales surface):** appears in offer search, provider search, category and
area browse, alongside Experts and Craftsmen, with a Business marker and KYB badge. Buyers
may filter to Businesses only, or exclude them.

**Discovering supply (procurement surface):** the full customer discovery set from
[01 §8](./01-role-customer.md), executed in `business:<id>` context — searches, filters,
saved searches, favourites and recommendations are all stored on the Business, not on the
owner personally.

**Discovering work (sales surface):** an opportunity feed of open Needs across **all** need
types the Business's categories cover — a Business is eligible for Expert-shaped and
Craftsman-shaped Needs alike, subject to categories, credentials and service areas. Needs
are seen at D2 with the same protections as any other provider.

**Separation requirement:** the two feeds are separate surfaces with separate navigation and
separate saved filters. They must never be merged into one list, and an action must never be
available from the wrong surface. See [09](./09-business-buying-and-providing.md).

---

## 9. Buying capabilities

A Business may do everything a personal customer may do, under its own identity:

- Post **Needs** of any type, with the Business as the buyer party.
- Send **quote requests**, place **purchase**, **booking** and **product** requests.
- **Award** proposals and accept **custom proposals**.
- Receive **D3 disclosure** on activation, as the counterparty.
- **Report and confirm settlements**, hold payment plans, record deposits and instalments.
- **Confirm delivery**, request revisions, raise defects, open **cases**.
- **Review** the providers it buys from, exactly as any customer does.

What is different from a personal customer:

| Aspect                      | Business buyer                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Buyer identity on record    | The BCI, with legal name and registration reference in the snapshot                |
| Who may act                 | The owner only, in Wave 3                                                          |
| Verification required       | **V3a** — full KYB is not required to buy ([00 §4.1](./00-overview-and-terminology.md)) |
| MHC                         | **None spent.** Buyers never pay MHC; the accepting provider does                  |
| Verification shown to providers | Legal name plus the **accurate stage badge** — organization-verified (V3a) or KYB-verified (V3b), never conflated. A provider spending MHC is entitled to know which |
| Buyer conduct signal        | Attaches to the BCI, visible to providers at D2, never mixed with the seller rating |
| Self-dealing                | May not buy from itself, from its owner's PCI, or from another BCI the owner controls |

---

## 10. Providing capabilities

The Business is the **only** identity with an unrestricted offer set.

| Capability                                            | Wave 3                                            |
| ----------------------------------------------------- | --------------------------------------------------- |
| `expert_service` offers with packages, add-ons, revisions | ✅ full model from [07](./07-expert-packages.md) |
| `craftsman_service` offers, service areas, bookings   | ✅ full model from [08](./08-craftsman-storefront.md) |
| `physical_product` offers with variants               | ✅                                                  |
| `made_to_order_product` offers                        | ✅                                                  |
| Delivery, pickup, installation components             | ✅                                                  |
| Proposals on **all** eligible need types              | ✅ free, higher quota                               |
| Custom proposals and post-survey quotes               | ✅                                                  |
| Every fulfillment type in [11](./11-fulfillment-models.md) | ✅ including hybrid product + service          |
| Warranty / rectification terms                        | ✅                                                  |
| Delivery by staff, assignment, branches               | ❌ Wave 4                                            |
| Workspace-owned assets, shared templates              | ❌ Wave 4                                            |

The Business does **not** get a separate offer model. It composes the same four offer kinds
under an organizational identity. This is deliberate: a fifth parallel "business offer" model
would duplicate every rule in [06](./06-offer-model.md), [07](./07-expert-packages.md) and
[08](./08-craftsman-storefront.md) and immediately drift out of sync.

---

## 10.1 Recruitment Jobs — a separate subsystem, owner-only authority

A Business may also **publish job vacancies** through the MohandisHub **Jobs** module. This is a
**recruitment / employment marketplace**, separate from everything above: a vacancy is not an
Offer, an application is not a Proposal, and hiring is not an Engagement Activation
([00 §10](./00-overview-and-terminology.md), [10 §15](./10-engagement-model.md)).

**Wave 3 recruitment authority:**

| Rule                                                                                                    |
| ------------------------------------------------------------------------------------------------------- |
| **Only the verified Business owner** may create, edit, publish, manage, close or hire through Business Jobs |
| Business **team members receive no delegated recruitment authority**, regardless of role                 |
| The existing `manage_jobs` team permission remains **reserved and non-authoritative until Wave 4** — storable, reported under its reserved label, read by no authorization decision |
| Recruitment authority resolves to the **ownership relation only**, exactly like commercial authority     |

**Recruitment must not touch the transactional model:**

- Hiring records **do not count as provider verified GMV** and create no settlement tranche.
- Recruitment **salary or compensation is not processed through the Wave 3 service settlement
  model** — no agreed amount, no payment plan, no settlement record, no coverage.
- Recruitment reviews, if retained, stay **distinct from transactional service reviews** and
  never merge into the BCI's seller rating ([14 §12](./14-reviews-and-reputation.md)).
- No new customer-money wallet flow, escrow, salary payout, platform-held compensation or
  provider withdrawal path is created for Jobs ([00 §10.2](./00-overview-and-terminology.md)).

---

## 11. Communication capabilities

Same gate structure as every role — D2 pre-award communication (structured **and** free-form,
contact-masked, no attachments), D3 full messaging — with organizational specifics:

- Messaging is attributed to the **Business**, with the acting human recorded on each message
  for audit. In Wave 3 the acting human on any commercial thread is always the owner;
  recording it now is what makes Wave 4 delegation a non-migration.
- The Business declares a **named contact person and role** at D3 — organizations contract
  with people, and the counterparty needs to know who.
- **Procurement threads and sales threads are separate inboxes.** A single merged inbox would
  make it possible to reply to a supplier from the sales surface, which is exactly the
  context leak the separation exists to prevent.
- No broadcast, marketing or unsolicited outreach on any surface.

---

## 12. File and attachment capabilities

The union of the Expert and Craftsman rules, plus:

- **Company documents** (registration, tax card, licences, insurance certificates) are
  uploaded for KYB and are **admin-visible only**. Verified *facts* derived from them —
  "registration verified", "licence valid to 2027", scope — are published as badges. The
  documents themselves are never public and never disclosed to a counterparty, at any tier.
- **Capability statements, company profiles and project galleries** are **public listing
  media**, not transaction attachments. They may be published at D0/D1, and are subject to
  moderation and the anti-contact rules like everything else. The attachment lock in
  [00 §5.1](./00-overview-and-terminology.md) does not restrict them and must not be read as
  doing so.
- **Procurement-side attachments** the Business sends as a buyer follow the customer rules
  in [01 §12](./01-role-customer.md): **manifest-only before activation, for every file type,
  with no preview or sanitized rendition of any kind.**
- Every attachment carries the acting human's identity for audit.

---

## 13. Payment-related capabilities

**As a provider:**

- Publishes payment instructions at D3 — company bank account, InstaPay handle, accepted
  methods, and the account-name match customers should expect.
- Defines payment plans including deposits and instalments.
- Reports and confirms settlements; attaches proof; sees coverage and verified settled volume.
- **Holds the business MHC balance**, purchased by the owner, spendable by the owner, owned
  by the BCI.

**As a buyer:** pays providers directly and off-platform; reports and confirms; spends no
MHC.

**Hard rules:**

- The **business MHC balance is separate from the owner's personal MHC balance** and from
  any other BCI's. It is non-transferable between them — moving credit from a personal
  Expert identity into a Business, or between two Businesses, is prohibited, because MHC is
  non-transferable by baseline and because transferable credit would become a currency.
  ([18 §3](./18-decisions-required.md) records the settled migration posture: existing balances
  stay with the personal identity's PCI, and every Business starts at zero.)
- MHC is not an asset of the company that can be redeemed, refunded to cash, or recovered on
  dissolution.
- No receivables, no invoicing as a legal document, no tax computation, no accounting
  export beyond the analytics record. Records are described as *what the parties reported*.

---

## 14. Fulfillment responsibilities

Everything required of an Expert (§14 of [02](./02-role-expert.md)) and of a Craftsman
(§14 of [03](./03-role-craftsman.md)), for whichever fulfillment types the Business's
engagement uses, plus two organizational obligations:

1. **The Business is accountable for delivery regardless of who physically performs it.**
   The platform models no subcontractors and no staff in Wave 3; attribution is to the BCI,
   and "our contractor failed" is not a defence the platform recognizes.
2. **Owner availability is an operational risk the Business owns.** With single-actor
   authority, an unavailable owner stalls acceptance, delivery confirmation and case
   response. The product must surface this — accepting engagements the owner cannot service
   is what produces lapses and cancellations, both of which are measured.

On the buying side, the Business carries the full customer obligations from
[01 §14](./01-role-customer.md): supply requirements, be available, confirm or object,
report honestly.

---

## 15. Review capabilities

- **Receives** provider reviews on completed sales engagements, attached to the **BCI** and,
  where applicable, the specific offer, package version or product.
- **Writes** customer reviews on completed procurement engagements, attached to the
  counterparty provider — and these are ordinary public customer reviews, because the
  Business is acting as a buyer.
- **Receives** buyer conduct ratings from its suppliers, attached to the BCI, banded, never
  merged into its public seller rating.
- **One public response** per received review; editable once; moderated.
- **Identity separation is absolute:**
  - Business reviews never appear on the owner's personal profile, PCI, or any other BCI.
  - The owner's Expert or Craftsman reputation never transfers into a Business they create.
  - Two Businesses owned by the same person have entirely separate reputations, and the
    platform must not link them publicly.
  - A Business's buyer conduct and its seller rating are separate figures with separate
    labels and are never averaged.

---

## 16. Dispute capabilities

- Opens and answers cases on both surfaces: as a provider (non-payment, customer
  non-cooperation, abuse) and as a buyer (non-delivery, defects, misrepresentation).
- Buyer-side cases and provider-side cases are **separate case streams** with separate
  visibility, so a supplier dispute is never visible to a customer.
- Retains full case, evidence and appeal access under both suspension axes.
- May request **MHC re-grant** on the provider side under the narrow circumstances in
  [13 §9](./13-mhc-activation.md).
- Escalation, evidence and determination all run through the Help & Resolution Center.
- **Case actions are owner-only in Wave 3**, which is an operational risk the Business
  should be warned about, not a limitation to be worked around.

---

## 17. Analytics capabilities

Two dashboards that never share a total.

**Sales analytics** — the Expert and Craftsman metric sets from
[02 §17](./02-role-expert.md) and [03 §17](./03-role-craftsman.md), scoped to the BCI:
demand, proposals, engagements, settlement (agreed / reported / confirmed / verified), MHC,
reputation.

**Procurement analytics** — spend view (agreed / reported / confirmed), engagements by
category and supplier, needs performance, proposals received, time-to-award, supplier
on-time rate and dispute rate, buyer conduct signal.

Rules:

- **No combined figure.** There is no "total business activity" number that adds what the
  company sold to what it bought. Producing one would be meaningless and would corrupt every
  downstream metric, including verified GMV.
- Verified GMV counts **sales-side** confirmed and verified settlement only.
- Reported ≠ confirmed ≠ verified, always three labels.
- No cross-BCI rollups, no parent/subsidiary consolidation, and **no per-member breakdown** —
  team members administer the team but perform no commercial work, so there is nothing
  commercial to attribute to them. `view_analytics` grants no access.

---

## 18. Suspension behaviour

Business is the one identity where suspension must be **surface-scoped**, because suspending
selling should not strand the company's purchases and vice versa.

| Axis                                 | Effect                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Restriction**                      | Quota, catalog-publication or messaging limits on one surface.                                                                                 |
| **Commercial suspension (selling)**  | All offers hidden; no proposals, quote replies, acceptances or activations; MHC purchase blocked, balance frozen not forfeited. **Procurement continues.** |
| **Commercial suspension (buying)**   | No new Needs, quote requests, purchase/booking/product requests, or awards; open Needs unpublished; pending requests withdrawn before any provider is charged. **Selling continues.** |
| **Full commercial suspension**       | Both of the above.                                                                                                                             |
| **Profile suspension**               | Business profile and offers removed from discovery and direct links; authored reviews hidden pending review.                                   |
| **Termination**                      | Only after all open engagements — on both surfaces — complete, cancel with remedy, or are administratively closed with a determination.        |

Under **every** state the Business keeps, on both surfaces: existing engagement access,
delivery and receipt, scheduling, evidence upload, handover, messaging, settlement reporting
and confirmation, case participation and appeal.

**Owner-level enforcement does not automatically cascade.** Suspending a person's Expert PCI
does not suspend a Business they own, and suspending a Business does not suspend the owner's
personal customer capability — unless the finding is against the *person* (fraud, identity
abuse, sanctions), in which case an explicit, recorded cascade applies to every identity
they control. The cascade must be a deliberate administrative decision with a written
rationale, never an implicit side effect.

---

## 19. Actions explicitly prohibited

1. Selling before **V3b (KYB)** and owner/controller verification are **approved**.
2. Buying before the owner holds approved **V1** and the Business holds **V3a**.
3. Performing any **commercial** action for a Business the acting identity does not own —
   regardless of team membership, role or granted permission.
4. Granting, delegating or simulating **commercial** authority to any other identity —
   including "share the login", role assignment, or acting on someone's instruction as if
   delegated. Team administration under `manage_team` is not commercial authority and is not
   covered by this prohibition.
5. Enabling, wiring or honouring any of the six **reserved** team permissions —
   `manage_services`, `manage_jobs`, `manage_reservations`, `view_wallet`,
   `manage_support_disputes`, `view_analytics` — as an authorization input.
6. Merging, transferring or displaying reputation across a BCI, the owner's PCI, the owner's
   buyer conduct, or another BCI.
7. Transferring MHC between the Business and any other identity, in either direction.
8. Buying from, proposing to, awarding to, or reviewing a related commercial identity.
9. Presenting procurement activity as sales credentials, or publishing supplier identities
   on the public profile without consent.
10. Publishing KYB documents, or disclosing them to a counterparty at any tier.
11. Transmitting contact details, links, handles or payment instructions at D0/D1/D2 —
    including within company profiles, capability statements and gallery media. (The legal
    name and registration reference are published deliberately and are not contact details.)
11a. **Returning the Business website, any external company website, Facebook, LinkedIn,
    Twitter/X, Instagram, WhatsApp, Telegram, an external booking page, an external contact
    form, an external marketplace profile, or any unrestricted navigable URL the Business
    controls, through a public D0/D1 Business profile API or any pre-activation surface** (§7.1).
11b. **Publishing the Business's exact premises address, geolocation or an exact map pin below
    D3**, by any route including profile fields, media and capability statements.
11c. **Performing any Business Jobs recruitment action — create, edit, publish, manage, close
    or hire — as a non-owner**, or reading `manage_jobs` as an authorization input (§10.1).
11d. **Routing recruitment salary, compensation, application fees or interview fees through the
    Wave 3 settlement model, an MHC flow, a wallet, escrow or a payout path** (§10.1).
12. Disclosing any **transaction attachment** — of any file type — before activation, and
    describing a V3a Business to a provider as KYB-verified.
13. Accepting an engagement without a successful MHC charge from the **business** balance.
14. Requesting payment routed through MohandisHub, issuing platform-branded invoices, or
    implying the platform holds, guarantees or will refund funds.
15. Presenting a combined buy+sell volume figure as revenue, GMV or business activity.
16. Operating a second unregistered brand, location or branch inside one BCI as a workaround
    for the Wave 4 gap.
17. Soliciting, trading or conditioning reviews on either surface.

---

## 20. Features deferred to Wave 4 or later

This role carries most of the deferred surface. Everything below is **architecture-compatible
and deliberately unbuilt**, and the Wave 3 boundaries in
[09 §6](./09-business-buying-and-providing.md) exist specifically to stop it leaking in.

- **Members and invitations with *commercial* authority.** The Wave 2G/2H team machinery
  itself is **retained and available in Wave 3** for team administration; what is deferred is
  giving a member the ability to act commercially
  ([09 §4](./09-business-buying-and-providing.md)).
- **Granular permissions**: per-capability roles, spend limits, approval chains, maker/checker
  on activation and settlement confirmation. The six reserved permission values already exist
  in the schema and stay **disabled** until this arrives.
- **Delegated authority**: acting on behalf of the Business, recorded attribution with
  independent authority (attribution itself is already recorded in Wave 3 — the *authority*
  is what is deferred).
- **Staff assignment**: assigning an engagement or a fulfillment component to a person,
  per-staff calendars, capacity and reputation.
- **Branches**: multiple locations with their own areas, hours, catalogs and analytics.
- **Workspace-owned assets**: offers, templates, portfolio, media libraries and saved
  searches owned by the entity independently of any person.
- **Ownership transfer** and controller change as a self-serve, verified flow.
- **Group structures**: parent/subsidiary, multi-entity rollups, consolidated analytics.
- **Procurement tooling**: approval workflows, purchase orders, budgets, cost centres,
  preferred-supplier lists, sealed or scored RFQs.
- **B2B commercial terms**: net payment terms, credit accounts, framework agreements,
  contract templates and e-signature.
- **Consolidated statements, tax documents and accounting integrations.**
- **Paid promotion, featured placement, advertisements, paid plans** — unapproved for
  Wave 3, and separately blocked by `LAUNCH_CONSTRAINTS.md` LC-01 and LC-02.
- **Any escrow, platform-held funds, receivables management or platform-executed refunds.**
- **Delegated recruitment authority** — `manage_jobs` becoming effective so a team member may
  manage vacancies, candidates or hiring on the Business's behalf (§10.1).
- **Recruitment monetization and the long-term Jobs redesign.** Any future recruitment revenue
  must be designed separately, using approved MHC platform actions, plans, advertisements,
  recruitment subscriptions or job-posting fees — never a customer-money wallet flow, escrow or
  payout ([18](./18-decisions-required.md)).
- **Post-activation disclosure of the Business's external links**, which would require a
  dedicated activation-aware participant-authorized endpoint and is not built in Wave 3 (§7.1).
