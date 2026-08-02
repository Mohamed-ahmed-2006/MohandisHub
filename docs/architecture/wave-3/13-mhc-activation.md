# I — MHC Activation Model

> **Engagement Activation is the business.** It is the moment a provider pays to accept work,
> the moment protected information is disclosed, and the only place MohandisHub earns in
> Wave 3. Every other design decision in this document set either feeds this gate or protects
> it.

---

## 1. What MHC is

- **Closed-loop, provider-side platform credit.** Purchased with money; spendable only on
  platform actions.
- **Non-transferable** between identities, in any direction, for any reason — not from a
  person to their Business, not between two Businesses with the same owner, not as a gift, not
  as a sale, not on dissolution. There is **no user-accessible transfer capability of any
  kind**, and no surface through which one could be invoked.

  The **single** exception is not a transfer feature: the audited MHC carryover inside an
  Admin/Support-executed **PCI conversion** (§1.1). It is operator-executed, scoped to one
  person's one PCI slot, and empties the source in the same transaction that funds the
  replacement.
- **Non-cashable.** No withdrawal, no conversion, no redemption, no refund to money. There is
  no provider cash balance anywhere in the product and no screen may imply one.
- **Held per commercial identity**, not per person: a PCI has its own balance, each BCI has
  its own, and no user-invocable movement between them exists in either direction. This is what
  makes non-transferability enforceable by construction rather than by policy, and what makes
  per-identity cost analytics — the input to the tiered-rent model — meaningful at all.
  Existing balances stay with the personal identity's PCI; every Business starts at zero
  ([18 §3](./18-decisions-required.md)). A PCI's balance follows its **PCI slot** through an
  audited conversion (§1.1), and never crosses to a Business or to another person.
- **Not an asset the platform owes.** MHC is a prepaid entitlement to platform actions, and
  every surface must describe it that way.

Customers hold no MHC, ever, and no customer-facing surface mentions a balance.

### 1.1 MHC carryover during PCI conversion

The one lifecycle operation that moves MHC between two commercial identity records. The full
conversion model is [00 §3.5](./00-overview-and-terminology.md); this section states the
**ledger** rules.

**MHC is not forfeited and not permanently frozen by a valid conversion.** The provider paid for
that credit, and a conversion is not a penalty.

**What the operation does:**

```
Admin/Support executes conversion (all eligibility checks already passed)
   ├─ resolve the source PCI's AVAILABLE balance          ─┐
   ├─ debit the source to a zero available balance         │
   ├─ credit the replacement with EXACTLY that amount      ├── ONE TRANSACTION
   ├─ archive the source PCI                               │
   ├─ create the replacement PCI                           │
   └─ write the immutable conversion audit record         ─┘
```

**Ledger rules:**

| Rule                          | Statement                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Conservation**              | No MHC is created, destroyed or duplicated. The sum across both identities is unchanged by the operation             |
| **Never doubly spendable**    | The source and the replacement can **never** both spend the same credits. The source ends at zero available balance  |
| **Source cannot spend after** | Once conversion commits, the archived PCI can spend nothing — it holds no available balance and can activate nothing |
| **Exactly once**              | **Idempotent.** A re-run, retry or double submission produces one carryover, enforced by locking and a uniqueness constraint on the conversion |
| **Atomic**                    | Carryover, archival and replacement creation commit together. Any failure rolls back all of them and leaves the source enabled with its balance intact |
| **History preserved**         | The source's ledger is **never deleted, rewritten or re-pointed**. Every historical MHC transaction — purchases, activation charges, re-grants — **remains attributable to the archived PCI** |
| **Append-only**               | The carryover is recorded as ledger entries on both sides referencing the conversion event, in the same append-only manner as a re-grant counterentry (§9.0) |
| **Available balance only**    | Only the remaining **available** balance carries                                                                     |

**Non-available credits.** Pending, reserved, disputed, reversed or otherwise non-available
credits are **never silently treated as available balance**. Each category carries an explicit
ledger rule — resolve before conversion, settle before conversion, remain on the source, or
block the conversion — and the rule applied is recorded on the conversion record. Where the
available balance cannot be determined unambiguously, **the conversion does not proceed**.

**What this is not.** It is not a transfer feature and nothing reusable may be built from it:

- **No user can invoke it.** It exists only inside an Admin/Support-executed conversion.
- It must **not** enable movement between arbitrary personal identities, between Business
  identities, between users, or between any two commercial identities that are not a conversion
  source and its own replacement.
- It creates **no general MHC transfer interface**, no partial-move capability, and no
  discretionary amount — the amount is the available balance, computed, not chosen.

**Audit.** The conversion record identifies the source PCI, the replacement PCI, the
user/account owner, the amount moved, the original ledger balance, the conversion event, the
Administrator or Support actor, the timestamp and the reason. It is immutable.

---

## 2. Which commercial actions require activation

**Exactly one class of action: accepting an arrangement.** One gate, five origin keys, so
pricing can differ without inventing a second mechanism.

**Every engagement origin passes through the same activation pipeline.** There is no origin
with a separate acceptance path, a separate charging rule, or an exemption — the survey→custom
order chain ([08 §2](./08-craftsman-storefront.md)) charges at each of its two activations like
any other pair of engagements.

| Action key                     | Triggered when a provider accepts…            | Charged to                     |
| ------------------------------ | ----------------------------------------------- | ------------------------------ |
| `activation.need_award`        | An awarded proposal on a Need                  | The accepting provider identity |
| `activation.service_purchase`  | A direct package/service purchase request      | The accepting provider identity |
| `activation.booking`           | A slot booking request                         | The accepting provider identity |
| `activation.product_request`   | A product order request                        | The accepting provider identity |
| `activation.custom_order`      | A buyer's acceptance of a Custom Proposal      | The accepting provider identity |

**Price resolution** may additionally vary by **category** and by **configured action tier**
within an origin — a low-value local-trade category priced differently from a regulated
engineering one, or a post-survey custom order priced as its own tier. Resolution is a lookup
against admin configuration: origin → category → tier → price. What varies is *which configured
price applies*, never *how the price is computed from the engagement's value* (§3).

**Free in Wave 3, and deliberately so:**

- Registration, enablement, KYC and KYB.
- Publishing, editing, pausing and archiving offers, packages, products and variants.
- **Submitting proposals.** Paid bidding is not approved; quota is the only scarcity mechanism
  ([05 §3](./05-need-model.md)).
- Sending custom proposals and answering quote requests.
- Messaging, delivery, evidence upload, revisions, rectification, settlement reporting,
  disputes, appeals, reviews and responses.
- Amendments to a live engagement ([10 §6](./10-engagement-model.md)).
- Everything the customer does, without exception.

**Not in Wave 3** — advertisements, service promotion, featured placement, promoted proposals
and paid plans are all separately unapproved or frozen by `LAUNCH_CONSTRAINTS.md` LC-01/LC-02
and must not be wired to this gate ([16 group 3](./16-wave-3-scope.md)).

---

## 3. Who pays, and how much

- **Always the provider.** Never the customer, in any origin, for any party type.
- **A business buyer pays nothing.** Being an organization does not move the charge; the
  accepting provider still pays.
- Charged to the **accepting commercial identity's own balance**: a PCI's balance for a
  personal provider, the BCI's balance for a Business. Never the owner's personal balance for
  a Business action, and never the reverse.
- **One charge per engagement.** Not per component, not per milestone, not per revision, not
  per delivery, not per amendment, not per settlement record.
- **A fixed, admin-configurable action charge**, resolved from origin, category and configured
  action tier (§2). Prices are configuration values; the resolution rule is product.
- **Never a percentage of negotiated contract value, and never banded by it.** This is a hard
  prohibition, not a default:

  > The activation charge **must not be calculated as a percentage of the engagement's
  > negotiated value**, and must not be selected by a band derived from that value.

  The reason is not simplicity. Value-based activation would give every provider a direct
  incentive to under-declare the agreed amount — and the agreed amount is the denominator of
  settlement coverage and the origin of the **verified-GMV series** that the tiered rent model
  runs on ([12 §12A](./12-payment-and-settlement.md)). A rent model built on data that a
  value-based charge has already taught providers to understate is not recoverable. It would
  also make every Amendment a bypass requiring its own charge, and hand disputes a new subject.

  The acknowledged cost is that a large engagement and a small one carry the same charge, which
  falls hardest on exactly the low-value local work Craftsman exists for. That is mitigated
  with **per-origin, per-category and per-tier prices** — which move the charge to where the
  economics differ — and never by making it proportional to value.
- The charge is a **cost to the provider** and must never appear on the buyer's price
  breakdown, be described to the buyer as a fee they fund, or be added to the agreed amount as
  a pass-through line.

---

## 4. When the charge occurs

At the instant of acceptance, and atomically with everything acceptance produces:

```
provider clicks Accept
   ├─ validate: arrangement live · deadline not passed · identity enabled · not suspended · price active
   ├─ lock the identity's MHC balance
   ├─ debit the action key's price               ─┐
   ├─ create the Engagement with all snapshots     ├── ONE TRANSACTION
   ├─ open D3 disclosure for both parties          │
   └─ emit notifications and ledger entries      ─┘
```

Hard rules:

- **All or nothing.** If engagement creation or disclosure fails, the debit is rolled back. A
  debit that persisted without disclosure is a system fault and a refund ground (§9).
- **Idempotent.** A double-submitted acceptance produces one charge and one engagement.
  Concurrency is resolved by row locking and a unique constraint on the arrangement, not by
  application-level checks.
- **No disclosure before the debit commits.** Not a preview, not a partial reveal, not a
  "contact will appear shortly".
- **An inactive or unset price fails closed** with a specific error — the action is refused,
  never given away. This preserves the existing `MHC_ACTION_DISABLED` behaviour and prevents a
  misconfiguration from silently making the marketplace free.
- The **ledger entry** records: action key, price, arrangement reference, engagement
  reference, acting human, timestamp, and the resulting balance.

---

## 5. What happens when the provider lacks MHC

- Acceptance is **refused** with a specific, provider-facing error and a direct route to
  purchase credit.
- The pending arrangement **stays alive** for the remainder of its activation window. The
  provider may top up and accept again.
- **The buyer is not told why.** Insufficient credit is the provider's private financial
  state; the buyer sees a neutral "awaiting provider acceptance" with the deadline. Leaking it
  would be both a privacy failure and a negotiating lever.
- If the window expires before top-up, the arrangement **lapses**: no charge, the Need returns
  to `open` with its own window extended by the wait, and the lapse is recorded on provider
  reliability.
- MHC purchase itself remains subject to the existing operational reality — manual admin
  approval on the launch rail (`KNOWN_LIMITATIONS.md` L4.1) — which is precisely why the
  activation window must be long enough to absorb a human approval step, and why providers
  should be prompted to hold a working balance rather than top up per award.

---

## 6. Before and after activation

| Category                        | Before (D2 and below)                                     | After (D3)                                        |
| ------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| Counterparty name               | Display name only                                          | **Verified legal name** (and registration ref for a BCI) |
| Phone, email, messaging handles | Hidden                                                     | **Visible**                                       |
| Address                         | Governorate + city/district                                | **Exact address, geolocation, access notes, floor, landmark** |
| Attachments                     | **Manifest only, every file type** — no previews, no renditions, no thumbnails | **Full originals, downloadable**              |
| Messaging                       | Pre-award communication: structured **and** free-form, plain text, strictly contact-redacted, moderated, turn-capped, no attachments, no unrestricted links | **Full threaded messaging, file exchange, on-platform calls** |
| Payment instructions            | Method **types** only                                      | **Full instructions, snapshotted**                |
| Scheduling                      | Indicative dates only                                      | **Real appointments at the real address**         |
| Delivery / installation         | Not arrangeable                                            | **Arrangeable**                                   |
| Evidence, deliverables          | None                                                       | **Full upload and exchange**                      |
| Identity verification detail    | Tier badges                                                | **Tier, credential scope and expiry, snapshotted** |

D3, once opened, **persists for the parties to that engagement** — through completion, the
warranty window, disputes, and even the counterparty's later suspension. The provider paid for
it and does not lose it.

---

## 7. Timeout and expiry

| Origin             | Activation window                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `need_award`       | Admin-configurable default (order of a day or two)                                     |
| `service_purchase` | Admin-configurable, typically shorter                                                  |
| `custom_order`     | Admin-configurable; also bounded by the Custom Proposal's own validity period          |
| `product_request`  | Admin-configurable, short — stock status is manual and stale fast                      |
| `booking`          | **min(configured window, slot start − buffer)** — never past the slot it would consume |

Behaviour:

- Reminders to the provider at configured intervals, escalating near the deadline.
- On expiry: **no charge**, the arrangement lapses, both parties are notified, the buyer may
  award or request elsewhere, the Need's own expiry is extended by the time it spent waiting,
  and a held booking slot is released.
- A lapse is recorded on the provider's **reliability metrics** (activation rate), which is
  the correct penalty — not a fee, since no charge occurred.
- Repeated lapses trigger restriction, because they consume buyer attention and slots for free
  and are a signature of off-platform handshakes.

---

## 8. Cancellation behaviour

| When                                                        | MHC outcome                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| Buyer withdraws before activation                           | **No charge** (nothing was charged)                       |
| Provider declines before activation                         | **No charge**                                             |
| Activation window expires                                   | **No charge**                                             |
| Buyer cancels after activation                              | **Charged, not refunded** — but a re-grant candidate under ground G5 where the buyer is at fault |
| Provider cancels after activation                           | **Charged, not refunded.** The provider chose to accept and then withdrew |
| Mutual cancellation after activation                        | **Charged, not refunded**                                 |
| Engagement expires at the requirements gate (buyer silence) | **Charged, not refunded** — but an explicit re-grant candidate under ground G5 |
| Admin closes the engagement on a determination              | Per the determination, including re-grant where the provider is not at fault |

The governing principle: **MHC buys disclosure, not an outcome.** Once contact, address and
attachments are released, the thing that was purchased has been delivered, irrespective of
whether the work went ahead. This must be stated in-product at the moment of activation, in
plain language, so that a provider who later loses the job is not surprised. It is the single
most likely source of early support load — `KNOWN_LIMITATIONS.md` L1.2 flagged exactly this —
and honesty at the point of charge is cheaper than an argument afterwards.

---

## 9. Refunds and re-grants

**MHC is never refunded to money.** There is no cash refund path, no conversion and no
withdrawal, under any circumstances, for any reason. What exists is a **credit re-grant**: new
MHC issued to the identity's balance.

### 9.0 How a re-grant is recorded

**A re-grant is an explicit ledger counterentry. The original debit is never reversed,
deleted, amended or netted away.**

- The activation debit stays exactly as it was written — same amount, same action key, same
  timestamp, same engagement reference. It is history and history is append-only.
- The re-grant is a **separate credit entry** that references the debit it answers, carries its
  ground code, its rationale, its actor, and the resulting balance.
- Reading the ledger therefore shows what happened: a charge occurred, and later a re-grant was
  issued for a stated reason. It never shows a charge that silently became no charge.
- Reconciliation follows from this: charges and re-grants are separately countable, and
  re-grant volume by ground is a monitored metric precisely because it is not hidden inside the
  charge series.

### 9.1 Grounds

Re-grant grounds are a **narrowly defined, closed list**. Which grounds are enabled, their
caps and their per-period allowances are **admin-configurable**; the list itself is not
open-ended, and no ground may be added by operational convention.

Re-grants are permitted **only** in these narrowly defined circumstances:

| #    | Ground                                                                                                       | Automatic? |
| ---- | -------------------------------------------------------------------------------------------------------------- | ---------- |
| G1   | **Duplicate or double charge** for one arrangement (system fault)                                            | Automatic  |
| G2   | **Atomicity breach** — the debit committed but the engagement or disclosure did not                          | Automatic  |
| G3   | **Price or configuration error** — the wrong price was charged, or a price was active that should not have been | Automatic  |
| G4   | **Platform outage or defect** that prevented the provider from fulfilling or from being reachable            | Admin      |
| G5   | **Confirmed buyer fraud or abuse** — a fake Need, a contact-harvesting Need, a buyer banned for abuse, or a buyer who was never able or intending to transact, established by a case determination | Admin, on a case |
| G6   | **Administrative error** in enforcement or verification that caused the loss                                 | Admin      |

Rules:

- Everything not on that list is **not a re-grant ground**. In particular: the buyer changed
  their mind, the buyer went quiet after contact, the price could not be agreed, the provider
  was outbid on a later round, the provider decided not to proceed, or the work simply fell
  through. These are the cost of doing business and the model says so.
- **No time-window refund rule exists.** There is no "refunded if cancelled within N minutes of
  activation" grace period — not fifteen minutes, not any duration — and none may be introduced
  without explicit product approval. A window-based refund would be a new commercial policy, not
  a system-fault remedy: it would let a provider open D3, read the customer's contact details
  and address, cancel inside the window, and recover the credit — which is the gate paying for
  its own bypass. Ground G2 already covers the only case a window is intuitively reaching for,
  namely a disclosure that did not actually happen.
- Admin re-grants are **discretionary, bounded and audited**: a cap per identity per period, a
  written rationale visible to the provider, and a report so that generosity does not quietly
  become policy.
- A re-grant is **credit only**. It never becomes money, never transfers, and never appears as
  a receivable.
- Re-grant volume by ground is a monitored metric. A rising G5 rate means buyer-side abuse
  controls are failing; a rising G1–G3 rate means the platform is broken.

---

## 10. Anti-bypass rules

The gate is the revenue. These rules exist to protect it, and every one of them should have a
detection signal, an enforcement response and a negative test.

### 10.1 Content controls

1. **Contact redaction** on every pre-activation free-text surface: need titles and bodies,
   offer text, proposal cover notes, custom proposal text, structured Q&A, captions, display
   names, trade names, file names, review text and provider responses.
2. Redaction covers **evasion forms**: spaced and separated digits, numbers written as words,
   homoglyphs and mixed scripts, obfuscated domains, external handles and app names, "same as
   my username", and QR codes or contact blocks embedded in images.
3. **No transaction attachment content at D2 — no type, no exception.** Images, documents,
   PDFs, CAD files, archives, drawings, audio and video are manifest-only. There is no preview
   class, and watermarking, EXIF stripping, downscaling, OCR or contact scanning do not
   authorize access ([05 §6](./05-need-model.md),
   [00 §5.1](./00-overview-and-terminology.md)). Public portfolio and storefront media are
   separate published listing media and are not covered by this rule.
4. **No unrestricted links at D0/D1/D2** anywhere, including portfolio media, capability
   statements, product descriptions and pre-award messages.
5. **`raw_content` is preserved** for moderation even where the displayed text is redacted, so
   that intent is provable.

### 10.2 Structural controls

6. **Pre-award communication is contact-masked, moderated and bounded.** The channel accepts
   structured clarification **and** free-form text; every character passes redaction, turn caps
   and rate limits, and `raw_content` is retained for moderation. What is blocked is the
   *payload*: contact details, payment instructions, unrestricted links, exact location and
   attachments of any type. Removing the channel is not the control — masking it is
   ([00 §5.1](./00-overview-and-terminology.md)).
7. **Exact location is D3 only**, with no distance calculator, map pin or radius fine enough
   to identify an address.
8. **Payment instructions are D3 only**, and are snapshotted so mid-engagement changes are
   visible.
9. **Demand is signed-in only.** Needs are never visible to guests — an open Need index is the
   cheapest possible harvesting target.
10. **Proposal amounts are never visible to other providers.**

### 10.3 Behavioural detection

11. **Award-to-activation ratio**, per provider, per buyer, and per buyer-provider pair. A
    pair that repeatedly awards and lets it lapse is the clearest signature of an off-platform
    handshake.
12. **Repeat-pair analysis**: two identities that meet on the platform once and then transact
    only off it show up as a pair with one engagement and repeated later Needs and lapses.
13. **Serial re-posting and near-duplicate Needs**, especially after a lapse.
14. **Cancel-and-relist** patterns immediately after activation.
15. **Listed-price vs agreed-amount gaps** that suggest the listing is a lure
    ([06 §1](./06-offer-model.md)).
16. **Requests-to-engagement funnel drop-off** at the disclosure boundary.
17. **Rate limits** on Needs, quote requests and messaging, tightened for V0-only identities.

### 10.4 Conduct prohibitions

18. Soliciting or supplying contact details, external handles or payment channels before
    activation — by either party.
19. Soliciting a cancellation in order to transact off-platform, at any stage.
20. Asking the buyer to pay the platform, or presenting platform-branded payment demands.
21. Creating a Need whose purpose is to harvest contact details — a terminating offence and a
    ground G5 re-grant for any provider charged on it.
22. Using reviews, disputes or settlement records as a channel for contact details.
23. Operating multiple identities to evade quotas, suspension or the gate.

### 10.5 The honest limit

None of this is a wall. A determined pair will always be able to split a number across
messages, describe it obliquely, or agree to meet elsewhere. Redaction raises cost; it does
not create impossibility, and `contact-redaction.ts` already says so in its own header. The
architecture's response is not to pretend otherwise but to (a) make the legitimate path
genuinely better — evidence, disputes, reputation, verified settled volume — and (b) measure
the leakage ratio in production so the commercial model is calibrated against reality rather
than hope.

---

## 11. Verified-GMV monthly rent — shadow mode

The second revenue mechanism, **built in Wave 3 and deliberately not switched on.**

Activation charges (§2–§4) are the only MHC that actually leaves a balance in Wave 3.

### 11.1 What shadow mode means

Wave 3 delivers the whole chain in [12 §12A](./12-payment-and-settlement.md) — settlement
evidence, settlement tranches, verified-GMV calculation, period closing, tier calculation,
admin reporting and expected-rent calculation — and then **stops before the debit**.

| Behaviour                                                             | Shadow mode |
| --------------------------------------------------------------------- | ----------- |
| Close a period and compute verified GMV per commercial identity        | ✅          |
| Resolve the identity's tier from the configured tier table             | ✅          |
| Compute the MHC rent that tier **would** charge                        | ✅          |
| **Record** the expected charge as a shadow entry, with its inputs      | ✅          |
| Report it to administrators, per identity and in aggregate             | ✅          |
| **Deduct MHC from any balance**                                        | ❌          |
| Write a debit to the MHC ledger                                        | ❌          |
| Fail, block or restrict an action for insufficient balance against rent| ❌          |
| **Suspend or restrict a commercial identity for unpaid rent**          | ❌          |
| Present a rent figure to a provider as owed, due, outstanding or arrears | ❌        |

A shadow entry is an **observation, not an obligation.** It is recorded in its own series,
never in the MHC ledger, so that no reader of a balance or a ledger can mistake it for a charge
that occurred.

### 11.2 Why it ships dark

Rent is calculated from verified GMV, and verified GMV is a brand-new series produced by a
brand-new evidence ladder that has never run against real provider behaviour. Charging real
credit against an uncalibrated number would be charging against a measurement error. Shadow
mode produces the calibration data — how much settlement actually gets confirmed, how tiers
distribute, how large restatements are, how many identities would land in each band — while
the cost of being wrong is zero.

It also means the tier table can be set from evidence rather than from a guess, and that the
first provider to see a rent charge sees one derived from a model that has already been
observed working.

### 11.3 Turning it on is a separate decision

**Live charging requires an explicit production activation decision.** It is not a
configuration flip performed as part of the Wave 3 release, and no part of the Wave 3
deliverable may make it one.

That later decision must settle, at minimum: the tier table's real values, the notice period
providers receive, what happens when a balance is insufficient at charge time, whether and how
rent interacts with commercial suspension, the dispute route for a contested closing figure,
and the restatement policy for a period already charged.

Until it is taken:

- **No commercial suspension, restriction or enforcement may be triggered by rent** of any
  kind, in shadow mode or otherwise ([15 §4](./15-suspension-and-enforcement.md)).
- No provider-facing surface may present a shadow figure as a charge, a debt, a due amount or
  a projection the provider is expected to fund. If a shadow figure is shown to providers at
  all, it is labelled as an illustrative calculation that has taken nothing.
- **Value-based engagement activation pricing remains prohibited** (§3) regardless of rent's
  status. The two mechanisms are independent, and rent going live never becomes a reason to
  make activation proportional to value.
