# MohandisHub — Project Recovery Plan

**Status:** Investigation complete (read-only). Awaiting approval + business decisions.
**Date:** 2026-07-28
**Author:** Engineering agent (session 2, continuing after session 1 exhausted its quota)
**Code changes made so far:** none. Only documents under `docs/release/` were created.

---

## 1. Purpose of this document

This is the entry point. It states where the project actually is, what the other five
documents are for, and the order in which work must happen.

| Document | Purpose |
| --- | --- |
| `PROJECT_RECOVERY_PLAN.md` | This file. Orientation, current state, sequencing. |
| `MHC_RECOVERY_PLAN.md` | **Part A.** Ranked MHC findings and the exact repair sequence. |
| `END_TO_END_COMPLETION_PLAN.md` | **Part B.** 25 ordered phases to launch readiness. |
| `AUDIT_MASTER.md` | Single tracking table for every finding across the project. |
| `DECISIONS_REQUIRED.md` | Business questions that block implementation. **Read this first.** |
| `KNOWN_LIMITATIONS.md` | Accepted gaps, deliberate scope cuts, and things that will ship imperfect. |

---

## 2. Evidence standard used throughout

Every statement in these documents is tagged:

- **VERIFIED** — read directly in the repository at commit `f7fda17`, or observed by
  running `npm run typecheck` / `npm test` locally.
- **INFERRED** — a reasoned conclusion that has not been proven, usually because it
  depends on production data or runtime behaviour I cannot observe.

No production database was queried. No migration was executed. Nothing was reverted.

---

## 3. What the system is

An npm-workspaces monorepo for an Egyptian bilingual (Arabic RTL / English LTR)
services marketplace.

```
apps/api        Express + TypeScript, node-postgres Pool (no ORM), ~35 feature modules
                pattern: routes -> controller -> service -> repository
                separate worker.ts process for background jobs
apps/web        Next.js App Router, 31 page routes, Tailwind
apps/e2e        Playwright harness (no spec files currently present)
packages/shared cross-cutting pure logic + types (app-settings, commission split)
supabase/       83 hand-written SQL migrations, applied manually
render.yaml     deployment configuration
```

**Core domain:** customers post *needs* → providers (`expert`, `craftsman`, `business`)
submit *bids* → customer *awards* → chat → completion → reviews. Alongside this sit a
legacy EGP wallet/escrow money system, reservations/bookings, plans, advertisements,
coupons, business teams, support, retention, disputes, and an admin/super-admin surface
with granular permissions.

**Notable architectural fact (VERIFIED):** there is no generated database type file.
Row types are hand-written per repository. Schema/type agreement is therefore by
convention only and must be checked by reading, not by the compiler. This is the single
biggest reason a green `typecheck` is *not* evidence of correctness on this codebase.

---

## 4. What happened to the interrupted work

All of session 1's work is in a single commit:

```
f7fda17  WIP: preserve Claude unfinished MHC changes
         20 files, +4339 / -83, including 2 new migrations
         and a new apps/api/src/modules/mhc/ module (5 files)
```

The working tree is otherwise clean (only an untracked `.vscode/`).

**Intent (legible from the code and its comments, VERIFIED):** replace the customer
escrow money model with **MHC (Mohandis Credits)** — a closed-loop, non-cashable,
non-transferable, provider-only credit. Customers pay providers **directly**; the
platform never holds job money; MHC becomes the only revenue rail. Awarding a bid
becomes an *offer* rather than an activation, and the provider must accept **and spend
MHC** before the job workspace, contact details, attachments, and provider payment
details unlock.

**Session 1 built the accounting core well and stopped before the model became usable.**

Full detail is in `MHC_RECOVERY_PLAN.md`. The one-line summary:

> The ledger is sound. The product around it does not exist. The launch model has no
> customer→provider payment path, no user interface, and no enforcement of the paywall
> it was designed to create.

---

## 5. Current build and test state (VERIFIED)

| Check | Result |
| --- | --- |
| `npm run typecheck` | **Passes** (exit 0) |
| `npm test` | **Fails** — 6 tests across 2 files; 170 pass (176 total) |
| `npm run lint` | Not yet run |
| `npm run e2e` | Not run; no spec files present |

The 6 failures are all caused by session 1's own changes:

- 5 in `apps/api/src/tests/mhc.service.test.ts` — the fixtures assert
  `bid_status: 'accepted'` / `need_status: 'awarded'`, but the service was subsequently
  changed to require `'awarded_pending'` / `'awarded_pending_provider_acceptance'`.
  Session 1's tests were written against an earlier revision of session 1's own service
  and never updated. This is the clearest single piece of evidence that the work stopped
  mid-refactor.
- 1 in `apps/api/src/tests/needs.service.test.ts` — the `payBid` idempotency test now
  hits the new `ESCROW_PAYMENTS_RETIRED` (410) guard.

**A red suite is the baseline.** No phase may be declared complete while it is red.

---

## 6. The blocking problem, stated plainly

The launch model is: *the customer pays the provider directly, and MohandisHub earns by
selling providers the credits that unlock a job.*

Session 1 retired the escrow rail (VERIFIED: `needs.service.payBid` now throws 410) and
created the `provider_payment_methods` and `provider_payment_disclosures` tables
(VERIFIED: migrations `20260728120000` and `20260728160000`).

It then wrote **no API and no UI for either table.**

The consequence (VERIFIED by absence of any consuming code): after a provider spends MHC
to activate a job, there is no mechanism by which the customer learns how to pay them.
The old money path is closed and the new one was never opened.

Everything else in Part A is secondary to closing that gap.

---

## 7. Sequencing

Work must proceed in this order. Each stage assumes the previous one is green.

```
Stage 0  Decisions          You answer DECISIONS_REQUIRED.md D1-D6.
                            Nothing inside a sensitive flow proceeds without these.

Stage 1  MHC recovery       Part A. Restore a coherent, enforced, usable MHC flow.
                            See MHC_RECOVERY_PLAN.md "Minimal Recovery Path".

Stage 2  Platform completion Part B phases 1-25, in order.
                            See END_TO_END_COMPLETION_PLAN.md.

Stage 3  Launch decision     Part B phase 25. Explicit go / no-go with evidence.
```

**Unblocked work that can start immediately, before any decision:** repairing the red
test suite to match the intended contract (Part A, M1), and the read-only production
data checks listed in `DECISIONS_REQUIRED.md` (they inform D1 and MHC-11).

Everything else touching MHC pricing, wallet balances, payments, refunds, provider
activation, award semantics, contact gates, permissions, destructive migrations, user
deletion, factory reset, or production configuration is **held** until the relevant
decision is answered.

---

## 8. Working agreements for the implementation phases

Carried forward from the operating instructions, recorded here so they survive a context
reset:

1. Reconfirm intended behaviour from repository evidence + approved decisions before each phase.
2. Smallest coherent change set per phase. No opportunistic refactoring.
3. Preserve existing valid data and balances. Non-destructive migrations only.
4. Financial and authorization logic stays server-authoritative.
5. Atomic DB operations for anything touching balances or state transitions.
6. Idempotency for payment, wallet, and retryable operations.
7. Add or update tests with the change, not after.
8. Run targeted tests, then typecheck, lint, and the broader suite.
9. Report failures honestly, including partial ones.
10. Commit only when the phase is coherent and verified.
11. Update `AUDIT_MASTER.md` and this plan as part of the phase, not afterwards.

**Explicitly out of scope** until separately requested: the tiered EGP→MHC exchange-rate
proposal in `mhc_tiered_pricing_implementation_prompt.md` at the repository root. The
immediate priority is stabilising current launch MHC behaviour.

---

## 9. What I have not yet inspected

Stated so the plan's confidence is not overread. These are surveyed at breadth sufficient
for phasing in Part B, but not deep-read:

- `wallet.service.ts` (66 KB) and most of `wallet.repository.ts` (70 KB)
- Reservations/bookings lifecycle and its worker
- Jobs, hiring, interviews, milestone escrow
- Disputes, refunds, reversals, money audit
- Notifications and email delivery
- The full admin / super-admin permission matrix
- Auth, session, and account-recovery flows
- The entire `apps/web` surface: RTL/LTR correctness, responsiveness, API contract drift
- `render.yaml`, env validation, backups, rollback

Part B allocates a phase to each. Findings from those phases will be added to
`AUDIT_MASTER.md` as they are discovered.
