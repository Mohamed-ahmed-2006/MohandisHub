# Decisions Required

**These block implementation.** Each one sits inside a sensitive flow (MHC pricing and
accounting, wallet balances, payments, refunds, provider activation, award semantics,
contact-sharing gates, permissions, or destructive migrations). Repository evidence is
insufficient or self-contradictory for all of them, so no assumption will be implemented
until you answer.

Presented in **dependency order** — D1 first, because it determines whether there is a
money-safety problem to solve before anything else ships.

**How to answer:** reply with the decision ID and your chosen option (e.g. "D1: Option B,
D2: Option C"). Deviations and extra conditions are welcome; I will restate my
understanding before implementing.

---

## D1 — Existing EGP wallet balances and withdrawals

### Current repository behaviour (VERIFIED)

`supabase/migrations/20260728160000_mhc_activation_gate_and_launch_model.sql:147-150`
executes unconditionally:

```sql
UPDATE public.wallets SET is_frozen = true WHERE account_type = 'money';
```

The same migration sets `withdrawal_instapay`, `withdrawal_crypto`, `withdrawal_paymob`,
`deposit_instapay`, `deposit_crypto`, `deposit_card`, `deposit_paymob`, and
`escrow_bid_payment` all to `false`. `packages/shared/src/app-settings.ts` was changed so
these keys default to `false` and must be checked with the fail-closed
`isPaymentMethodEnabledStrict`.

### Why this is unsafe or inconsistent

Any user holding a non-zero EGP balance is left with money that is simultaneously frozen,
un-toppable, and un-withdrawable. There is no user-facing path to recover it and no
in-product explanation. If real balances exist, this is a customer-liability and possibly
a regulatory problem, not a technical one.

The migration comments say the EGP wallet is "preserved and FROZEN for launch so its
history remains intact". That states the mechanism but not the policy: it does not say
what happens to the money.

**I cannot determine from the repository whether production holds real balances.** Before
you decide, I would like to run these read-only queries against production (no writes, no
schema changes):

```sql
SELECT count(*) AS wallets_with_balance, COALESCE(sum(balance), 0) AS total_egp
FROM public.wallets WHERE account_type = 'money' AND balance > 0;

SELECT count(*) FROM public.withdrawal_requests WHERE status IN ('pending','processing');
SELECT count(*) FROM public.wallet_holds WHERE status = 'held';
```

If all three return zero, this decision becomes trivial (Option A) and costs nothing.

### Options

| | Option | What it means |
| --- | --- | --- |
| **A** | **Freeze as written** — confirmed only after the queries show zero balances, zero pending withdrawals, zero holds. | The migration is already correct. No further work. |
| **B** | **Settle before freezing** — keep `withdrawal_instapay` enabled for a defined wind-down window, notify affected users, freeze only after balances reach zero. | Users get their money out through the existing, tested rail. |
| **C** | **Admin-only manual settlement** — freeze immediately, but build an admin tool to pay out individual balances off-platform and record the reversal in the ledger. | Money leaves under admin control, with an audit trail. |
| **D** | **Convert EGP balances to MHC** for provider accounts at an agreed rate; settle customer balances manually. | Removes the liability and seeds provider credit. |

### Advantages and disadvantages

- **A** — *Advantage:* zero work, zero risk, and the cleanest launch posture. *Disadvantage:* only valid if the data genuinely is empty. If it is not, this option quietly strands real money.
- **B** — *Advantage:* uses a rail that already exists and has been exercised; users self-serve; no new money-moving code. *Disadvantage:* delays launch by the wind-down window; keeps a withdrawal rail live during the transition, which is the exact surface the launch model wanted closed.
- **C** — *Advantage:* immediate freeze, so the launch posture is clean from day one; volume is presumably small. *Disadvantage:* new admin money-movement code, which is precisely the category that most needs to be right; manual process risks error at any real volume.
- **D** — *Advantage:* no cash leaves the business; converts a liability into engagement. *Disadvantage:* **MHC is explicitly non-cashable and non-refundable.** Converting someone's withdrawable money into a non-withdrawable credit without their consent is not defensible, and probably not lawful, without explicit opt-in. Would need a per-user consent flow, which is more work than Option B.

### Recommendation

**Run the read-only queries first.** If they return zero across the board, take **Option A**
and close this in an hour.

If balances exist, take **Option B**. It reuses a tested rail, keeps users whole, requires
no new money-moving code, and is the option that best survives scrutiny. Option D should be
rejected outright unless it is offered as a genuinely optional, opt-in alternative *alongside*
withdrawal.

### Blocked by this decision

M9. MHC-10. Any application of migration `20260728160000` to production. Practically, the
entire launch date depends on this if balances exist.

### Can other work continue?

Yes — everything except M9 and the production migration. This does not block M0–M8.

---

## D2 — General pre-activation chat behaviour

### Current repository behaviour (VERIFIED)

Two independent messaging systems exist:

1. **Bid chat** (`bid_messages`, via `needs.service`) — now redacted pre-activation:
   contact details are stripped, attachments are refused outright, and the original text is
   preserved in `raw_content` for moderation.
2. **General chat** (`conversations`/`messages`, via `chat.service`) —
   `POST /api/chat/conversations` accepts any `otherUserId` and calls
   `findOrCreateConversation`. Its only guard is the global `pauseChat` flag. **No
   relationship requirement, no redaction, no activation gate, no reference to
   `ActivationGateService`.**

### Why this is unsafe or inconsistent

The two systems contradict each other. All of the redaction work in system 1 is nullified
by system 2: a provider browsing open needs can read the customer's user ID, open a direct
conversation, and exchange phone numbers in one message. The MHC paywall — the platform's
only revenue rail — becomes optional for anyone who notices.

Session 1 clearly did not intend this; `ActivationGateService`'s header comment says every
privileged endpoint "MUST consult this service". It simply never got to the chat module.

**What I cannot infer:** what general chat is *for*. If it exists so customers can ask
providers pre-sales questions, closing it entirely would damage the marketplace. If it is a
legacy feature from the escrow era, closing it is free. The repository does not say, and
`apps/web` usage would tell me how it is surfaced but not why it was built.

### Options

| | Option | What it means |
| --- | --- | --- |
| **A** | **Disable general chat for launch.** All customer↔provider messaging goes through bid chat, which is gated and redacted. | One messaging path, one set of rules. |
| **B** | **Apply the same redaction to general chat.** Contact details stripped, attachments blocked, unless the pair has an activated job together. | Both systems behave identically. |
| **C** | **Restrict who may start a conversation** — only pairs with an existing bid relationship — *and* redact until activation. | Narrows the surface and redacts what remains. |
| **D** | **Leave general chat open** and accept that the gate is bypassable. | Status quo, made explicit. |

### Advantages and disadvantages

- **A** — *Advantage:* simplest, fastest, and structurally impossible to bypass. *Disadvantage:* removes a live feature; any user relying on it loses it; pre-sales questions must move to bid chat, which requires bidding first.
- **B** — *Advantage:* keeps the feature; consistent rules everywhere. *Disadvantage:* needs schema changes mirroring `contact_redacted`/`raw_content`, plus the socket layer must enforce the same rule or become a third bypass. "Has an activated job together" is a non-trivial query to run per message.
- **C** — *Advantage:* strongest security posture short of disabling; a stranger cannot cold-message anyone. *Disadvantage:* the most work of the three; breaks any legitimate non-bid conversation such as support or repeat-client contact.
- **D** — *Advantage:* no work. *Disadvantage:* the revenue model does not survive contact with a motivated user. I do not recommend launching this way.

### Recommendation

**Option A for launch**, then **Option C** as a follow-up once the MHC flow is proven.

Reasoning: the redaction machinery in bid chat already exists and is tested; duplicating it
into general chat (Option B) doubles the surface that has to be right, and the socket layer
makes that meaningfully harder. Disabling one of two overlapping messaging systems is a
reversible, low-risk decision that buys a coherent launch. If general chat turns out to
matter commercially, Option C can restore it deliberately.

**Please tell me what general chat is used for today** — if it carries real traffic, that
changes my recommendation to C.

### Blocked by this decision

M5. MHC-05. The chat portion of the launch security posture.

### Can other work continue?

Yes. M0–M4 and M6–M8 are unaffected.

---

## D3 — Losing bidder chat and data access

### Current repository behaviour (VERIFIED)

`needs.service.listBidMessages` computes:

```ts
const unlocked = need.activated_at != null || !(await this.activationGate.isGateEnabled());
```

`activated_at` is a column on **`needs`**, not on `bids`. So when any one bid on a need is
activated, every bid thread on that need unlocks — including threads belonging to providers
whose bids were rejected and who paid nothing. Unlocked means `raw_content` (the original,
unredacted text) is returned. The same condition governs `createBidMessage`, so rejected
bidders also regain the ability to post unredacted text and attachments.

Separately, `awardBid` sets all other bids to `'rejected'` at offer time, so by the moment
activation happens, every other bidder is already a "loser" — and every one of their threads
unlocks.

### Why this is unsafe or inconsistent

It inverts the paywall. One provider pays; every other provider who bid on that need
receives the customer's contact details for free. A provider could bid low on many needs
purely to harvest contact details once someone else activates.

The per-bid fact needed to fix this already exists: `mhc_job_activations.bid_id`. This looks
like an oversight rather than a design choice — but the *policy* question underneath it is
real and I will not guess at it.

### Options

| | Option | What it means |
| --- | --- | --- |
| **A** | **Per-bid unlock, permanent lock for losers.** Only the activated bid's thread unlocks. Losing threads stay redacted forever and become read-only. | Strictest. The paywall means exactly what it says. |
| **B** | **Per-bid unlock, losing threads archived.** Losers keep read access to their own redacted history; posting is disabled. | Same security, softer UX. |
| **C** | **Per-bid unlock, losing threads deleted** after a retention window. | Minimises stored contact data. |
| **D** | **Keep need-scoped unlock** (current behaviour). | Status quo. |

### Advantages and disadvantages

- **A** — *Advantage:* correct and simple; a one-line change to the unlock condition. *Disadvantage:* a losing provider sees permanently redacted markers in their own history, which reads as broken unless the UI explains it.
- **B** — *Advantage:* same security as A with an honest UX — the thread is visibly closed rather than mysteriously censored. *Disadvantage:* marginally more UI work (an archived/read-only state).
- **C** — *Advantage:* smallest data-retention footprint, which fits the existing retention module. *Disadvantage:* destroys moderation and dispute evidence; `raw_content` exists specifically to preserve it. I would not do this.
- **D** — *Advantage:* none that I can identify. *Disadvantage:* it is the bug.

### Recommendation

**Option B.** It is Option A's security with a UX that does not look like a defect, and the
read-only archived state is a small amount of front-end work that M7 is building anyway.
Reject Option C — deleting `raw_content` throws away the moderation trail the schema was
designed to keep.

### Blocked by this decision

M3. MHC-07. Part of the M7 UI (the archived-thread state).

### Can other work continue?

Yes, though M3 is on the critical path for making the gate real, so an early answer here is
valuable.

---

## D4 — Award-offer expiration behaviour

### Current repository behaviour (VERIFIED)

- `app_settings.award_acceptance_expiry_hours` exists, defaults to **48**, is constrained to
  0–8760, and is documented as "0 = never expire".
- `awardBid` writes `pending_award_expires_at = now() + N hours`, or
  `'infinity'::timestamptz` when N is 0.
- `idx_needs_pending_award_expiry` supports an efficient sweep.
- `needs.repository.listExpiredPendingAwards` implements the sweep query.
- **Nothing calls it.** `worker.ts` starts only the reservation and retention workers.
- `activateAwardForProvider` *does* refuse to charge for an already-expired offer, so the
  timestamp is honoured defensively at the point of payment even though nothing sweeps.

So an ignored offer sits in `awarded_pending_provider_acceptance` forever. After the expiry
instant it can no longer be activated, but it is never released, no notification fires, and
the need never returns to `open` on its own.

Compounding this: `awardBid` rejects and notifies all *other* bidders at offer time. If the
offer then lapses, the need reopens with every alternative bid already rejected and every
alternative provider already told they were not selected.

### Why this is unsafe or inconsistent

The schema, the settings column, the index, and the sweep query all assert that offers
expire. The runtime does not implement it. A customer whose chosen provider goes quiet has
no automatic recourse, and the marketplace accumulates permanently stalled needs.

I will not choose the expiry policy myself: it directly shapes provider obligations and
customer experience, and reasonable businesses choose differently.

### Options

| | Option | What it means |
| --- | --- | --- |
| **A** | **Implement the sweep as designed.** 48-hour default, admin-configurable, releases to `open`, notifies both parties. | Honours the existing design. |
| **B** | **No expiry; customer-initiated withdrawal.** The offer stands until the customer explicitly withdraws it. Remove the expiry machinery. | Puts the customer in control. |
| **C** | **Both.** Offers expire, *and* the customer may withdraw early. | Most flexible. |
| **D** | **Provider must accept within the window or the bid is withdrawn entirely** (not merely rejected), freeing the slot and penalising non-response. | Strongest provider-responsiveness pressure. |

Each of A, C, and D additionally requires answering: **should losing bids be rejected at
offer time, or held pending until the offer is accepted?** (MHC-18). Holding them — a new
`'on_hold'` bid status — makes re-awarding after a lapse coherent instead of confusing.

### Advantages and disadvantages

- **A** — *Advantage:* everything except the worker already exists; smallest delta. *Disadvantage:* a customer who wants to cancel early still cannot, short of closing the need.
- **B** — *Advantage:* no worker, no race between sweep and activation, less to get wrong. *Disadvantage:* stalled needs persist indefinitely if the customer is also inactive; discards work already built.
- **C** — *Advantage:* covers both failure modes — unresponsive provider and changed-mind customer. *Disadvantage:* most surface area; the withdraw path must race-safely interact with an in-flight activation, or a provider could be charged for an offer withdrawn a moment earlier.
- **D** — *Advantage:* keeps the bid list clean and pushes providers to respond. *Disadvantage:* harshest on providers, who may reasonably need more than 48 hours; risks provider churn at launch when volume is low.

### Recommendation

**Option C, with losing bids held rather than rejected.**

Reasoning: A alone leaves the customer stuck behind a silent provider for the full window
with no escape. B alone leaves needs stalled forever. C costs one extra endpoint over A, and
the race it introduces is the same race the expiry sweep already has — solved once, in the
charging transaction, by the guarded `UPDATE`s that MHC-14 requires anyway.

Holding losing bids matters: without it, "the need reopens so the customer can award someone
else" is technically true but practically confusing, because everyone else has already been
told they lost.

**If you want the smallest possible change, choose A** and accept that early withdrawal
means closing and reposting the need.

### Blocked by this decision

M6. MHC-03, MHC-18, and part of MHC-21 (the duplicate release implementations — the worker
must adopt one of them).

### Can other work continue?

Yes. M6 is not on the critical path for a usable flow; M4 and M7 are.

---

## D5 — Provider direct-payment-method disclosure

### Current repository behaviour (VERIFIED)

`provider_payment_methods` exists with `method_type IN ('bank_transfer','instapay','mobile_wallet')`,
a non-sensitive `label`, a sensitive `details JSONB` documented as "revealed to a customer
only after MHC activation", plus `is_active`, `sort_order`, and a uniqueness index on
`(user_id, method_type, lower(label))`.

`provider_payment_disclosures` exists to audit who saw which details via which activation,
with `uq_provider_payment_disclosure_activation_customer` enforcing one row per
(activation, customer), RLS enabled, and `anon`/`authenticated` revoked.

**Neither table is referenced by a single line of application code.** No CRUD, no
disclosure endpoint, no UI. Meanwhile `payBid` returns 410 and every escrow rail is off.

### Why this is unsafe or inconsistent

This is the gap that makes the launch model non-functional. The premise is "customers pay
providers directly", the escrow path is closed, and the mechanism for the customer to learn
*how* to pay has not been built. A provider can spend real credits to activate a job and
still have no way to get paid through the product.

The schema tells me the shape but not the policy, and the policy is unavoidably a business
decision: it concerns what financial data the platform stores about providers, what it shows
to customers, and what the platform's exposure is when a direct payment goes wrong.

### Options

| | Option | What it means |
| --- | --- | --- |
| **A** | **Structured methods as designed.** Providers register bank/InstaPay/mobile-wallet details; customers see them only after activation; every disclosure is audited. | Uses the schema as built. |
| **B** | **Free-text payment instructions.** One field the provider writes themselves, revealed post-activation. No structured financial data stored. | Minimal storage, minimal liability. |
| **C** | **No stored details; unlock contact instead.** Post-activation the parties exchange phone numbers and settle payment between themselves. | Platform stores nothing financial. |
| **D** | **A + mandatory configuration.** As A, but a provider cannot activate an award until at least one active payment method exists. | Guarantees the customer always sees something. |

Related sub-question (MHC-09): public profiles currently expose `linkedinUrl`,
`portfolioUrl` (experts) and `website` (businesses) with no gate. These are working
off-platform contact channels. Do they stay visible pre-activation as marketing surface, or
are they gated too?

### Advantages and disadvantages

- **A** — *Advantage:* structured data enables validation, display formatting, and later automation; the audit trail supports dispute resolution. *Disadvantage:* the platform now stores provider financial identifiers, raising its data-protection obligations; `details JSONB` is unvalidated and unencrypted at rest as written.
- **B** — *Advantage:* least storage risk; providers can express anything; fastest to build. *Disadvantage:* unvalidated free text is a phishing and abuse vector (a provider could paste anything, including a third party's account); no structure for dispute handling.
- **C** — *Advantage:* no financial data stored at all; simplest liability position. *Disadvantage:* renders both tables dead weight; pushes the entire payment conversation off-platform, which weakens dispute resolution and the platform's visibility into whether jobs completed.
- **D** — *Advantage:* eliminates the worst failure mode, where a provider pays MHC to activate and the customer then finds nothing to pay to. *Disadvantage:* adds friction at the exact moment the provider is spending money; a provider without a configured method hits a wall mid-flow.

### Recommendation

**Option D**, i.e. Option A plus mandatory configuration — but with the configuration
prompted during provider onboarding, not at activation time, so the wall is never hit
mid-payment.

Reasoning: A is what the schema was built for and what dispute handling will need. The
mandatory element in D closes the one failure mode that directly wastes a provider's money.
Prompting at onboarding rather than at activation converts the friction into a one-time
setup step.

Two conditions I would attach: validate `details` against a per-`method_type` schema rather
than accepting arbitrary JSON, and treat the disclosure endpoint as writing the audit row
*before* returning the details, so a failed write cannot silently produce an unaudited
disclosure.

On the sub-question, I recommend **leaving portfolio and website links visible**. They are
genuine marketing surface, hiding them would hurt provider conversion, and the realistic
bypass risk is far lower than the chat hole in D2. Worth revisiting after launch with real
data.

### Blocked by this decision

M4. MHC-04, MHC-09. Practically, the entire usable launch flow — this and D2 are the two
decisions with the largest downstream footprint.

### Can other work continue?

Yes, but M4 is on the critical path. **This is the decision I most need early.**

---

## D6 — Legacy escrow and EGP-denominated features after MHC launch

### Current repository behaviour (VERIFIED)

- `needs.service.payBid` retains the full escrow implementation but throws
  `ESCROW_PAYMENTS_RETIRED` (410) unless `escrow_bid_payment` is enabled, checked with the
  fail-closed `isPaymentMethodEnabledStrict`. The flag is set `false` by migration.
- One test (`needs.service.test.ts`, "returns idempotent alreadyPaid response for duplicate
  pay call") still asserts the old behaviour and now fails.
- **`advertisements.service.ts` still charges the EGP money wallet** —
  `walletRepo.findByUserId` then `debitWalletInTransaction`. Since the migration freezes
  every money wallet and disables every deposit rail, paid advertisements cannot work. Free
  ads (`pricePerDay = 0`, the default) still work because the debit is guarded by
  `if (amount > 0)` — but `findByUserId` is called before that guard and throws 402 when no
  money wallet row exists.
- `mhc_action_prices` seeds `advertisement`, `service_promotion`, `featured_provider`, and
  `promoted_proposal`, all inactive at price 0, and **none is consumed by any code**.
- Milestone escrow (`20260617100000_job_milestone_escrow.sql`), dispute cases, and the money
  audit remain in the tree; I have not yet deep-read them.

### Why this is unsafe or inconsistent

The escrow retirement was done carefully for `payBid` and not at all for everything else
that spends EGP. The system is now in a mixed state: one EGP path is deliberately fenced,
another (advertisements) is accidentally broken, and the MHC replacement for it is seeded in
the pricing table but unimplemented.

The seeded action keys show clear intent to move promotions onto MHC. Intent is not a
specification, and pricing is explicitly a sensitive flow, so I will not implement it
speculatively.

### Options

| | Option | What it means |
| --- | --- | --- |
| **A** | **Ads and promotions move to MHC now.** Implement the seeded action keys; charge MHC; refunds credit MHC. | One currency, coherent model. |
| **B** | **Disable paid ads and promotions for launch.** Free ads only; revisit post-launch. | Smallest scope. |
| **C** | **Keep ads on EGP** and carve out an exception: unfreeze money wallets for ad spending, re-enable one deposit rail. | Preserves existing ad revenue. |
| **D** | **Remove advertisements from launch scope entirely.** | Least surface. |

On escrow specifically: (i) delete the retired `payBid` code, or (ii) keep it fenced behind
the fail-closed flag as it is now.

### Advantages and disadvantages

- **A** — *Advantage:* one currency; every paid feature funds through the same rail; the seeded keys become real. *Disadvantage:* meaningful work — purchase, refund, and admin surfaces for four action keys; the ad refund path also moves EGP and needs the same treatment.
- **B** — *Advantage:* smallest change; free ads already function; nothing is broken that is not already broken. *Disadvantage:* forgoes ad revenue at launch; leaves an obviously-unfinished feature visible.
- **C** — *Advantage:* preserves an existing revenue stream. *Disadvantage:* directly contradicts the launch model by reopening a customer-funding rail, and reintroduces exactly the wallet surface D1 is trying to close. I do not recommend it.
- **D** — *Advantage:* cleanest launch. *Disadvantage:* removes a built feature; likely over-correcting.

### Recommendation

**Option B for launch, Option A immediately after.**

Reasoning: advertisements are not on the critical path to a working marketplace, and the
minimal recovery path is already long. Shipping free-only ads costs one small guard fix (the
`findByUserId` 402 on the free path) versus building four MHC-charged promotion flows. Once
the core MHC loop is proven in production, moving promotions onto MHC is a well-understood
follow-up with the pricing catalog already in place.

Reject Option C — it undoes D1 and the launch model simultaneously.

On escrow: **keep the fenced code (ii)**. It is behind a fail-closed flag, it preserves
auditable history, and deleting a large money-handling path during a recovery adds risk for
no launch benefit. The failing test should be rewritten to assert the 410, with the
idempotency assertion preserved behind the flag so the behaviour stays covered if the rail is
ever reopened.

### Blocked by this decision

MHC-19 (advertisements). Part of M1 (the one `payBid` test). Scope of Part B phase 13.

### Can other work continue?

Yes. Only the single `payBid` test in M1 depends on the escrow half, and I can complete M1's
other five test repairs regardless.

---

## Secondary questions (not blocking, answer when convenient)

| # | Question | Why it matters |
| --- | --- | --- |
| S1 | Are bookings/reservations in launch scope? | If yes, MHC-08 becomes Rank 2 — an unpriced second door into paid work. If no, the path should be disabled rather than left free. |
| S2 | Which migrations are already applied to production? | MHC-13. Only you can supply this; it determines whether corrective migrations must handle two states. |
| S3 | What MHC prices and package amounts should launch with? | Everything is seeded at 0/inactive. The gate charges nothing until configured — the model earns no revenue until you set prices. Not blocking code, but blocking launch. |
| S4 | Is there a production database with real users today, or is launch a clean start? | Changes the risk profile of every migration in this plan. |
