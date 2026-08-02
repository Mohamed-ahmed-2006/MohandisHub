# E — Business Buying and Providing

> The Business is the only identity that both buys and provides. This file defines how those
> two activities coexist inside one commercial identity without contaminating each other,
> and how Wave 4's unfinished team model is prevented from leaking into Wave 3.

---

## 1. Separation between procurement activity and sales activity

**One commercial identity. Two surfaces. Never merged.**

| Dimension                | Procurement surface                            | Sales surface                                        |
| ------------------------ | ---------------------------------------------- | ---------------------------------------------------- |
| The Business is the…     | Buyer party                                    | Provider party                                       |
| Creates                  | Needs, quote requests, purchase/booking/product requests, awards | Offers, proposals, custom proposals, acceptances |
| Feeds                    | Buyer conduct signal                           | **Public rating and reviews**                        |
| MHC                      | Spends none                                    | **Spends on every activation**                       |
| Verification required    | **V3a** — organization-verified                | **V3b** — full KYB                                   |
| Verification shown       | The accurate stage badge to the provider — organization-verified or KYB-verified | KYB badge to the buyer |
| Counted in verified GMV  | **No**                                         | Yes, when confirmed or verified                      |
| Appears on public profile| **No**                                         | Yes                                                  |
| Inbox                    | Supplier threads                               | Customer threads                                     |
| Cases                    | Buyer-side case stream                         | Provider-side case stream                            |
| Analytics                | Spend dashboard                                | Sales dashboard                                      |

### 1.1 Enforced separation rules

1. **Every commercial action declares its surface**, and the surface is derived from the
   action's role in the arrangement, not chosen by the client. Publishing an Offer is a sales
   action; posting a Need is a procurement action. There is no ambiguous action.
2. **No merged lists.** Engagements, threads, cases, notifications and analytics are
   presented in two streams. A single "all activity" list that mixes what the company sold
   with what it bought is prohibited, because it produces exactly the wrong mental model and
   invites wrong-surface actions.
3. **No combined totals.** There is no figure that adds procurement spend to sales volume.
   ([04 §17](./04-role-business.md).)
4. **No cross-surface leakage of counterparties.** A supplier cannot see the Business's
   customers, and a customer cannot see its suppliers. Supplier identities never appear on
   the public profile without recorded consent.
5. **Self-dealing is blocked across the seam.** A Business cannot propose on its own Need,
   cannot buy from itself, and cannot transact with its owner's PCI or with another BCI the
   owner controls.
6. **Reputation never crosses.** Buyer conduct and seller rating are distinct figures with
   distinct labels and are never averaged, combined or presented as one score.
7. **Suspension is surface-scoped** by default ([04 §18](./04-role-business.md)): selling can
   be suspended while procurement continues, and the reverse.

---

## 2. Organization-facing profile

The public profile describes a **company**, not a person. Its contents and disclosure tiers
are in [04 §7](./04-role-business.md). The rules that matter for this section:

- **Legal name and registration reference are published at D0.** An organization is a public
  entity, and its registered identity is a credibility asset rather than protected personal
  data. This is a deliberate difference from the personal identities, where the legal name is
  D3.
- **The owner is never published.** The profile must not read as a personal brand page; the
  owner is disclosed at D3 as the verified signatory, and to administrators always.
- **KYB documents are never published or disclosed to counterparties** — only the verified
  *facts* derived from them appear as badges.
- **Procurement is absent.** What the company buys is not a selling credential.
- **Capability statements, project galleries and certifications** are sales-surface content
  at D1, moderated for contact leakage and consent-recorded where a client is named.

---

## 3. Owner authority in Wave 3

**One human holds all commercial authority. No commercial delegation.**

The owner — the identity that created the Business and passed controller verification — is
the sole actor for every **commercial** Business action. Team administration is a separate,
non-commercial surface that continues to work (§4):

| Action class                                                                 | Wave 3 actor |
| ----------------------------------------------------------------------------- | ------------ |
| Create, configure and submit the Business for KYB                            | Owner only   |
| Publish, pause, hide, archive offers and catalog items                       | Owner only   |
| Submit proposals and custom proposals                                        | Owner only   |
| **Accept an arrangement and spend business MHC**                             | Owner only   |
| Purchase MHC for the Business                                                | Owner only   |
| Post Needs, request quotes, place requests, award                            | Owner only   |
| Deliver, upload evidence, mark completion, handle revisions and rectification | Owner only   |
| Report and confirm settlements                                               | Owner only   |
| Open, answer and appeal cases                                                | Owner only   |
| Respond to reviews                                                           | Owner only   |
| Confirm receipt on procurement engagements                                   | Owner only   |
| **Administer the team** — invite, assign a role, remove a member             | **Owner, or a member holding `manage_team`** (§4) |

**Recorded attribution now, delegated authority later.** Every Business action records the
acting human alongside the Business. In Wave 3 that value is always the owner on every
commercial action, which makes it look redundant — it is not. Recording it from day one is
what turns Wave 4 delegation into an authorization change rather than a data migration, and it
is what makes an audit trail exist before it is needed.

**The single-actor risk must be surfaced, not hidden.** An unavailable owner stalls
acceptance, delivery and case response, and produces lapses and cancellations that are
measured. The product should warn a Business that accepts more concurrent work than one
person can service, and should not pretend the constraint does not exist.

---

## 4. Business team administration in Wave 3 — settled

Wave 2G/2H shipped business workspace membership with roles and invitations. Wave 3 keeps it,
scoped precisely to what it actually enforces.

**The settled position: retain team administration, withhold commercial authority.**

### 4.1 What the repository actually enforces today

This is the factual baseline the architecture reconciles against, not a proposal:

- **`business_teams.business_id` references `users.id`.** It is **not** a Business Commercial
  Identity. It is the id of the Business-role **user account** that owns the workspace, and it
  is immutable — one workspace per Business account, enforced by a uniqueness index and a
  change-rejection trigger. The immutability is real and useful; the *interpretation* that it
  is already a BCI is wrong and is corrected here.
- **`business_profiles.user_id` also references `users.id`.** The company profile hangs off the
  same user account.
- **A distinct BCI entity does not exist yet.** Existing services, jobs, reservations, wallets,
  payment methods, advertisements, analytics and files are **user-owned**, keyed to an account
  id that is simultaneously the financial actor.
- **The current Business-role user account is a legacy Business-account surrogate.** It may
  seed and map deterministically to a BCI; it is not itself the final BCI model, and Business
  assets are **owner-user-owned today**, not Business-owned. §4.4 defines the additive spine
  that closes the gap.
- **Exactly one team permission is read by an authorization decision: `manage_team`.**
- Six further permission values are storable and **authorize nothing**: `manage_services`,
  `manage_jobs`, `manage_reservations`, `view_wallet`, `manage_support_disputes`,
  `view_analytics`. They are separated as **reserved** — carried on any role that already
  holds them, reported under their own name, and never counted by `hasPermission`.
- **Non-owner members hold no commercial-domain authority.** Every commercial domain keys its
  rows to an account id that is simultaneously the financial actor, which is exactly why
  delegation needs the BCI spine (§4.4) plus the Wave 4 authorization work, and cannot be
  switched on here.
- **Workspace selection controls team administration only.** It does not set an
  application-wide commercial acting context, and Wave 3 must not extend it to do so.

### 4.2 The Wave 3 rules

1. **Existing team administration remains available.** Members, invitations, roles and the
   workspace surface continue to function. This is not a fenced or withdrawn feature.
2. **`manage_team` remains the only effective team permission**, and it is genuinely enforced.
   It governs team administration — inviting, assigning a role, removing a member — and
   nothing beyond it.
3. **Only the verified Business owner may perform commercial actions** for the Business. Every
   commercial authorization resolves to *"is the acting identity the owner of this BCI?"* and
   consults membership **never**.
4. **The six reserved permissions remain disabled.** They are not grantable, not reported as
   effective, and not readable as an authorization input. They must not be wired to anything.
5. **Nothing historical is deleted or disabled.** Existing memberships, invitations, roles and
   audit records are preserved in full — including roles still carrying a reserved permission
   from before the split. Wave 4 builds on this data.
6. **No delegated commercial capability is enabled**, in any of these domains: services, jobs,
   bookings, files, conversations, analytics, disputes, advertisements, payment methods, plans,
   or MHC spending.
7. **Workspace-owned assets and delegated commercial authority remain Wave 4.**

### 4.3 The honesty rule

A permission that is displayed but not enforced is worse than an absent one — it tells a user
a delegate can do work the API will refuse. So:

- `manage_team` is enforced and may be presented as a working capability.
- The six reserved permissions must **not** be presented as active, granted or effective. Where
  a role historically carries one, it is shown under its own **reserved** label — visible for
  what it was configured with, explicitly not working.
- Invitation copy, role pickers and seat counters must not promise commercial authority. If
  they mention it at all, they state that members cannot act commercially in Wave 3 and that
  delegated authority arrives in Wave 4.

The failure mode being prevented is not that Wave 4 is late. It is a half-implemented team
model shipping silently: a member sees a button, the API happens to allow it, and an engagement
is created under an authority nobody designed.

### 4.4 The additive Business Commercial Identity spine

Wave 3 requires an **additive BCI spine**. The current schema does **not** already satisfy
multi-BCI ownership, and describing it as if it does would send implementation into a Wave 4
delegation model built on a principal that never existed.

**What Wave 3 introduces:**

| Requirement                                                                                                     |
| --------------------------------------------------------------------------------------------------------------- |
| A **distinct BCI entity**, additive — introduced beside the legacy structures, never by rewriting them          |
| **Each legacy Business account maps deterministically to exactly one initial BCI.** Same input, same BCI, every time; re-running the mapping creates nothing new |
| **The controlling user becomes the owner/controller of the BCI**                                                |
| **Existing Business team/workspace IDs are preserved unchanged** — no renumbering, no re-keying, no replacement  |
| **Membership history, roles, invitations and audit records are preserved unchanged**                            |
| **Commercial assets are re-associated non-destructively**, through compatibility mappings or **additive owner columns** — never by destructive re-keying of user-owned rows |
| **The current immutable Business-account relationship remains a compatibility anchor** for the duration of the migration |
| **User-owned historical assets stay readable throughout the compatibility period**                              |
| **One owner may control multiple BCIs without asset mixing** — each BCI's assets, balance, reputation and enforcement state stay separate |

**What this is not:**

- It is **not** a claim that `business_teams.business_id` is a BCI (§4.1).
- It is **not** a destructive migration. No historical row is deleted, re-pointed or rewritten
  to make the new spine tidy.
- It is **not** delegation. The BCI spine is the *principal*; granting a non-owner authority
  over it remains Wave 4 (§4.2, §6).
- It is **not** a new "workspace" object introduced as Wave 4 scaffolding (§6, B6).

Wave 4 delegation then becomes an **authorization change on a real principal**, which is what
the earlier — incorrect — "already the principal" wording was reaching for and did not have.

---

## 5. Business reviews

Covered fully in [14](./14-reviews-and-reputation.md). The business-specific points:

- **Received reviews attach to the BCI**, and additionally to the offer, package version,
  product or variant where applicable.
- **Written reviews** (as a buyer) are ordinary public customer reviews on the counterparty
  provider.
- **Received buyer conduct ratings** attach to the BCI, banded, never merged into the public
  seller rating.
- Business reputation is **completely isolated** from: the owner's personal identity, the
  owner's PCI, the owner's buyer conduct, and every other BCI the owner controls. The
  platform must not link two Businesses publicly even when they share an owner.
- **Reputation does not migrate in either direction.** A successful Expert who forms a
  Business starts that Business at zero, and a Business's rating never appears on the
  owner's personal profile. This is not a limitation to be worked around; it is the point of
  separate commercial identities.
- One public response per received review, editable once, moderated, owner-authored.

---

## 6. Boundaries preventing unfinished Wave 4 behaviour from leaking into Wave 3

These are the concrete tripwires. Each is a testable prohibition, not a guideline.

| #  | Boundary                                                                                                                                     |
| -- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 | **No non-owner may perform any commercial action for a BCI.** Commercial authorization checks the ownership relation only; membership is never consulted. Team administration under `manage_team` is outside this boundary and continues to work |
| B2 | **No permission is displayed as effective that is not enforced.** `manage_team` is enforced and may be presented as working. The six reserved permissions are shown only under their reserved label, never as granted or effective |
| B3 | **No invitation flow may promise commercial authority.** Invitations remain available; they must state that members cannot act commercially in Wave 3 |
| B3a| **No reserved permission is read by any authorization decision.** `manage_services`, `manage_jobs`, `manage_reservations`, `view_wallet`, `manage_support_disputes` and `view_analytics` authorize nothing, and wiring any of them to an endpoint is a Wave 4 leak |
| B3b| **Workspace selection never sets commercial context.** It scopes team administration only; the commercial acting context is resolved from the ownership relation, never from the selected workspace |
| B3c| **No historical membership data is deleted or disabled** — memberships, invitations, roles and audit records are preserved, including roles carrying a reserved permission from before the split |
| B4 | **No assignment.** An engagement or fulfillment component cannot be assigned to a person other than the owner; there is no assignee concept in the UI or the model |
| B5 | **No branch, location or sub-entity** may be created inside a BCI, and multi-location behaviour must not be simulated with categories, tags, duplicate offers or a second unregistered brand |
| B6 | **No delegated workspace-owned asset semantics.** Wave 3 introduces the additive BCI spine (§4.4) so offers, portfolio, templates and saved searches acquire a real commercial principal. What is deferred is *delegated access* to them; no new "workspace" object may be introduced as scaffolding, and the legacy immutable Business-account relation stays a compatibility anchor rather than being presented as the finished model |
| B6a| **No destructive BCI migration.** Team/workspace IDs, memberships, invitations, roles and audit records are preserved unchanged; commercial assets are re-associated only through compatibility mappings or additive owner columns (§4.4) |
| B6b| **No non-owner recruitment authority.** Business Jobs — create, edit, publish, manage, close, hire — is owner-only, and `manage_jobs` stays reserved and unread (§8) |
| B7 | **No spend delegation.** MHC is spendable by the owner only; no spend limits, budgets, approval chains or maker/checker flows exist, and none may be partially built. `view_wallet` grants no MHC visibility or authority |
| B8 | **No ownership transfer as a self-serve action.** Owner change is an administrative process with full re-verification |
| B9 | **No cross-BCI aggregation.** No consolidated analytics, no parent/subsidiary relation, no group identity, and no public linkage between two BCIs with a common owner |
| B10| **No per-member analytics, per-member reputation, or staff-level metrics.** Members exist for team administration but perform no commercial work, so there is nothing commercial to measure per member. `view_analytics` grants nothing |
| B11| **Attribution is recorded, authority is not granted.** Recording the acting human is required; treating that record as evidence of delegated authority is prohibited |
| B12| **No API, admin tool or support action may act for a BCI on the owner's behalf** in a way that creates commercial obligations. Administrators may resolve, annotate and enforce; they may not sell, buy, accept or activate |

### 6.1 Why these boundaries are strict

The failure mode is not that Wave 4 arrives late. It is that a half-implemented team model
ships silently: a member sees a button, the API happens to allow it, an engagement is created
under an authority no one designed, and the audit trail says the Business did it. Every
boundary above exists to make that impossible to reach by accident, and each one should
appear in the Wave 3 test suite as a negative test.

---

## 7. Business purchases are not a separate origin

A frequent modelling error, named here so it does not get built.

A "business purchase" is **not** an engagement origin. It is any engagement — of any origin
in [10 §2](./10-engagement-model.md) — whose **buyer party is a BCI**. The origin describes
*how the arrangement was formed*; the party describes *who formed it*.

Consequences:

- There is no `business_purchase` origin, no separate business order object, and no parallel
  purchase pipeline.
- Every rule about awards, purchases, bookings, product requests and custom orders applies
  unchanged when the buyer is a Business.
- The differences that do exist — legal name in the snapshot, KYB badge shown to the
  provider, buyer conduct attaching to the BCI, owner-only actions — are **party attributes**,
  carried in the buyer identity snapshot.
- The provider still pays the MHC activation charge. A business buyer changes nothing about
  who is charged.

---

## 8. Recruitment Jobs are a third surface, outside both

The Business's procurement and sales surfaces (§1) are the two **commercial** surfaces. The
**Jobs** module is a third, **non-commercial-transaction** surface — a recruitment/employment
marketplace — and it belongs to neither.

| Dimension                    | Recruitment surface                                              |
| ---------------------------- | ---------------------------------------------------------------- |
| The Business is the…         | **Employer / hiring party** — not a buyer, not a provider        |
| Creates                      | Job vacancies                                                    |
| Receives                     | Job applications (recruitment candidacy)                         |
| Actions                      | Review, shortlist, reject, schedule interviews, hire, close      |
| Produces                     | A recruitment/employment outcome                                 |
| MHC                          | **Spends none.** Hiring is not an activation                     |
| Engagement spine             | **Never enters it** ([10 §15](./10-engagement-model.md))         |
| Counted in verified GMV      | **No — never**                                                   |
| Settlement model             | **Not used.** Salary is not an agreed amount and creates no tranche |
| Who may act                  | **The verified Business owner only**                             |
| `manage_jobs`                | **Reserved and non-authoritative until Wave 4**                  |
| Reviews                      | Recruitment reviews, if retained, stay distinct from service reviews |

**Enforced rules:**

1. **Owner-only recruitment authority.** Create, edit, publish, manage, close and hire all
   resolve to the ownership relation. Membership is never consulted, and `manage_jobs`
   authorizes nothing — wiring it to a recruitment endpoint is a Wave 4 leak exactly like
   wiring it to a commercial one (§6, B3a and B6b).
2. **No cross-surface contamination.** A job vacancy never appears in offer search, a job
   application never appears in the proposals inbox, and no merged list mixes recruitment with
   procurement or sales.
3. **Candidate reputation is untouched.** A rejection, a withdrawal or a failed interview must
   **not** automatically alter the candidate's service-provider reputation, rating, reliability
   metrics or ranking ([14 §12](./14-reviews-and-reputation.md)).
4. **No legacy money flow is revived.** The legacy Jobs subsystem's application fees, interview
   fees, escrow, milestone money, commissions, provider payouts and wallet movement stay
   **disabled and read-only** ([00 §10.2](./00-overview-and-terminology.md)).

The recruitment module remains a **separately supported legacy/product subsystem** during Wave
3. Its long-term redesign and any monetization are separate future decisions.
