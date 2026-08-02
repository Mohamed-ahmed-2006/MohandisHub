# H — Payment and Settlement Model

> MohandisHub does not hold, route, hold in trust, escrow, guarantee, disburse or refund
> customer money. It **records what the parties report** and applies an evidence ladder to
> those records. This file defines the ladder, and — just as importantly — the sentences the
> product is and is not allowed to say.

---

## 1. The model in one paragraph

The customer pays the provider directly, by whatever means they agree, off-platform. The
platform's role is to (a) withhold the provider's payment instructions until the provider has
paid to activate the engagement, (b) capture an **agreed amount** and a **payment plan** as
part of the immutable snapshot, (c) accept **settlement records** reported by either party,
(d) run each record up an evidence ladder from *reported* to *counterparty-confirmed* to
*administratively verified*, and (e) count only the top two rungs as **verified GMV**.
Nothing in that chain moves money, and no part of the product may imply otherwise.

---

## 2. When payment instructions become visible

**At D3 and never before** — that is, on successful Engagement Activation, and only to the
counterparty of that engagement.

| Stage                    | Payment-related visibility                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| D0 / D1 (browse)         | Accepted **method types** only: "cash, bank transfer, InstaPay". No handles, no accounts, no numbers                |
| D2 (pending arrangement) | Agreed price and payment-plan **shape** ("50% deposit, 50% on delivery"). No instructions, no account details       |
| **D3 (activated)**       | The provider's **own** payment instructions: account name, bank/InstaPay/wallet identifier, accepted methods, notes |
| After completion         | Instructions remain visible to the parties for the settlement and dispute windows                                   |

Rules:

- Payment instructions are **provider-authored and provider-owned**. The platform relays and
  disclaims them, is not a party to them, and does not verify that the named account belongs
  to the provider beyond the KYC/KYB name match.
- Instructions are **snapshotted onto the engagement** at activation, so a later change does
  not silently redirect an in-flight payment. Changing them mid-engagement creates a new
  version, notifies the buyer prominently, and is a fraud signal worth measuring.
- Any attempt to publish payment details at D0/D1/D2 — in an offer, a profile, a proposal, a
  need reply, an image or a file name — is a gate-bypass violation, not a formatting mistake
  ([13 §10](./13-mhc-activation.md)).
- **No instruction may name MohandisHub as payee**, reference a platform account, or be
  formatted to resemble a platform invoice.

---

## 3. Agreed amount

- Set from the accepted terms at activation and held in the **price snapshot**
  ([10 §5](./10-engagement-model.md)): base + add-ons + travel + delivery + installation −
  discount, in a single currency.
- **Immutable.** It changes only through an accepted **Amendment**, which produces a new
  effective terms version while preserving the original and every intermediate value.
- Contains **no platform fee line**. The platform takes nothing from this money. The
  provider's MHC activation charge is the provider's own cost and must never appear on the
  buyer's breakdown or be described to the buyer as a fee they are funding.
- Is the denominator for **settlement coverage** and the basis for **verified GMV** — but only
  to the extent that settlement records actually reach a counted state. The agreed amount by
  itself is never GMV.

---

## 4. Payment reporting

Either party may create a **Settlement Record** against an engagement.

| Field                | Notes                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| Direction            | `customer_to_provider` (normal) or `provider_to_customer` (a reported refund)               |
| Type                 | `payment` · `deposit` · `instalment` · `refund` · `adjustment`                              |
| Amount and currency  | Must match the engagement currency                                                          |
| Date of the event    | The date money actually moved, which may precede the report                                 |
| Method               | `cash` · `bank_transfer` · `instapay` · `wallet` · `card_in_person` · `cheque` · `other`    |
| Reference            | Free text: transfer reference, receipt number                                               |
| Linked plan item     | Which scheduled deposit/instalment this satisfies, if any                                   |
| **Proof**            | Optional attachment(s) — see §5                                                             |
| Reporter and context | Who reported it, from which acting context, when                                            |
| **State**            | The evidence ladder position — see §6                                                       |

Rules:

- **Cash is a first-class method.** A large share of craftsman work is settled in cash, and a
  model that only recognises transfers would make its own GMV data useless.
- Reporting is possible **at any time**, including before completion, after completion, and
  after cancellation.
- Records are **append-only**. A mistaken record is corrected by a new record (an
  `adjustment` or a withdrawal), never by editing the reported facts.
- Over-reporting beyond the agreed amount is permitted but flagged (`coverage = over`), because
  the honest explanation — an off-snapshot extra — is also the dishonest one.

---

## 5. Payment proof

**Proof is evidence. It is not confirmation, and it never self-verifies.** This is a baseline
rule and the most important sentence in this file.

- Accepted forms: transfer screenshots, bank receipts, InstaPay confirmations, photographed
  cash receipts, signed handover notes.
- Proof is attached to a settlement record, is visible to both parties and to administrators,
  and is retained beyond the dispute window.
- **The platform performs no authentication of proof.** It does not parse it, does not verify
  it against a bank, does not OCR it into a truth claim, and does not advance a record's state
  because a file was attached. A screenshot is trivially forged and the product must behave as
  if every one might be.
- A record **with** proof and a record **without** proof sit at the same rung until a human
  moves them. Proof only changes what a *counterparty* or an *administrator* can see when
  deciding.
- Proof containing contact details is normal and acceptable at D3, since the gate is already
  open; proof is never surfaced at any lower tier.

---

## 6. The evidence ladder

```
reported ──counterparty confirms──▶ counterparty_confirmed ──admin reviews──▶ admin_verified
   │                                        │                                       │
   ├──counterparty rejects──▶ rejected      └──either party disputes──▶ disputed ◀───┘
   │
   └──reporter withdraws──▶ withdrawn
```

| State                    | Meaning                                                                                  | Counts toward verified GMV |
| ------------------------ | ------------------------------------------------------------------------------------------ | -------------------------- |
| `reported`               | One party says it happened. Nothing else is known                                        | **No**                     |
| `counterparty_confirmed` | The other party agreed it happened, in the stated amount, on the stated date             | **Yes**                    |
| `admin_verified`         | An administrator reviewed the record and its evidence and affirmed it                    | **Yes**                    |
| `disputed`               | Either party contests it, or it is attached to an open case about the money              | **No**                     |
| `rejected`               | The counterparty denies it                                                               | **No**                     |
| `withdrawn`              | The reporter retracted it                                                                | **No**                     |

Rules:

- Only `counterparty_confirmed` and `admin_verified` count. A record in either state is a
  **settlement tranche** — the only unit that feeds verified GMV. This is the baseline rule and
  is the sole definition of verified GMV in the product.
- **Confirmation is an explicit act**, never inferred from silence. There is no
  auto-confirmation of money, ever — unlike fulfillment, where inactivity fallback exists.
  Completion can be presumed from silence because the platform holds evidence of the work;
  payment cannot, because it holds nothing.
- **Auto-confirmed fulfillment does not auto-confirm payment**, and a completed engagement is
  not evidence that money moved. A **provider's completion claim alone contributes nothing** to
  verified GMV — only a counterparty-confirmed or administratively verified tranche does
  ([11 §1.1](./11-fulfillment-models.md)).
- **Payment proof is evidence, never confirmed settlement.** Attaching a file to a record moves
  it nowhere on this ladder (§5).
- A record may move down the ladder (a confirmed record later disputed) and the GMV series
  must be **restatable**, with the restatement visible rather than silent.
- `admin_verified` is for dispute resolution and sampling, not for routine processing. It does
  not scale and must not be designed as if it will.

---

## 7. Deposits, partial payments and instalments

The **payment plan** is part of the snapshot and declares expectations; the settlement records
declare reality. They are separate on purpose, and the gap between them is a product signal.

| Plan shape          | Structure                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `single`            | One expected amount, one trigger                                                                |
| `deposit_plus_balance` | A deposit (amount or percentage) with a trigger, plus the balance with a trigger             |
| `instalments`       | N scheduled items, each with an amount and a trigger. The sum must equal the agreed amount      |

Triggers: `on_activation`, `on_spec_confirmation`, `on_scheduling`, `on_delivery`,
`on_completion`, `on_date`.

- **Deposits matter most for made-to-order and materials-heavy work**, where the provider
  legitimately funds production. The natural trigger there is spec confirmation
  ([11 §7](./11-fulfillment-models.md)).
- **Partial payment is the normal state, not an error.** Each settlement record may satisfy a
  plan item in whole or in part.
- **Coverage** is derived per engagement from confirmed and verified records only:

  | Coverage   | Condition                                                    |
  | ---------- | -------------------------------------------------------------- |
  | `none`     | No counted records                                            |
  | `partial`  | Counted total > 0 and < agreed amount                         |
  | `full`     | Counted total ≈ agreed amount, within a rounding tolerance    |
  | `over`     | Counted total > agreed amount — flagged, not blocked          |

- Coverage is displayed to both parties throughout, and the `settlement_open` overlay stays on
  the engagement until coverage is `full`.
- **The platform enforces no payment schedule.** It reminds, it records, and it makes the gap
  visible. It does not withhold, penalise or collect — it has nothing to withhold.

---

## 8. Counterparty confirmation

- When one party reports, the other is notified and asked to **confirm, reject or dispute**,
  with reminders.
- Confirming is a positive act with a clear statement of what is being confirmed: the amount,
  the date, the method, and that the money actually moved.
- Rejecting requires a reason and immediately raises the record's visibility; repeated
  unexplained rejection is an enforcement signal on the rejecting party.
- **Silence is not confirmation.** A record left unanswered stays `reported` indefinitely and
  is visible to both parties as unconfirmed. It never ages into a counted state.
- Both directions matter: a provider confirming a customer's reported payment is the common
  case, but a customer confirming a provider's reported receipt is equally valid and is often
  the faster path for cash.

---

## 9. Administrative verification

- An administrator may set `admin_verified` or `rejected` on a record after reviewing it and
  its evidence, always with a written rationale that both parties can read.
- Used for: dispute resolution, fraud investigation, sampling to keep the GMV series honest,
  and unblocking a stalemate where one party is unresponsive and the other has strong evidence.
- Administrators **cannot** create a settlement record on the parties' behalf, cannot alter a
  record's reported facts, and cannot move money. They rule on records; they do not author
  reality.
- Every administrative state change is attributed, timestamped, rationale-bearing and
  appealable once.

---

## 10. Disputed payments

- Either party may mark a record `disputed`, which links or opens a **Case**.
- A disputed record **does not count** toward verified GMV, and if it was previously counted,
  the series is restated.
- A payment dispute **does not stop fulfillment**. The `disputed` overlay suspends
  auto-completion and holds review publication; delivery, evidence, scheduling and messaging
  continue ([10 §9](./10-engagement-model.md)).
- Resolution outcomes: the record is verified, rejected, superseded by a corrected record, or
  left unresolved with a written determination. Unresolved is a legitimate outcome and must be
  representable — the platform cannot always know.
- **No dispute outcome moves money.** Determinations may find facts, enforce, adjust
  reputation and re-grant MHC. They may not order or promise a payment or a refund.

---

## 11. Cancelled engagements and off-platform refunds

- **Confirmed settlements survive cancellation.** A deposit paid before a cancellation remains
  a confirmed record; cancellation does not void payment history.
- A cancelled engagement retains its agreed amount, its settlement records and its coverage,
  and is clearly marked cancelled in every view.
- **Refunds are off-platform events that the parties report**, as a settlement record with
  direction `provider_to_customer` and type `refund`. They run the same ladder: reported →
  confirmed → verified.
- A confirmed refund **reduces the net settled total** for that engagement and correspondingly
  reduces verified GMV. Net, not gross, is the figure any future commercial model uses.
- **The platform never executes, guarantees, mediates or compels a refund.** It has no funds
  to return and no mechanism to return them. A cancelled engagement with a confirmed deposit
  and no confirmed refund is a visible, honest state — not a bug to be closed by a
  platform-side reversal.
- Whether a refund is owed at all is a matter between the parties and, at most, a finding in a
  case. The product must not present a refund as something it can arrange.

---

## 12. Verified GMV

**Definition, and the only one:**

> Verified GMV over a period = the sum of settlement records in `counterparty_confirmed` or
> `admin_verified` state, direction customer→provider, **net of** confirmed or verified
> refunds, attributed to the provider commercial identity, in the engagement's currency.

Rules:

- Attribution is to the **provider commercial identity**, never to the person across their
  identities, and never to a business's procurement side.
- `reported`, `disputed`, `rejected` and `withdrawn` amounts are **never** included, and must
  never be shown adjacent to a verified figure without a distinct label.
- Restatement is expected and must be visible: a confirmed record later disputed reduces the
  series, and the change is auditable rather than silent.
- Verified GMV is the basis for **tiered monthly MHC rent**, which is precisely why nothing
  weaker may ever be allowed to inflate it. Every shortcut that lets an unconfirmed number into
  this series destroys the model that depends on it.
- Verified GMV bands may drive **provider badges**; the raw figure of one provider is never
  shown to another party.

---

## 12A. Period closing, tiers and expected rent

Wave 3 builds the **full measurement and calculation chain** for the verified-GMV commercial
model. It does **not** charge on it — see [13 §11](./13-mhc-activation.md) for the shadow-mode
rule that governs what happens with the number.

### 12A.1 What Wave 3 delivers

| Capability                     | Definition                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Settlement evidence**        | The ladder in §6, complete, with proof handling per §5                                                                        |
| **Settlement tranches**        | Records in `counterparty_confirmed` or `admin_verified`, the only counted unit                                                |
| **Verified-GMV calculation**   | Per §12, per provider commercial identity, net of confirmed refunds, in the engagement currency                                |
| **Period closing**             | A named accounting period per identity, closed on a schedule, producing an immutable closing figure (§12A.2)                  |
| **Tier calculation**           | The closed figure resolved against an admin-configurable tier table                                                           |
| **Expected-rent calculation**  | The MHC amount the resolved tier *would* charge for that period                                                               |
| **Admin reporting**            | Per-identity and aggregate reporting across all of the above, including restatement history                                   |

### 12A.2 Period closing

- A period is scoped to **one provider commercial identity** — a PCI or a single BCI. There is
  no person-level and no cross-BCI period.
- Closing computes verified GMV from the tranches whose **event date** falls in the period,
  not their report date — money is attributed to when it moved.
- A closed period produces an **immutable closing record**: the figure, the tranche set that
  produced it, the tier resolved, the expected rent, the configuration version in force, and
  the closing timestamp.
- **Late tranches and restatements do not rewrite a closed period.** A tranche confirmed after
  closing, or a confirmed tranche later disputed, produces an **auditable restatement record**
  against the affected period, carrying the delta and its cause. The original closing record
  survives unchanged.
- Restatement is expected, normal and visible. Silent restatement is prohibited
  ([17](./17-product-invariants.md), INV-058).

### 12A.3 Tier and expected-rent calculation

- The **tier table** maps verified-GMV bands to a monthly MHC rent amount. Bands, amounts,
  currency basis and the number of tiers are **admin-configurable values**.
- **Rent is tiered, not proportional.** It is a band-derived amount, never an uncapped
  percentage of GMV, and never a percentage that varies continuously with volume.
- **Expected rent is a calculation, not a charge.** In Wave 3 it is computed, recorded and
  reported, and it deducts nothing ([13 §11](./13-mhc-activation.md)).
- The calculation is reproducible: given the closing record and the configuration version, the
  expected-rent figure must be re-derivable exactly.

### 12A.4 What this must not become

- **No value-based engagement activation charge.** The activation charge stays fixed per
  configured action key. Making activation value-based would give providers a direct incentive
  to under-declare the agreed amount, corrupting the settlement data this entire chain depends
  on ([13 §3](./13-mhc-activation.md)).
- **No inflation of the series.** `reported`, `disputed`, `rejected` and `withdrawn` amounts
  never enter it, and no completion event, provider claim or proof file may advance a record
  into a counted state.
- **No cross-identity aggregation.** A person's PCI and their BCIs each close their own
  periods, and the figures are never summed
  ([09 §6](./09-business-buying-and-providing.md), B9).
- **No procurement-side counting.** A Business's buying is never verified GMV
  ([09 §1](./09-business-buying-and-providing.md)).

---

## 13. What MohandisHub may truthfully claim

Permitted statements, and the shape of the language:

- "The provider reported a payment of X on this date." *(reported)*
- "Both parties confirmed a payment of X on this date." *(confirmed)*
- "MohandisHub reviewed the submitted evidence and verified this record." *(verified —
  meaning a human read it, nothing more)*
- "This engagement's agreed amount is X; confirmed settlement covers Y of it."
- "This provider has verified settled volume in band Z over the last 12 months."
- "Payment is made directly between you and the provider. MohandisHub does not hold, process
  or guarantee it."
- "This record is unconfirmed. Only the reporting party has stated it."
- "We could not determine what happened." *(a legitimate, necessary outcome)*

---

## 14. What MohandisHub must never claim

Prohibited statements and prohibited implications, in copy, UI, notifications, receipts,
emails, badges, support responses and dispute determinations:

1. That it **holds, escrows, safeguards or protects** any customer funds.
2. That it **guarantees, insures or underwrites** payment, delivery or quality.
3. That it will **refund, reverse, charge back or compensate** — it has nothing to refund with.
4. That it has **processed, received, transferred or disbursed** a payment.
5. That a **proof document is authentic**, or that attaching one proves payment.
6. That a **`reported` record is a payment**, or presenting reported totals as revenue,
   earnings, GMV or income.
7. That **`admin_verified` means legally certified, audited, or bank-confirmed.** It means a
   MohandisHub administrator read the evidence and formed a view.
8. That a **dispute determination compels payment** or constitutes a legal ruling, judgment,
   arbitration award or enforceable order.
9. That a provider is **owed money by MohandisHub**, or that any balance, wallet or credit
   represents money the platform will pay out. MHC is not money and never becomes money.
10. That the **contact gate prevents** off-platform dealing — it raises friction; it is not a
    wall (`KNOWN_LIMITATIONS.md` L1.3).
11. That a **completed engagement was paid for**, that completion implies settlement, or that
    an **auto-confirmed** fulfillment confirms payment. Completion and settlement are
    independent state dimensions ([10 §10](./10-engagement-model.md)), and an engagement may be
    completed while unpaid, partially paid or fully paid.
12. That an **invoice or receipt issued by the platform is a tax document, a legal invoice, or
    a demand for payment**. Platform documents are records of what the parties reported, and
    must be labelled as such.
13. That the platform is a **party to, agent of, or intermediary in** the payment arrangement.

Every one of these should exist as a copy-review checklist item and, where mechanically
checkable, as a test.
