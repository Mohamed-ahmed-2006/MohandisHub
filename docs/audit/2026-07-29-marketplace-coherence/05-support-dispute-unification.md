# 05 — Support and Dispute Unification

---

## 1. Current state: three unconnected systems

### 1.1 Support tickets — class 1 in isolation, class 5 in fit

`support_tickets`, `support_ticket_messages`, `support_ticket_attachments`.

```
status:   open | in_progress | waiting_reply | resolved | closed
category: bug | suggestion | error | other
```

The threading, attachments, staff-flag and admin queue all work. Two problems:

**The categories are engineering taxonomy, not user problems.** A provider whose customer has stopped responding after activation must file that as `bug`, `suggestion`, `error`, or `other`. All four are wrong. Routing, SLA and staffing all depend on this field, and it carries no useful signal.

**There is no link to any entity.** `support_tickets` has `user_id`, `subject`, `category` — and no `reference_type` / `reference_id`. A user cannot open a case _about_ a specific need, bid, booking or activation. Staff receive free text and must reconstruct context by hand.

### 1.2 Reservation disputes — class 1, scope-limited

`reservation_disputes` + `reservation_dispute_notes` (with `visibility ∈ public|admin`) + `reservation_dispute_evidence` (FK to `private_uploads`, unique per dispute).

This is a genuinely good case file: participant notes, private staff notes, evidence with restricted delete, indexed for admin queues, and two notification types.

**It only works for reservations.** A need-job — the flow the launch model is built around — cannot raise a dispute at all.

### 1.3 Review reports and disputes — class 1, third channel

`review_reports` plus a review-dispute path, its own admin tab, its own notification types (`review_report_resolved`, `review_dispute_resolved`).

### 1.4 The user's experience

Three entry points, three data models, three admin queues, zero connections. The user must decide, before describing the problem, which of three systems it belongs to — and the taxonomy offered by the largest one does not describe their problem.

---

## 2. Design: one Help & Resolution Center

**Principle:** the user describes _what_ is wrong and _what it concerns_. The system decides whether it is a support case or a dispute.

### 2.1 Entry

One button (the existing `SupportFab`, class 1, already global). One flow:

**Step 1 — What is this about?**

| Subject                    | Requires an entity                |
| -------------------------- | --------------------------------- |
| A project or proposal      | pick from the user's needs / bids |
| A booking                  | pick from bookings                |
| A payment or credits       | optionally pick a transaction     |
| My account or verification | no                                |
| Something is broken        | no                                |
| A review                   | pick a review                     |
| Something else             | no                                |

**Step 2 — What is the problem?** Options are contextual to step 1. For "A project or proposal":

- The other party stopped responding
- The work was not delivered as agreed
- I was charged incorrectly
- Contact details did not unlock
- I want to cancel
- Other

**Step 3 — Describe and attach.**

At no point does the user choose "support" or "dispute".

### 2.2 Routing

```
if (subject has an eligible linked entity
    && problem_type ∈ CONFLICT_TYPES
    && the entity reached an eligible state)
  → case_type = 'dispute'
else
  → case_type = 'support'
```

`CONFLICT_TYPES` = not-delivered, not-responding, charged-incorrectly, quality, cancellation-refused.

**Eligible entity states** — a dispute needs something to dispute:

| Entity      | Eligible when                                |
| ----------- | -------------------------------------------- |
| Need-job    | activated (`needs.activated_at IS NOT NULL`) |
| Booking     | accepted or later                            |
| Transaction | completed                                    |
| Review      | exists and is not the reporter's own         |

An account or technical problem is always a support case. A conflict about a paid, activated engagement is always a dispute.

### 2.3 Escalation preserves everything

The key requirement: escalating must not lose the conversation.

Achieved by making case type a **column**, not a table:

```sql
ALTER TABLE support_tickets
  ADD COLUMN case_type       VARCHAR(20) NOT NULL DEFAULT 'support'
    CHECK (case_type IN ('support','dispute')),
  ADD COLUMN reference_type  VARCHAR(40),
  ADD COLUMN reference_id    UUID,
  ADD COLUMN problem_type    VARCHAR(60),
  ADD COLUMN escalated_at    TIMESTAMPTZ,
  ADD COLUMN escalated_by    UUID REFERENCES users(id),
  ADD COLUMN resolution      TEXT,
  ADD COLUMN resolved_by     UUID REFERENCES users(id),
  ADD COLUMN counterparty_id UUID REFERENCES users(id);

-- A dispute must name what it disputes.
ALTER TABLE support_tickets
  ADD CONSTRAINT chk_support_tickets_dispute_shape
  CHECK (case_type <> 'dispute' OR (reference_type IS NOT NULL AND reference_id IS NOT NULL))
  NOT VALID;

CREATE INDEX idx_support_tickets_reference
  ON support_tickets(reference_type, reference_id)
  WHERE reference_type IS NOT NULL;
```

Escalation is then `UPDATE support_tickets SET case_type='dispute', escalated_at=now(), reference_type=…, reference_id=…`. **Messages and attachments keep the same `ticket_id`. Nothing moves. Nothing is lost.** This is the entire reason for choosing a column over a second table.

`NOT VALID` on the constraint means existing rows are not re-checked, so the migration cannot fail on legacy data. Validate later once backfill is confirmed.

### 2.4 Counterparty visibility

A dispute has two sides. `counterparty_id` names the other party; a `visibility` column on messages (mirroring `reservation_dispute_notes`) controls who sees what:

- `participants` — both parties and staff
- `admin` — staff only

Before escalation, `counterparty_id` is `NULL` and every message is effectively private to the reporter and staff — matching current support behaviour exactly.

---

## 3. Migration plan for existing disputes

**Do not drop `reservation_disputes`.** It is class 1, has live data, and is referenced by the reservation lifecycle worker and two notification types.

**Phase 1 — additive.** Add the columns above. Existing tickets default to `case_type='support'`. `reservation_disputes` untouched. Both admin queues run.

**Phase 2 — dual-write.** New reservation disputes create a `support_tickets` row (`case_type='dispute'`, `reference_type='reservation'`) _and_ a `reservation_disputes` row, linked by `support_ticket_id`. The reservation lifecycle worker keeps working against the old table.

**Phase 3 — backfill.**

```sql
INSERT INTO support_tickets (user_id, subject, category, case_type, reference_type,
                             reference_id, status, counterparty_id, created_at)
SELECT d.opened_by,
       'Dispute: reservation ' || left(d.reservation_id::text, 8),
       'other', 'dispute', 'reservation', d.reservation_id,
       CASE WHEN d.resolved_at IS NOT NULL THEN 'resolved' ELSE 'open' END,
       CASE WHEN d.opened_by = r.customer_id THEN r.provider_id ELSE r.customer_id END,
       d.created_at
FROM reservation_disputes d
JOIN reservations r ON r.id = d.reservation_id
WHERE NOT EXISTS (
  SELECT 1 FROM support_tickets t
  WHERE t.reference_type = 'reservation' AND t.reference_id = d.reservation_id
);
```

Then migrate `reservation_dispute_notes` → `support_ticket_messages` (preserving `visibility`) and `reservation_dispute_evidence` → `support_ticket_attachments`.

**Phase 4 — read from the unified table.** Point the UI and admin queue at `support_tickets`. Keep `reservation_disputes` as a read-only historical record.

**Rollback at every phase:** phase 1 drops columns; phase 2 stops dual-write; phase 3 deletes backfilled rows by `reference_type='reservation'`; phase 4 reverts the read path. No original row is ever mutated or deleted.

---

## 4. Replace the category taxonomy

Keep the `category` column (schema stability, admin filters depend on it). Introduce `problem_type` as the real signal and map old values forward:

| Old `category` | New `problem_type` |
| -------------- | ------------------ |
| `bug`          | `technical_issue`  |
| `error`        | `technical_issue`  |
| `suggestion`   | `feedback`         |
| `other`        | `other`            |

New values: `not_responding`, `not_delivered`, `quality`, `charged_incorrectly`, `contact_not_unlocked`, `cancellation`, `account`, `verification`, `credits`, `technical_issue`, `feedback`, `other`.

Routing, SLA and admin queue grouping all key off `problem_type`.

---

## 5. Admin work queues

`AdminSupportTab` and `AdminDisputesTab` become one **Resolution Center** with queues, replacing per-table browsing:

| Queue           | Filter                                                       |
| --------------- | ------------------------------------------------------------ |
| Unassigned      | `assigned_to IS NULL AND status='open'`                      |
| My cases        | `assigned_to = me`                                           |
| Awaiting user   | `status='waiting_reply'`                                     |
| Disputes — open | `case_type='dispute' AND status IN ('open','in_progress')`   |
| Breaching SLA   | `status='open' AND created_at < now() - interval '48 hours'` |
| Escalated today | `escalated_at > current_date`                                |

Each case shows the linked entity inline — for a need-job: need, bid, activation record, MHC charged, both parties' verification status, and the activation timestamp. That context is what makes a dispute resolvable, and it is exactly what the current unlinked ticket cannot provide.

Permissions: keep `manage_support`. Add `manage_disputes` (currently disputes sit under `manage_transactions`, which conflates money access with case handling). **Do not weaken `super_admin`.**

---

## 6. What a dispute can and cannot conclude

Because the platform holds no job money (see `04` §7), a dispute resolution can:

- record a factual finding,
- apply a reputational consequence,
- refund **MHC** (the platform's own credit — the only value it controls),
- restrict or suspend an account,
- preserve evidence.

It **cannot** transfer money between the parties. Resolution options in the admin UI must be limited to actions the platform can actually perform, and user-facing copy must not imply otherwise.
