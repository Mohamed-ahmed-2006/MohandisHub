# K — Suspension and Enforcement

> **Enforcement stops future harm. It never strands an existing obligation.** Every
> restriction in this file is scoped so that work already sold can be delivered, evidence can
> be uploaded, money can be reported, and disputes can be fought — by both parties, in every
> state, including termination.

---

## 1. Two independent axes

Wave 3 has **two orthogonal suspension axes**, plus a graded ladder around them. Conflating
them is the mistake that breaks the baseline rule.

| Axis                       | Scope                                | Stops                                             | Never stops                                    |
| -------------------------- | ------------------------------------ | ------------------------------------------------- | ---------------------------------------------- |
| **Commercial suspension**  | One **commercial identity** (PCI or BCI), and for a BCI optionally one surface | Creating **new** commercial activity | Fulfilling existing obligations                |
| **Profile suspension**     | Public presence of a commercial identity or the account | Being **found**                        | Existing engagement access                     |

They compose. A commercial identity can be commercially suspended without being hidden
(offers hidden, profile still reachable by an existing counterparty), profile-suspended
without being commercially suspended (rare — used for a moderation problem in profile content
while trading continues), or both.

---

## 2. The enforcement ladder

| Step | Action                     | Typical trigger                                                                    | Reversible |
| ---- | -------------------------- | ------------------------------------------------------------------------------------ | ---------- |
| 1    | **Warning**                | First-instance policy breach; contact leakage caught by redaction                  | n/a        |
| 2    | **Feature restriction**    | Repeat leakage, quota abuse, spam, high lapse rate                                 | Yes        |
| 3    | **Content action**         | Offer rejected, review hidden, media removed, need unpublished                     | Yes        |
| 4    | **Commercial suspension**  | Confirmed bypass attempt, fraud signal, verification lapse, serious conduct finding| Yes        |
| 5    | **Profile suspension**     | Public-content violation, impersonation, escalated conduct finding                 | Yes        |
| 6    | **Termination**            | Fraud, identity abuse, harvesting, systematic bypass, sanctions                    | Rarely     |

Every step: has a **reason code and written rationale visible to the subject**, is
**attributed** to an administrator or a system rule, is **time-bounded or condition-bounded**
(a suspension states what would lift it), and is **appealable once** through the Help &
Resolution Center.

**Automatic enforcement is limited to reversible steps 1–3** plus a narrow set of
verification-driven step 4 cases (lapsed KYC/KYB/credential). Steps 5 and 6 require a human
decision with a rationale. A system that can silently terminate a livelihood on a heuristic is
not acceptable.

---

## 3. Profile suspension

**What it does:** removes a commercial identity's public presence.

| Surface                        | Effect                                                                 |
| ------------------------------ | ------------------------------------------------------------------------ |
| Search, browse, recommendations| Removed                                                                |
| Direct profile link            | **404 / not available** to everyone except the owner and administrators |
| Published offers               | Hidden (see §5)                                                        |
| Reviews **authored** by the identity | Hidden pending review                                            |
| Reviews **received**           | Retained; hidden with the profile, restored on lift                    |
| Existing counterparties        | **Retain full engagement access**, including the counterparty's identity snapshot |
| Notifications                  | Continue for existing engagements and cases                            |

Profile suspension does **not** by itself block commercial actions on existing engagements. It
blocks being found.

---

## 4. Commercial suspension

**What it does:** stops the creation of new commercial activity by that commercial identity.

**Blocked:**

- Publishing or resuming offers, packages, products, variants.
- Submitting proposals; answering quote requests; sending custom proposals.
- Accepting any arrangement — **no activation, therefore no MHC charge and no new disclosure**.
- Creating Needs, quote requests, purchase/booking/product requests, or awarding (buyer-side
  suspension).
- Purchasing MHC.

**Explicitly not blocked — the baseline rule, itemized:**

| Capability                                             | Available under commercial suspension |
| ------------------------------------------------------ | -------------------------------------- |
| Viewing existing engagements and their snapshots       | ✅                                     |
| Messaging the counterparty on an existing engagement   | ✅                                     |
| Scheduling, rescheduling, arrival check-in             | ✅                                     |
| Uploading deliverables and all fulfillment evidence    | ✅                                     |
| Marking completion, handling revisions, rectification  | ✅                                     |
| **Handover of a customer's property**                  | ✅ — always, without exception         |
| Confirming receipt, requesting revision (buyer side)   | ✅                                     |
| Reporting and confirming settlements; attaching proof  | ✅                                     |
| Opening, answering and appealing cases                 | ✅                                     |
| Submitting a review and responding to one              | ✅                                     |
| Reading own analytics and history                      | ✅                                     |
| Being paid directly by the customer                    | ✅ — the platform was never involved   |

**MHC under commercial suspension:** the balance is **frozen, not forfeited**. It cannot be
spent (there is nothing to spend it on) and cannot be topped up. Lifting the suspension
restores it in full. Forfeiting prepaid credit as a penalty would be a fine, which this
product does not levy, and would convert enforcement into revenue — a corrupting incentive.

**Verified-GMV rent is not an enforcement trigger in Wave 3.** Monthly verified-GMV rent runs
in **shadow mode** ([13 §11](./13-mhc-activation.md)): it is calculated and recorded, and it
deducts nothing. Consequently:

- **No suspension, restriction, offer hiding or ladder step may be triggered by a rent figure**
  — not by an expected charge, not by a shadow entry, not by an insufficient balance measured
  against one.
- A rent figure is never an arrears balance, and no enforcement notice may describe it as one.
- Enabling rent-driven commercial suspension requires the same **explicit production activation
  decision** that live charging requires, and is not implied by it — deciding to charge is not
  the same as deciding to suspend for non-payment, and each needs its own answer.

A provider's enforcement state in Wave 3 is a function of conduct and verification. It is never
a function of what they owe, because in Wave 3 they owe nothing.

**Recruitment outcomes are not an enforcement input either.** A rejected job application, a
withdrawn candidacy or a failed interview is **not** a conduct finding and produces no ladder
step, no restriction and no reputation change
([14 §12](./14-reviews-and-reputation.md)). Recruitment *conduct* — a fraudulent vacancy,
abusive applications, harassment — is enforceable in the ordinary way under §2, against the
acting identity, on the same evidence standard as any other conduct finding.

---

## 5. Offer hiding

| Cause                                      | Resulting state | Restores to                        |
| ------------------------------------------ | --------------- | ---------------------------------- |
| Owner pauses                               | `paused`        | Owner resumes                      |
| Commercial suspension                      | `hidden`        | Previous state on lift             |
| Lapsed V2 in a credential-required category| `hidden`        | Previous state on re-verification  |
| Lapsed KYB                                 | `hidden`        | Previous state on re-verification  |
| Moderation takedown                        | `hidden`        | Requires resubmission and review   |
| Concurrent-engagement cap reached          | `paused` (auto) | Automatically, as capacity frees   |

Rules ([06 §8](./06-offer-model.md)):

- `hidden` returns **not-found** on direct links; `paused` keeps the link with a "not currently
  accepting" state. The difference is owner-choice versus enforcement, and the owner must be
  able to tell which they are in and why.
- **Hiding never touches live engagements.** Offers govern the creation of new arrangements
  only.
- Reviews on a hidden offer are retained and restored on lift.
- Lifting restores the **previous** state, not always `published` — an offer that was paused
  before it was hidden returns to paused.

---

## 6. Restrictions on proposals and bookings

| Restriction                    | Effect                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| **Proposal quota reduction**   | Fewer free proposals per period; existing live proposals unaffected                |
| **Proposal block**             | No new proposals; live proposals may be **withdrawn** but not awarded              |
| **Booking block**              | Slots removed from discovery; pending booking requests are declined without charge |
| **Category restriction**       | Blocked from specific categories (e.g. credential lapse) while others continue     |
| **Area restriction**           | Blocked from specific service areas after repeated out-of-area cancellations       |
| **Buyer-side request block**   | No new Needs, quote requests or purchase/booking/product requests                  |

Rules:

- **Pending intents are resolved without charging anyone.** When a provider is suspended with
  awards pending activation, those **pre-activation intent objects** are declined, the buyer is
  notified with a neutral reason, and **no MHC is charged and no Engagement is created**
  ([10 §7](./10-engagement-model.md)). A suspension must never produce a debit.
- A restriction on the provider side must not silently harm the buyer: a buyer whose awarded
  provider is suspended is notified, may re-award immediately, and their Need's window is
  extended.
- Restrictions state their **duration or lifting condition** in the notice.

---

## 7. Existing engagement access, delivery, disputes and evidence

The four guarantees that survive **every** enforcement state, including termination:

1. **Engagement access.** Both parties can open the engagement, read the snapshots, the
   history, the messages and the evidence. Snapshots are never redacted by enforcement, and a
   suspended counterparty's identity snapshot stays visible to the other party — they contracted
   with a named person or company and do not lose that record because that party was punished.
2. **Delivery access.** Every fulfillment action remains available: scheduling, arrival,
   evidence upload, completion, revision, rectification, handover, receipt confirmation. Work
   already sold gets finished.
3. **Dispute access.** Cases can be opened, answered, evidenced and appealed. A terminated
   identity retains the ability to participate in cases concerning its past engagements —
   otherwise termination becomes a way to escape adjudication, and the counterparty loses their
   remedy along with the offender.
4. **Payment evidence access.** Settlement records can be created, confirmed, rejected and
   evidenced; proof can be uploaded and read. Enforcement must never destroy or hide the
   financial record — it is the only record either party has, and hiding it converts a
   resolvable dispute into an unresolvable one.

Corollary: **enforcement never deletes evidence, messages, snapshots or settlement records.**
Hiding is scoped to public discovery surfaces, never to the parties' own record.

---

## 8. Customer remedy protection

When enforcement lands on a provider, the customer must not absorb the cost.

| Situation                                            | Remedy                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Provider suspended with an award pending activation  | The **intent** is declined, no charge, no Engagement created, buyer notified, Need returns to `open` with an extended window and previous respondents re-invited |
| Provider suspended with a live engagement            | Buyer notified with a neutral, factual statement; buyer may continue, may cancel without conduct penalty, and may open a case |
| Provider terminated with live engagements            | Engagements are administratively reviewed and closed with a written determination; the buyer's Need is re-postable at no cost |
| Provider unresponsive in a case after suspension     | The case proceeds; the determination records the non-participation, and reputation and enforcement reflect it |
| Buyer suspended with a live engagement               | The **provider keeps every fulfillment and settlement capability**, and the buyer retains the ability to confirm, report, dispute and appeal — a buyer penalty must never become a provider penalty |
| Either party's account closed                        | Display pseudonymizes; the engagement, snapshots and evidence survive for the counterparty     |

The platform's honest limit applies throughout: it can notify, re-open, determine, enforce and
re-grant MHC. **It cannot return the customer's money**, because it never held it
([12 §14](./12-payment-and-settlement.md)), and no remedy notice may imply otherwise.

---

## 9. Cross-identity cascade

Enforcement is scoped to a **commercial identity** by default.

- Suspending a person's PCI does **not** suspend a Business they own, and vice versa.
- Suspending a Business's **sales** surface does not suspend its **procurement** surface.
- Suspending a commercial identity does **not** remove the person's universal customer
  capability.

A **cascade to every identity a person controls** is permitted only for findings against the
*person*: identity fraud, document forgery, sanctions, systematic gate bypass across
identities, or multi-account evasion. A cascade must be an explicit administrative decision
with a written rationale, recorded against each affected identity, and appealable once. It is
never an implicit side effect of a single-identity action.

Multi-account evasion — creating a new identity or Business to escape enforcement — is itself
a terminating offence, and detection of it is a cascade trigger.

### 9.1 PCI conversion is not an escape route

Converting a Personal Commercial Identity ([00 §3.5](./00-overview-and-terminology.md)) archives
a source identity and creates a replacement at zero reputation. That shape makes it an obvious
candidate for evasion, so it is closed explicitly.

**Conversion must not be usable to evade** commercial suspension, disputes, poor reputation,
settlement review, verified-GMV obligations, rent obligations, or any enforcement action.

| Control                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- |
| Conversion is **rejected** while an **active commercial suspension investigation** is open where conversion could evade enforcement |
| Conversion is **rejected** while any open dispute, resolution case, appeal, unresolved settlement issue or other unresolved commercial obligation exists ([00 §3.5.2](./00-overview-and-terminology.md)) |
| Conversion is **Admin/Support-executed**, so no subject of an enforcement action can initiate one against themselves       |
| **There is no administrative override** of a blocker — an operator may execute a conversion that already passed every eligibility check, and may not convert around a live obligation or use conversion to resolve an enforcement matter |
| **Enforcement state is not cleared by conversion.** Enforcement history, reason codes, appeals and their outcomes remain on the account and on the archived identity |
| Reviews, ratings and reliability metrics **stay permanently with the archived PCI**, so a poor record cannot be shed       |
| The archived and replacement identities are **linked by an immutable audited conversion record** available to administrators |
| Enforcement against the **person** cascades to every identity they control, including a replacement PCI (§9)               |

The design intent is symmetrical with the rest of this file: a provider who genuinely changed
trades keeps their credit and loses their reputation, which is the honest trade. A provider
trying to outrun a case cannot start the process at all.

---

## 10. Appeals

- **One appeal per enforcement action**, filed through the Help & Resolution Center, available
  in every state including termination.
- The appeal is reviewed by someone other than the deciding administrator where the action was
  discretionary.
- Filing an appeal does **not** automatically lift the action; an administrator may stay a
  reversible action pending review.
- The outcome is written, states the reason, and is recorded on the enforcement history.
- Wrongful enforcement that cost a provider MHC is an explicit **re-grant ground**
  ([13 §9, ground G6](./13-mhc-activation.md)).

---

## 11. Termination

The only genuinely terminal state, and the most constrained.

**Preconditions.** A commercial identity may be terminated only when every live engagement has
been completed, mutually cancelled, or **administratively closed with a written determination
that records the customer remedy**. Terminating with open obligations and no determination is
prohibited — it converts an enforcement decision into an unremedied customer loss.

**Effects.** No new activity of any kind; public presence removed; offers archived; MHC
balance closed with **no cash value, no refund and no transfer** (this is not a penalty, it is
what non-cashable credit means).

**What survives.** Engagement records, snapshots, evidence, settlement records, reviews
received (retained, display may be adjusted by moderation), case participation for past
engagements, and the appeal right.

**What is prohibited.** Deleting engagements, evidence, settlement records or case history as
part of termination — including in response to an account-deletion request. Such requests are
satisfied by **pseudonymizing the display** while preserving the counterparty's ability to
evidence the transaction ([10 §14](./10-engagement-model.md)).

---

## 12. Enforcement transparency

- Every action is **logged, attributed and timestamped**, with the triggering rule or the
  deciding administrator.
- The subject can read their own enforcement history and the rationale for each entry.
- Counterparties are told **what affects them** — that a provider is unavailable, that an
  arrangement was declined — and **not** the internal reason, which is the subject's private
  matter.
- Aggregate enforcement metrics (actions by reason, appeal overturn rate, re-grant volume by
  ground) are monitored, because a rising overturn rate means the automated rules are wrong and
  a rising re-grant rate means abuse controls are failing.
