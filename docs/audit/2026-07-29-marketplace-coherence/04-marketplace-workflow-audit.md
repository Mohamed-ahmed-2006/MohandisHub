# 04 — Marketplace Workflow and Taxonomy Audit

---

## 1. The ten-step workflow against the code

| #   | Step                         | Class | Detail                                                                           |
| --- | ---------------------------- | ----- | -------------------------------------------------------------------------------- |
| 1   | Customer posts a need        | 4     | Works for `role='customer'` only. `requireRole('customer')` on `POST /api/needs` |
| 2   | Providers discover it        | 4     | `GET /api/needs` exists; filtering is thin vs. service search                    |
| 3   | Providers bid **using MHC**  | 6     | Bidding is free. No `bid_submission` action key                                  |
| 4   | Customer compares and awards | 4     | Award works; no comparison surface                                               |
| 5   | Provider pays MHC activation | 1     | Race-safe, idempotent, audited                                                   |
| 6   | Contact + attachments unlock | 1     | `ActivationGateService`, fail-closed                                             |
| 7   | Milestones, files, approvals | 6     | Not on the need path                                                             |
| 8   | Project completed            | 4     | Status value exists; no flow writes it                                           |
| 9   | Mutual reviews               | 5     | `ReviewsService.create` requires a completed reservation                         |
| 10  | One Help & Resolution Center | 6     | Three separate systems                                                           |

**Steps 5 and 6 — the hard, security-critical part — are done and done well. Steps 7–9 — the retention half — are absent.**

---

## 2. The completion cliff

This is the most consequential functional gap in the product.

Trace what happens after activation:

1. `mhc_job_activations` row written, `needs.activated_at` set, `bids.award_accepted_at` set.
2. Contact details unlock. Attachments unlock. Chat opens fully.
3. **Nothing else exists.**

There is no way to:

- create a milestone on a need-job,
- submit a deliverable,
- approve or reject a deliverable,
- mark the project mutually complete,
- leave a review.

`needs.status` accepts `'in_progress'` and `'completed'`, but no code path writes either value on the activation flow. `bids` has `award_accepted_at` and no completion column.

### Why this matters commercially

The provider pays at the moment of _maximum_ uncertainty — before any work — and receives, in exchange, a phone number. Every subsequent interaction happens off-platform. The platform has no record of whether the job happened, no basis for a review, no evidence for a dispute, and no reason for either party to return.

**A marketplace that charges for introductions and then has no product is a lead-generation business.** That is a viable business, but it is not what the ten-step objective describes, and it will not sustain repeat MHC purchases: a provider who takes the relationship off-platform after one activation never pays a second time.

The reviews gap makes this concrete. `ReviewsService.create` (`reviews.service.ts:58`) branches only on `input.reservationId || input.bookingId`. A need-job has neither, so **a provider can complete ten projects through the RFP path and have zero reviews.** The trust signal that would justify the next provider's activation fee is never generated.

### Minimum viable completion

Deliberately small. Reuse `job_milestones`' shape, without escrow:

```sql
CREATE TABLE need_milestones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  need_id      UUID NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
  bid_id       UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  title        VARCHAR(300) NOT NULL,
  description  TEXT,
  due_date     DATE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','submitted','approved','rejected')),
  submitted_at TIMESTAMPTZ,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE need_deliverables (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES need_milestones(id) ON DELETE CASCADE,
  upload_id    UUID NOT NULL REFERENCES private_uploads(id) ON DELETE RESTRICT,
  uploaded_by  UUID NOT NULL REFERENCES users(id),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE needs
  ADD COLUMN IF NOT EXISTS customer_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_completed_at TIMESTAMPTZ;
```

**No money columns.** Milestones are a coordination and evidence structure, not a payment structure. Adding `wallet_hold_id` here would recreate the exact coupling that broke `job_milestones`.

Completion is mutual: `needs.status = 'completed'` only when both timestamps are set. Then extend `ReviewsService.create` with a third branch — a completed, activated need-job — and both parties can review.

**Every deliverable read must pass through `ActivationGateService.assertAwardActivated`.** Deliverables are private uploads on a paid job; the gate is the existing, tested authority and must not be bypassed.

---

## 3. Taxonomy — a proposal to evaluate, not a decision

The original brief proposed collapsing to four surfaces: Needs/Projects, Services, Providers, My Work. **This section evaluates that proposal rather than assuming it.**

### 3.1 What actually exists

Six distinct transaction types, each with its own schema, lifecycle and UI:

| #   | Type                                                 | Tables                                                 | Lifecycle                   | Class                  |
| --- | ---------------------------------------------------- | ------------------------------------------------------ | --------------------------- | ---------------------- |
| 1   | Need → bid → award → activation                      | `needs`, `bids`, `bid_messages`, `mhc_job_activations` | 6 need states, 6 bid states | 1 (through activation) |
| 2   | Service → booking → visit/call                       | `services`, `reservations`, slots, check-in, calls     | rich, worker-driven         | 1                      |
| 3   | Service → negotiation → booking                      | `price_negotiations`, `_rounds`                        | 6 states                    | 1                      |
| 4   | Employment job → application → interview → milestone | `jobs`, `job_applications`, `job_milestones`           | 7 application states        | 1 (except escrow)      |
| 5   | Advertisement campaign                               | `advertisements`, `advertisement_plans`                | scheduled                   | 5 (payment)            |
| 6   | Provider discovery                                   | via service search                                     | —                           | 4                      |

These are **not** duplicates. They are genuinely different workflows.

### 3.2 The real problem is naming, not count

The confusion the brief identifies is real, but it is a **labelling** problem:

- `/app/projects` shows **employment jobs**. Actual projects live under `/app`.
- "Bid", "proposal" and "application" all appear for provider responses.
- "Reservation", "booking" and "order" all appear for the same entity.
- `/app/browse` redirects to `/app/services`, which is the provider's _own_ catalogue, not browsing.

**Renaming and re-routing fixes most of the perceived incoherence without touching any working feature.** That is a materially cheaper and lower-risk intervention than collapsing the taxonomy.

### 3.3 Two options

**Option A — Rename and re-route (recommended for launch).** Keep all six types. Fix names and navigation:

| Surface      | Contains                                                                          |
| ------------ | --------------------------------------------------------------------------------- |
| Needs        | Post a need; browse open needs                                                    |
| Services     | Browse and book services (customer view)                                          |
| My Catalogue | Provider's own services _(currently mis-titled "My Services" at `/app/services`)_ |
| My Work      | Active engagements: activated need-jobs + bookings + employment applications      |
| Hiring       | Employment jobs, explicitly separated _(currently mis-titled "Projects")_         |
| Providers    | Provider discovery                                                                |

Complexity: **small**. No schema change. No feature loss.

**Option B — Collapse to four surfaces.** Requires deciding where employment jobs go, and either hiding a working module or forcing it into a "Needs" abstraction that does not fit (a job posting has a salary range, a CV, and an interview — none map onto a need).

Complexity: **large**. Meaningful risk of breaking a class-1 subsystem.

**Recommendation: Option A.** Option B should only be considered if usage data later shows employment jobs are unused — a question this audit cannot answer.

### 3.4 On deferring modules

The brief instructed that physical products and employment jobs be reported as deferred future modules. Applying the corrected rule — _classify before deciding_ — the two cases differ sharply:

- **Employment jobs: class 1, fully built.** Deferring means hiding a working subsystem. That is a **product decision, not an audit conclusion**, and this audit does not make it. The audit's recommendation is narrower: give it an honest name ("Hiring") and its own navigation entry, and fix the class-5 escrow settlement. If it is then hidden, that is a deliberate scope call with a one-line flag.
- **Goods/products: class 6, not found.** Nothing to defer. See `12-capability-classification.md` §B.1.

---

## 4. What the activation gate protects, precisely

Verified behaviour:

| Protected                   | Mechanism                                                                          | Class |
| --------------------------- | ---------------------------------------------------------------------------------- | ----- |
| Contact details in bid chat | `contact-redaction.ts`; raw text kept in `bid_messages.raw_content` for moderation | 1     |
| Attachments pre-activation  | Disabled                                                                           | 1     |
| Provider payment details    | `assertAwardActivated` + `provider_payment_disclosures`                            | 1     |
| Exact address               | Gated                                                                              | 1     |
| Full chat                   | `chat-access.service.ts`                                                           | 1     |

The redaction module is honest about its own limits in its header comment: it is defence in depth, not a guarantee, and the real enforcement is that attachments are off and the award requires payment. That is the right framing.

**One residual leak worth noting:** a determined pair can split a phone number across messages ("my number starts 010", "…then 1234567"). No regex catches this. The mitigation is not a better regex — it is making activation cheap relative to the value of the job, so bypassing is not worth the effort. This is a pricing decision, not an engineering one.

---

## 5. Negotiations — correcting an assumption

The brief suggested negotiations may be an isolated feature and should perhaps be hidden. **The code does not support that.**

`price_negotiations` has `service_id`, `customer_id`, `provider_id`, `original_price`, `agreed_price`, `latest_amount`, `latest_offered_by`, `expires_at`, `agreed_valid_until`, six states including `consumed`, and a partial unique index preventing duplicate pending negotiations per customer/service. `price_negotiation_rounds` records every counteroffer with author, amount and message.

It is wired into the UI (`NegotiationModal` at `app-home-screen.tsx:2181`, reached from service detail when `isNegotiable`), emits five notifications, and the agreed price feeds into booking via the `consumed` state.

**Classification: 1 — implemented and working.** It should not be hidden.

The genuine gap is narrower: negotiations attach **only** to `service_id`. There is no negotiation on a bid, an award, or a change request. That is a _coverage_ gap to fill later, not a reason to remove a working feature.

---

## 6. Calendar — correcting an assumption

The brief suggested the calendar may be a disconnected placeholder. It is not.

`calendar-screen.tsx` imports `Reservation`, `ReservationProfile`, `ReservationSlot` from shared and calls `reservationsApiClient`. It renders real availability slots and real bookings, with `calendar-utils.test.ts` covering the date logic.

**Classification: 2 — implemented, poorly integrated.** It shows bookings but not proposal deadlines, milestone due dates, or award-acceptance expiry — the events that would make it central. Extend it; do not hide it.

---

## 7. What can and cannot be protected without integrated payments

This must be stated plainly, because over-promising here creates legal and reputational exposure.

### Cannot be protected

- **Payment recovery.** The platform never holds job money. A dispute cannot claw back funds.
- **Guaranteed payment to the provider.** If a customer refuses to pay, the platform has no lever.
- **Refund to the customer.** Same, inverted.
- **Verified project value.** Self-reported, unverifiable — which is exactly why percentage commission was correctly avoided.

**The dispute UI must not imply otherwise.** Any copy suggesting the platform "protects your payment" or "resolves payment disputes" is false and should be removed or rewritten before launch.

### Can be protected

| Mechanism                                              | Status                    |
| ------------------------------------------------------ | ------------------------- |
| Identity verification of both parties                  | 1                         |
| Communication evidence (timestamped, server-side)      | 1                         |
| Provider payment details recorded + disclosure audited | 1                         |
| Reputation consequence via reviews                     | 5 on need path — fix      |
| Approval history (who approved what, when)             | 6 — build with milestones |
| Deliverable timestamps                                 | 6 — build with milestones |
| Standard service contract template                     | 6                         |
| Deposit **recorded** (not held) in the project         | 6                         |

The honest positioning: **MohandisHub provides evidence and reputational consequence, not financial guarantee.** Milestones and approval history are what convert that from a claim into a record — which is a further argument for building them.

### Provider protection from low-trust customers

Currently: `requireVerified` (KYC) applies to **providers**, not customers. A customer needs only a verified email to post a need and award it. The provider then pays MHC to reach a party about whom the platform knows almost nothing.

Minimum protections to add:

1. **Phone verification required before awarding.** OTP infrastructure already exists (class 1) — this is wiring, not building.
2. **Show customer history on the award offer**: account age, needs posted, awards made, awards abandoned, completion rate. All derivable from existing tables.
3. **Flag serial abandoners** — customers who repeatedly award and let the window expire — and surface that on the offer card.
4. **Refund the activation fee** when the customer becomes unreachable within a short window. This is the single strongest trust signal available, it costs little, and it directly de-risks the provider's payment.
5. **Customer ratings** — the reverse-review path exists for reservations (class 1); extend it to need-jobs alongside the reviews fix.

Items 1–3 are small. Item 4 needs a policy decision. Item 5 rides along with the reviews repair.
