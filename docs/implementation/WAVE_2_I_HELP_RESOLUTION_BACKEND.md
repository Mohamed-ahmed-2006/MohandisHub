# Wave 2I — Unified Help & Resolution: backend and integration

Companion to `WAVE_2_I_HELP_RESOLUTION_UI_CONTRACT.md`, which specified the
frontend and listed the endpoints it needed. This records what was actually
built, where the contract moved, and why.

Branch: `feat/wave-2i-backend-integration` (from `origin/main` @ `b2d146e`, with
the four `feat/wave-2i-help-resolution-ui` commits cherry-picked).

---

## 1. Why a spine instead of a rewrite

Two case engines already existed and both hold live user data:

| Engine | Tables |
| :--- | :--- |
| Platform support | `support_tickets`, `support_ticket_messages` |
| Reservation escrow disputes | `reservation_disputes`, `reservation_dispute_notes`, `reservation_dispute_evidence` |

Neither was rewritten. Two reasons decided it:

1. **Every historical ticket and open dispute would have gone through a data
   migration** to gain a column layout, with no product benefit and a real
   chance of losing a row.
2. **The dispute resolver moves money.** `POST /api/reservations/disputes/:id/resolve`
   refunds, captures and releases inside one transaction. Any design that gave a
   second resolver authority over that row risked a dispute reading as resolved
   while the money sat untouched.

Instead, `resolution_cases` is a **case spine**: one row per case carrying the
unified fields, linked to whichever engine backs it, kept in step by triggers so
the legacy write paths remain authoritative. Case kinds that had no engine —
need/job disputes, direct-payment issues, safety reports — live natively in the
spine with their own messages, evidence and timeline.

Migration: `supabase/migrations/20260801090000_unified_help_resolution_cases.sql`.
It creates only new objects; the clean-replay check reports **zero** `only-live`
differences, meaning nothing existing was altered. Every historical ticket and
dispute is backfilled, and the backfill is re-runnable.

---

## 2. Routes

Mounted at `/api/help-resolution` (the repository mounts its API at `/api`, not
`/api/v1`; the UI contract's `/api/v1/...` paths are the only place that prefix
appears).

### User surface

| Method | Route | Purpose |
| :--- | :--- | :--- |
| `GET` | `/cases` | Unified paginated listing. Filters: `kind`, `status`, `search`, `escalated`, `page`, `limit`. |
| `GET` | `/cases/:caseId` | Full case file: messages, evidence, timeline, resolution, escalation, capabilities. |
| `POST` | `/cases` | Open a case. Discriminated on `kind`. |
| `POST` | `/cases/:caseId/messages` | Post to the thread. |
| `POST` | `/cases/:caseId/evidence` | Attach a private upload. |
| `POST` | `/cases/:caseId/escalate` | Escalate for admin review, once. |
| `GET` | `/availability` | Which kinds this caller may open, and against what. |
| `GET` | `/cases/by-support-ticket/:ticketId` | Historical `/app/support?ticketId=…` deep links. |
| `GET` | `/cases/by-reservation-dispute/:disputeId` | Historical `/app/disputes?disputeId=…` deep links. |

### Admin surface

Requires `authenticate` → `loadAdminFromDb` → `requireRole('admin')` →
`requireAdminAnyPermission('manage_support', 'manage_transactions')`.

| Method | Route | Purpose |
| :--- | :--- | :--- |
| `GET` | `/admin/cases` | Queue, escalated first. |
| `GET` | `/admin/cases/:caseId` | Case file including internal notes. |
| `POST` | `/admin/cases/:caseId/messages` | Reply, or add an internal note (`visibility: "admin"`). |
| `POST` | `/admin/cases/:caseId/assign` | Assign or unassign. |
| `POST` | `/admin/cases/:caseId/status` | Move to `open` / `awaiting_user` / `under_review`. |
| `POST` | `/admin/cases/:caseId/resolve` | Resolve or close with an outcome. |

The user surface reads **no** admin flag at all. `req.user.isAdmin` there comes
from a JWT that may be hours old; anything an admin does as an admin goes
through `/admin/*`, which re-reads the flag and the permission set from the
database on every request.

---

## 3. Deviations from the UI contract

| UI contract | Built | Why |
| :--- | :--- | :--- |
| `POST /help-resolution/job-disputes` | `POST /cases` with `kind: "need_job_dispute"` | One creation endpoint keeps validation, duplicate prevention, evidence ownership and notification in one place. |
| `POST /help-resolution/payment-disputes` | `POST /cases` with `kind: "direct_payment"` | Same. |
| `referenceCode: "TKT-84920"` (client-derived from the id) | `MH-000042`, server-issued from a sequence | Eight hex characters of a uuid collide with roughly even odds inside a hundred thousand cases, and a reference a support agent reads aloud must stay unique. |
| `unreadCount` | `messageCount` | There is no per-user read marker on either engine, so an unread count could only have been invented. |
| Safety reports fall back to a support ticket with `category: "bug"` | Native `safety_report` kind | A safety report has a reported party who must never gain access; that is a different authorisation rule from any dispute, and it is now enforced in the schema. |

---

## 4. Authorisation

A case is visible to:

- the user who opened it;
- a counterparty holding an **explicit** grant (`counterparty_access = true` —
  the presence of `counterparty_id` grants nothing);
- an admin with `manage_support` or `manage_transactions`, through `/admin/*`.

Anybody else receives **404**, not 403. For a safety report, confirming that a
case exists about a given subject is itself the disclosure.

`chk_resolution_cases_safety_is_private` forbids a safety report from carrying a
counterparty at all, at the schema level, because an application-layer slip
there costs a reporter their anonymity.

### Status is server-authoritative

The request body says what the caller wants to post, never what the case should
become. A participant replying moves an open case to `under_review`; a staff
reply moves it to `awaiting_user`; terminal cases refuse further messages with
`409 CASE_NOT_OPEN`. The admin status route accepts only non-terminal statuses —
resolving goes through `/resolve`, which records an outcome.

`escalated` is deliberately **not** a stored status. A legacy-backed case has
its stored status overwritten whenever its engine writes, so an escalation
stored there would be silently lost; it lives in `escalated_at` and is projected
into `status` by the API for every kind alike.

---

## 5. Evidence

Evidence is a reference to a row in `private_uploads`. The API returns
`/api/upload/private/:id` and **nothing else** — no bucket, no object path, no
pre-signed bucket URL.

`GET /api/upload/private/:id` decides access from what the file is attached to:

- the uploader;
- a verification or transactions admin (the pre-existing blanket grant);
- a **case participant** — opener, or counterparty with an explicit grant;
- a **reservation dispute participant**;
- a `manage_support` admin, but only for files that are case evidence.

That last scoping matters: the same private bucket stores identity documents,
so widening the blanket grant to reach a dispute file would have handed support
admins ID scans along with it.

This also closed a pre-existing gap. A reservation dispute's counterparty could
already *see* the other side's evidence listed in the case file and got 403 on
opening it, because the upload route had no idea reservation disputes existed.

---

## 6. Honest unavailability

`GET /availability` reports, per creatable kind, whether the caller may open it
and — when they may not — a machine-readable `reasonCode` plus the engagements
they could open it against.

- **`need_job_dispute`** requires a need with `activated_at` set (status
  `awarded` / `in_progress` / `completed`) or an **accepted** job application.
  Before activation the provider has not paid and no engagement exists, so a
  case there would be unadjudicable.
- **`direct_payment`** requires an `mhc_job_activations` row for the
  engagement — the same evidence chat access uses, written in the same
  transaction as the MHC debit, so it cannot claim an engagement nobody paid
  for.
- **`general_support`** and **`safety_report`** are always available.

Creation re-checks independently and answers `409 MARKETPLACE_DISPUTE_UNSUPPORTED`
or `409 DIRECT_PAYMENT_DISPUTE_UNSUPPORTED`. The frontend keys its wording on
the reason code, so an Arabic reader gets an Arabic explanation rather than the
server's English sentence.

**Reservation disputes remain uncreatable from the centre.** They are opened
from the booking, because the admin action that decides them also settles the
money held against that reservation.

---

## 7. Duplicate prevention

`uq_resolution_cases_live_dispute_subject` — a partial unique index over
`(kind, subject_type, subject_id, opened_by)` while the case is live — allows
one open dispute per person per engagement. A second one is by definition the
same dispute, and two of them means two admins reaching two answers. The index
does the deciding, so ten concurrent submissions produce one case and nine
`409 DUPLICATE_CASE`.

Safety reports are excluded: a second report about the same user is usually a
second incident, and refusing it would silence a reporter.

---

## 8. Notifications

Five types, all categorised under `disputes` alongside the reservation events —
a new category would have reset every existing user's stored preferences.

| Type | Sent to |
| :--- | :--- |
| `resolution_case_opened` | The counterparty, when the case grants them access |
| `resolution_case_message` | Participants other than the author |
| `resolution_case_escalated` | The other participant |
| `resolution_case_status_changed` | Participants |
| `resolution_case_resolved` | Participants |

`reported_user_id` never receives anything. Telling somebody a safety report
about them exists is the one notification this system must not send.

All five navigate to `/app/help-resolution?caseId=…`; the centre is the only
screen that can render a case of any kind.

---

## 9. Compatibility

- `support_tickets` and `reservation_disputes` are unchanged in structure and
  content. Their routes still work and are still the write path for their kinds.
- `/app/support` and `/app/disputes` still resolve, now rendering the unified
  screen with the matching tab preselected.
- `?ticketId=`, `?disputeId=` and `?caseId=` all open the target case. The
  legacy ids resolve server-side, so a link to a case that is not on the loaded
  page still works.
- `/app/support` and `/app/disputes` stay in `MANAGED_SIDEBAR_HREFS`: a
  deployment may already have one stored in `sidebar_hidden_hrefs`, and dropping
  them would make the next settings save fail validation. The merged nav entry
  is hidden only when **both** legacy entries were hidden.

---

## 10. Out of scope, untouched

No escrow was introduced. No advertisement, plan, MHC or business-team code was
modified. No production migration was run.

---

## 11. Tests

`apps/api/src/tests/help-resolution.pg.test.ts` — 32 cases through the real
express app against a scratch PostgreSQL database built by replaying every
migration. Opt in with `RUN_PG_INTEGRATION=1`.

`apps/web/tests/help-resolution-integration.test.ts` — the client/server
contract, notification deep links, Arabic/English parity, mobile layout.
