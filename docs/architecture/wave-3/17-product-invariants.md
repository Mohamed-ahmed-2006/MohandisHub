# M — Product Invariants

Enforceable product rules. Each is stated so that it can be turned into a constraint, a guard,
a service-layer assertion or a test without further interpretation.

**Enforcement layer legend**

| Code | Layer                                                                                    |
| ---- | ------------------------------------------------------------------------------------------ |
| `D`  | **Data** — a schema-level constraint; the database must make the violation impossible    |
| `S`  | **Service** — an application-layer assertion, inside the relevant transaction            |
| `A`  | **API/Authorization** — a request guard, before any work is done                         |
| `J`  | **Job** — a scheduled or event-driven process, plus a consistency check that alarms      |
| `U`  | **UI** — a presentation rule (never the *only* layer for anything that matters)          |
| `P`  | **Policy** — a copy-review or operational rule with a checklist item                     |

Every invariant below should have at least one **negative test**. Invariants marked
**(baseline)** are restatements of the approved product baseline.

Numbering is stable: invariants added during reconciliation carry a letter suffix on the
invariant they refine (INV-009a, INV-052c) rather than renumbering the series, so existing
references stay valid.

---

## 1. Identity and context

| #       | Invariant                                                                                                                                                 | Layer   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| INV-001 | **A personal commercial identity cannot simultaneously be Expert and Craftsman.** An identity holds at most one PCI, and its type is one of the two. **(baseline)** | `D` `S` |
| INV-002 | Every identity holds customer capability from creation, and it cannot be removed, downgraded or revoked while the account exists. **(baseline)**            | `D` `S` |
| INV-003 | Every commercial write executes in exactly one acting context, resolved server-side from the authenticated identity and the target resource — never taken from client-supplied role or type fields. | `A` `S` |
| INV-004 | **Business actions must execute under an explicit Business context**, and the acting identity must be the owner of that BCI. **(baseline, Wave 3)**        | `A` `S` |
| INV-005 | Two commercial identities controlled by the same identity may not transact with each other in any role, at any origin.                                    | `S`     |
| INV-006 | A BCI's assets, balance, reputation and enforcement state are owned by the BCI, never by its owner's personal identity.                                   | `D`     |
| INV-007 | One verified natural person maps to at most one PCI. A second identity resolving to the same identity document is an enforcement case, not a second provider. | `S` `J` |
| INV-008 | Every Business action records the acting human alongside the Business, even when only the owner can act.                                                  | `D` `S` |
| INV-009 | Membership of a Business confers **no** commercial authority in Wave 3; every commercial authorization resolves to the ownership relation alone. Team administration under `manage_team` is not a commercial authorization and is unaffected. | `A` `S` |
| INV-009a| `manage_team` is the **only** team permission read by any authorization decision. The six reserved permissions — `manage_services`, `manage_jobs`, `manage_reservations`, `view_wallet`, `manage_support_disputes`, `view_analytics` — authorize nothing and are never counted as effective. | `A` `S` |
| INV-009b| Historical membership data — memberships, invitations, roles, audit records, and roles carrying a reserved permission — is never deleted or disabled.     | `D` `P` |
| INV-009c| Workspace selection scopes **team administration only**. It never resolves or influences the commercial acting context.                                  | `A` `S` |
| INV-009d| An identity holds at most one PCI at every instant, **including during a conversion**. Archival of the old PCI completes before the replacement is enabled. | `D` `S` |
| INV-009e| PCI conversion is blocked while any active, pending-activation, incomplete or disputed engagement, or any open case or appeal, exists on the current PCI. There is no administrative override. | `S`     |
| INV-009f| A conversion **archives** the old PCI; it never mutates or deletes it. The archived identity's reviews, engagements, evidence and settlement records stay permanently bound to it. | `D` `S` |

---

## 2. Verification

| #       | Invariant                                                                                                                     | Layer   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | ------- |
| INV-010 | A PCI cannot publish an offer or submit a proposal unless V1 is **approved** — submitted is not approved. **(baseline)**      | `A` `S` |
| INV-011 | A BCI cannot **sell** unless **V3b (KYB)** is approved **and** the owner/controller holds an approved V1. **(baseline)**       | `A` `S` |
| INV-011a| A BCI **may buy at V3a** — full KYB is never required to browse, post a Need, request proposals or make ordinary purchases. Requiring it there is a defect, not caution. | `A` `S` |
| INV-011b| No BCI publishes an offer, submits a provider proposal, earns Business reputation, publishes provider payment instructions, or accrues provider verified GMV below V3b. | `A` `S` |
| INV-011c| Administrators may configure **higher** verification or procurement caps for high-risk or high-value procurement; the baseline for ordinary buying stays V3a. | `S` `P` |
| INV-011d| A counterparty is shown the Business's **accurate** verification stage. A V3a Business is never presented as KYB-verified. | `S` `U` |
| INV-012 | An offer in a `credential_required` category cannot be published or proposed on without a valid, in-scope V2.                 | `A` `S` |
| INV-013 | A lapsed verification hides offers and blocks new commercial activity; it never alters, pauses or terminates an existing engagement. | `J` `S` |
| INV-014 | A displayed credential badge never claims a scope wider than the verified record.                                             | `S` `U` |
| INV-015 | Verification tier, credential scope and expiry are copied into the engagement snapshot at activation and are never recomputed from current state. | `S` |

---

## 3. Disclosure

| #       | Invariant                                                                                                                                              | Layer       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| INV-016 | **Contact disclosure cannot occur before successful activation.** Full contact, verified legal name of a personal party, exact address, geolocation, attachment contents, free messaging and payment instructions are D3-only. **(baseline)** | `A` `S` `U` |
| INV-017 | D3 is reachable **only** through a committed Engagement Activation. No other code path may grant it — not admin tooling, not support, not a preview, not a partial reveal. | `A` `S`     |
| INV-018 | Every field in the system is assigned to exactly one disclosure tier, and serializers filter by tier at the boundary rather than by caller convention. | `S`         |
| INV-019 | **No transaction attachment content is exposed below D3, for any file type.** Pre-activation attachments are exposed as a manifest only — count, MIME type, size, caption. There is no preview class and no per-file opt-in that creates one. | `D` `S` |
| INV-020 | Images, documents, PDFs, CAD files, drawings, spreadsheets, archives, audio and video are **never** previewable, renderable, thumbnailed or downloadable at any tier below D3. | `D` `S` |
| INV-020a| **No transformation authorizes pre-activation attachment access.** Watermarking, downscaling, EXIF stripping, OCR, contact scanning and any "safe image" determination are prohibited routes to disclosure, not permissions for it. | `S` `P` |
| INV-020b| Public portfolio and storefront media are **published listing media**, not transaction attachments. They remain visible at D0/D1 under moderation and the anti-contact rules, and INV-019/020 do not restrict them. | `S` `P` |
| INV-020c| Pre-award communication exists at D2 and carries **structured and free-form text**. It is never replaced by a structured-only model except as an explicitly optional, separately introduced mode. | `S` `P` |
| INV-020d| Pre-award communication carries **no attachments of any type**, no unrestricted links, no payment instructions and nothing that identifies an exact location. | `A` `S`     |
| INV-021 | Every pre-activation free-text surface — structured **and** free-form — passes through contact redaction, and the unredacted original is retained for moderation. | `S`     |
| INV-022 | Needs are never visible to unauthenticated requests.                                                                                                   | `A`         |
| INV-023 | A proposal's amount is never visible to any identity other than its author, the buyer, and administrators.                                             | `A` `S`     |
| INV-024 | No location representation below D3 — map pin, radius, distance, travel estimate — may be fine enough to identify an address.                          | `S` `P`     |
| INV-025 | Once opened, D3 persists for the parties to that engagement through completion, dispute, suspension and termination.                                   | `S`         |

---

## 4. Offers

| #       | Invariant                                                                                                                        | Layer   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| INV-026 | Offer kind availability derives from the owning commercial identity's kind. An Expert cannot hold a product offer in any state, including draft. | `D` `S` |
| INV-027 | Any change to price, scope, inclusions, exclusions, delivery time, revisions, requirements or terms increments the offer version.| `S`     |
| INV-028 | An offer version referenced by an engagement or a review is frozen and can never be edited in place.                             | `D` `S` |
| INV-029 | **No offer lifecycle transition — pause, hide, reject, archive — affects any existing engagement.**                              | `S`     |
| INV-030 | An offer, package, product or variant carrying an engagement or a review cannot be hard-deleted.                                 | `D` `S` |
| INV-031 | A packaged Expert offer holds 1–3 tiers with strictly increasing prices; `unlimited` revisions are not representable.            | `D` `S` |
| INV-032 | Every published offer carries a price signal. A `quote_only` offer without a published price indication cannot be published.     | `S`     |
| INV-033 | No offer field — text, media, file name, caption or title — may contain contact details, external links or payment instructions. | `S` `J` |

---

## 5. Engagements

| #       | Invariant                                                                                                                                                            | Layer   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| INV-034 | **An engagement retains immutable commercial snapshots** — origin, both parties, price, scope, location, verification, acting humans — fixed at activation. **(baseline)** | `D` `S` |
| INV-035 | An engagement renders and is adjudicable in full with its source offer archived, its Need deleted and either party suspended. Snapshots are inline and self-sufficient. | `S`     |
| INV-036 | No actor — party, support agent or administrator — can modify a snapshot. Administrators may annotate and may rule; they may not rewrite what was sold.                 | `A` `S` |
| INV-037 | Terms change only through an Amendment accepted by **both** parties, recorded append-only with the prior version preserved.                                             | `S`     |
| INV-038 | Every accepted commercial arrangement is an Engagement. No parallel order, booking or purchase object may exist.                                                        | `D`     |
| INV-039 | Every origin terminates in provider activation. There is no instant-purchase, auto-accept or buy-now path that creates an obligation without a charged acceptance.      | `S`     |
| INV-040 | An engagement completes only when every **required** fulfillment component is confirmed or auto-confirmed.                                                              | `S`     |
| INV-041 | Cancellation requires a cause code from the closed list, and never deletes snapshots, messages, evidence or settlement records.                                         | `D` `S` |
| INV-042 | Completion is irreversible. A post-completion defect is a rectification or a dispute, never a return to `in_progress`.                                                  | `S`     |
| INV-043 | Every automatic transition — auto-confirmation, expiry, lapse — is attributed to a named system rule with a timestamp.                                                  | `S` `J` |
| INV-044 | Account deletion pseudonymizes a party's display; it never deletes an engagement, a snapshot, evidence or a settlement record.                                          | `S` `P` |

---

## 6. Fulfillment

| #       | Invariant                                                                                                                              | Layer   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| INV-045 | A provider cannot reach `evidence_submitted` on a component without satisfying its resolved **evidence policy**.                       | `S`     |
| INV-045a| Evidence policies resolve from fulfillment type, category, risk level, delivery method and engagement terms. **No evidence requirement is imposed universally regardless of fulfillment type** — specifically not customer OTP on every on-site service, carrier tracking on every physical product, or a platform-uploaded SHA-256 artifact on every digital engagement. | `S` `P` |
| INV-046 | Delivery clocks do not run during `pending_requirements`, during a correction round awaiting buyer input, or during an `admin_hold`.   | `S` `J` |
| INV-047 | **Pickup components and pre-handover workshop components never auto-complete.** A customer's property is never disposed of, and an uncollected item is never recorded as a completed job. | `S` `J` |
| INV-048 | Auto-confirmation fires only where valid evidence is already on file, and always extends the dispute window rather than closing it.    | `S` `J` |
| INV-048a| The auto-confirmation window **starts only on a valid provider fulfillment submission**, and **pauses** on a customer correction request, issue report or dispute. It never runs from activation or scheduling. | `S` `J` |
| INV-048b| At least two reminders, including an explicit warning naming the auto-confirmation moment, precede any inactivity fallback.            | `J`     |
| INV-048c| Configured high-risk cases **escalate to manual review instead of auto-confirming**, with the triggering rule recorded.                | `S` `J` |
| INV-048d| **Auto-confirmation of fulfillment never confirms, creates or advances a settlement record**, never sets coverage, and never clears `settlement_open`. | `S` |
| INV-049 | Made-to-order production cannot start, and its clock cannot run, before a mutually recorded spec confirmation.                         | `S`     |
| INV-050 | A dispute never blocks delivery, evidence upload, scheduling, messaging or settlement reporting. It suspends auto-completion and holds review publication only. | `S` |

---

## 7. Payment and settlement

| #       | Invariant                                                                                                                                                | Layer       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| INV-051 | **Payment proof is not equivalent to confirmed settlement.** Attaching proof never advances a record's state. **(baseline)**                             | `S`         |
| INV-052 | Only `counterparty_confirmed` and `admin_verified` records — **settlement tranches** — count toward verified GMV, net of confirmed refunds. **(baseline)** | `S`       |
| INV-052a| **Fulfillment completion and payment settlement are independent state dimensions.** An engagement may be `completed` while unpaid, partially paid or fully paid, and no completion event may be represented as payment confirmation. | `S` `U` |
| INV-052b| A **provider completion claim alone contributes nothing** to verified GMV. Only a counterparty-confirmed or administratively verified tranche does.       | `S`         |
| INV-052c| Period closing produces an **immutable closing record** per commercial identity — figure, tranche set, tier, expected rent, configuration version, timestamp. Late tranches and reversals produce auditable restatement records and never rewrite it. | `D` `S` `J` |
| INV-052d| Verified GMV is computed **per commercial identity**, never summed across a person's identities and never including procurement-side activity.            | `S`         |
| INV-053 | Settlement confirmation is always an explicit act. **No settlement record is ever confirmed by silence, by a timer, or by any automated inference.**     | `S`         |
| INV-054 | Settlement records are append-only. Reported facts, timestamps and attachments are never edited; corrections are new records.                            | `D` `S`     |
| INV-055 | The price snapshot contains no platform fee line, and the provider's MHC charge never appears on the buyer's breakdown or in the agreed amount.          | `S` `U`     |
| INV-056 | No surface may state or imply that MohandisHub holds, processes, guarantees, refunds or is a party to any engagement payment. The prohibited-claims list in [12 §14](./12-payment-and-settlement.md) is a copy-review checklist. | `P` `U` |
| INV-057 | Payment instructions are snapshotted at activation; a mid-engagement change creates a new version and notifies the buyer prominently.                    | `S` `U`     |
| INV-058 | A verified-GMV restatement is always auditable; the series is never silently changed.                                                                     | `S` `J`     |

---

## 8. MHC

| #       | Invariant                                                                                                                                                     | Layer       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| INV-059 | MHC is non-transferable between any two identities, in any direction, for any reason. **(baseline)**                                                          | `D` `S`     |
| INV-060 | MHC is non-cashable. No withdrawal, conversion, redemption or cash refund path exists, and no surface implies a provider cash balance. **(baseline)**         | `D` `S` `U` |
| INV-061 | Only the provider party is charged for activation. No customer, and no business acting as a buyer, is ever charged MHC. **(baseline)**                        | `S`         |
| INV-062 | Activation is charged from the **accepting commercial identity's own** balance — a BCI's balance for a Business action, a PCI's for a personal one.           | `S`         |
| INV-063 | Charge, engagement creation and D3 disclosure occur in one transaction. Any failure rolls back all three, and no disclosure precedes the committed debit.     | `S`         |
| INV-064 | Activation is idempotent: concurrent or duplicate acceptance of one arrangement produces exactly one charge and one engagement, enforced by locking and a uniqueness constraint. | `D` `S` |
| INV-065 | An inactive, unset or zero-configured activation price **fails the action closed**; it is never treated as free.                                              | `S`         |
| INV-066 | Exactly one activation charge exists per engagement — not per component, revision, delivery, amendment or settlement record.                                  | `D` `S`     |
| INV-067 | A provider's insufficient balance is never disclosed to the counterparty, directly or by inference from a status or timing signal.                            | `A` `S` `U` |
| INV-068 | No enforcement action produces an MHC debit, and no pending arrangement is charged when either party is suspended.                                            | `S`         |
| INV-069 | MHC re-grants occur only on the closed ground list in [13 §9](./13-mhc-activation.md), are credit-only, capped per identity per period, and carry a written rationale visible to the provider. Which grounds are enabled and their caps are configurable; the list is not open-ended. | `S` `P` |
| INV-069a| A re-grant is an **explicit ledger counterentry** referencing the debit it answers. The original debit is never reversed, edited, deleted or netted away.     | `D` `S`     |
| INV-069b| **No time-window refund rule exists** — no grace period after activation, of any duration, returns MHC. Introducing one requires explicit product approval.  | `S` `P`     |
| INV-070 | Proposals are free. No action key may price bidding, proposal visibility, promotion or placement in Wave 3. **(baseline)**                                    | `D` `P`     |
| INV-070a| The activation charge is a **fixed configured amount** resolved by origin, category and action tier. It is **never computed as a percentage of, or banded by, the engagement's negotiated value.** | `S` `D` |
| INV-070b| **Every engagement origin passes through the same activation pipeline.** No origin has an exempt, waived or alternate acceptance path.                        | `S`         |
| INV-070c| Verified-GMV rent runs in **shadow mode**: calculated, recorded as a shadow entry with its inputs, and reported. It **never deducts MHC, never writes an MHC ledger debit, and never blocks an action.** | `S` `J` |
| INV-070d| **No suspension, restriction or enforcement step is triggered by a rent figure**, in shadow mode or otherwise. Enabling live charging is a separate explicit production decision, and enabling rent-driven suspension is a further separate decision. | `A` `S` `P` |
| INV-070e| No provider-facing surface presents a shadow rent figure as a charge, debt, amount due or arrears.                                                            | `U` `P`     |

---

## 9. Reputation

| #       | Invariant                                                                                                                                            | Layer   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| INV-071 | Reviews target a commercial identity. **There is no person-level rating anywhere in the product**, in any API response, export, badge, facet or admin view. | `D` `S` |
| INV-072 | Reputation never crosses an identity boundary: PCI ↔ BCI, BCI ↔ BCI, provider rating ↔ buyer conduct, or **archived PCI ↔ its replacement**.          | `S`     |
| INV-072a| Reviews earned by an archived PCI stay **permanently attached to it** and are never moved, copied, re-pointed or counted toward the replacement. Aggregates are never merged across the boundary. | `D` `S` |
| INV-072b| No market-facing surface links an archived PCI to its replacement — no merged aggregate, "previously traded as", linked-accounts view or profile redirect. | `S` `U` |
| INV-073 | Ranking and recommendation never use one commercial identity's reputation as a signal or cold-start prior for another, **including a replacement PCI seeded from its archived predecessor**. | `S` |
| INV-073a| Star ratings and their aggregates are **never weighted by transaction value** — not by agreed amount, settled amount or verified GMV. Verified settled volume is displayed as its own distinct signal. | `S` `U` |
| INV-074 | A review requires a completed engagement, party status, an open window, and no prior review in that direction.                                       | `D` `S` |
| INV-075 | Auto-confirmed completions are fully review-eligible.                                                                                                | `S`     |
| INV-076 | **No reviews on unactivated or cancelled engagements**, in either direction. Cancellation and reliability behaviour feed objective computed metrics instead. | `S` |
| INV-076a| Reviews unlock from **legitimate fulfillment completion** and from nothing else. Settlement state is not an eligibility condition: a completed engagement with zero confirmed settlement is fully review-eligible. | `S` |
| INV-076b| A **suspicious-review detection pass** runs on every submitted review and routes a recorded signal to moderation. It never hides, removes or de-aggregates a review on its own — a human decides. The scoring algorithm is implementation-configurable. | `S` `J` `P` |
| INV-077 | A review submitted while a dispute is open is accepted and held from publication until the case closes; the window is extended by the hold.          | `S` `J` |
| INV-078 | A review is never removed at the reviewed party's request; only a recorded policy violation removes one.                                             | `A` `P` |
| INV-079 | Reviews and provider responses pass the same redaction and moderation as every other surface.                                                        | `S`     |
| INV-080 | Conditioning a review, its wording, its removal, a settlement or a dispute withdrawal on anything is a violation by either party.                    | `P`     |
| INV-081 | Reliability metrics are computed from recorded events, never authored, and cancellation is always attributed by cause.                               | `S` `J` |

---

## 10. Enforcement

| #       | Invariant                                                                                                                                                                | Layer       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| INV-082 | **Commercial suspension cannot erase existing obligations.** Engagement access, delivery, evidence upload, handover, messaging, settlement reporting and confirmation, dispute participation and appeal all remain available. **(baseline)** | `A` `S` |
| INV-083 | The four survival guarantees — engagement access, delivery access, dispute access, payment evidence access — hold in **every** enforcement state, including termination.  | `A` `S`     |
| INV-084 | A suspended provider holding a customer's property can always complete handover.                                                                                          | `A` `S`     |
| INV-085 | Enforcement never deletes evidence, messages, snapshots, settlement records or case history.                                                                              | `A` `S` `P` |
| INV-086 | Suspension is scoped to a commercial identity; a cross-identity cascade requires an explicit administrative decision with a written rationale on each affected identity.  | `S` `P`     |
| INV-087 | MHC is frozen under suspension, never forfeited. Lifting restores it in full.                                                                                             | `S`         |
| INV-088 | Termination requires that every live engagement is completed, mutually cancelled, or administratively closed with a written determination recording the customer remedy. | `S` `P`     |
| INV-089 | Every enforcement action carries a reason code, a rationale visible to the subject, an attributed decider, and exactly one appeal.                                        | `D` `S`     |
| INV-090 | A counterparty is told what affects them, never the subject's internal enforcement reason.                                                                                | `S` `U`     |
| INV-091 | Automatic enforcement is limited to reversible steps and verification-driven suspension; profile suspension and termination require a human decision.                     | `S` `P`     |

---

## 11. Wave 4 containment

| #       | Invariant                                                                                                                     | Layer   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | ------- |
| INV-092 | No non-owner performs any commercial action for a BCI. Membership is never consulted in **commercial** authorization. Team administration under `manage_team` is outside this and remains available. | `A` `S` |
| INV-093 | No permission is displayed **as effective** that is not enforced. `manage_team` is enforced and may be shown as working; reserved permissions appear only under their reserved label. | `U` `P` |
| INV-093a| No delegated capability is enabled in any commercial domain — services, jobs, bookings, files, conversations, analytics, disputes, advertisements, payment methods, plans or MHC spending. | `A` `S` |
| INV-094 | No engagement or component may be assigned to anyone other than the acting owner; no assignee concept exists.                 | `D`     |
| INV-095 | No branch, sub-entity or second brand exists inside a BCI, and none may be simulated with categories, tags or duplicate offers. | `D` `P` |
| INV-096 | No MHC spend delegation, budget, limit or approval chain exists, even partially.                                              | `A` `S` |
| INV-097 | No cross-BCI aggregation, parent/subsidiary relation, or public linkage of two identities with a common owner.                | `S` `U` |
| INV-098 | Recorded acting-human attribution is never treated as evidence of delegated authority.                                        | `A`     |
| INV-099 | No administrator, API or support tool may buy, sell, accept, activate or otherwise create a commercial obligation on a party's behalf. | `A` `S` |
| INV-100 | Business ownership transfer is not a self-serve action.                                                                       | `A`     |

---

## 12. Pre-activation disclosure regression invariants

Derived from the confirmed Wave 2 conversation-summary disclosure and its correction in
`bc1681b5cee9f772402bc5ba8a5599e161da871d` ([00 §9](./00-overview-and-terminology.md)). The
defect is closed; these are the invariants that keep it closed, and they are **standing
security requirements rather than a one-off fix**.

| #       | Invariant                                                                                                                                                                    | Layer       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| INV-101 | The pre-activation **conversation-list** response carries no D3 field — no email, phone, external handle, exact address or payment instruction — for any participant, in any state. A **regression test** asserts this. | `S` `A` |
| INV-102 | **Locked historical previews stay redacted**, for conversations created before the correction as well as after it. A **regression test** covers the historical path specifically, because that is where the original exposure survived. | `S` `J` |
| INV-103 | The conversation summary serializes from an **explicit allowlisted field contract**, never from a repository row filtered by convention. Repository rows may carry participant data for authorization decisions; only allowlisted fields cross the API boundary. Adding a field is a disclosure decision requiring a tier assignment under [00 §5](./00-overview-and-terminology.md). | `S` `P` |
| INV-104 | **No email fallback anywhere.** No surface substitutes an email address, phone number or other contact identifier where a display name is absent. A missing display name renders a neutral label. | `S` `U`     |
