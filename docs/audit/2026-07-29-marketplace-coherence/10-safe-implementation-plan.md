# 10 — Safe Implementation Plan

**Governing principle:** the repository contains a large amount of working, tested code. The plan below changes as little of it as possible. Nothing classified 1 or 2 in `12-capability-classification.md` is removed.

---

## 0. Rules that apply to every step

1. **Never delete financial or role code.** Fence it with a fail-closed guard, as `payBid` already does (`needs.service.ts:601`, returning `410 ESCROW_PAYMENTS_RETIRED`). That is the reference pattern.
2. **Never weaken authorization.** New guards are additive. `super_admin` keeps implying all permissions; `loadAdminFromDb` keeps re-reading per request.
3. **Never expose contact data before activation.** Every new read path touching job data calls `ActivationGateService.assertAwardActivated`.
4. **Never let a frontend check replace a backend check.** Route guards are UX; the API remains authoritative.
5. **Every schema change is additive and reversible.** New nullable columns and new tables only. No column drops, no type changes, no data destruction.
6. **Every credit operation is idempotent, transactional and race-safe.** A partial unique index on the natural key, `SELECT … FOR UPDATE` on the wallet row, a `transactions` ledger row.
7. **A hidden feature is still guarded** at both the route and API layers.
8. **Resolve the working tree first.** Nineteen files are uncommitted, several of which this plan touches (`app-shell.tsx`, `wallet-settings-screen.tsx`, `profile-screen-sections.ts`, `app-home-screen.tsx`). Commit or stash before starting.

---

## Stage 1 — Terminology and canonical definitions

**No code.** Agree and record the vocabulary, because every later stage depends on it.

| Concept | Canonical term | Currently also called |
|---|---|---|
| A customer's posted requirement | **Need** | project, RFP, request |
| A provider's response | **Proposal** | bid, application |
| An awarded, activated engagement | **Project** | job, need |
| A service booking | **Booking** | reservation, order |
| A recruitment post | **Hiring post** | job, project |
| Platform credit | **MHC** | credits, نقطة, balance |
| A provider's catalogue | **My Catalogue** | My Services |

Also decide, before any code is written:

- Is a **customer wallet** part of launch? (Audit recommendation: **no**.)
- Are **employment jobs** in the launch surface? (Audit recommendation: **yes, renamed** — hiding a class-1 subsystem is a product call.)
- What is the **bid fee to activation fee ratio**? (Audit recommendation: activation ≈ 10–20× the bid fee.)
- Does the **goods/products** capability exist? (**Blocking** for any taxonomy work — see `12` §B.1.)

---

## Stage 2 — Financial coherence (no schema change)

Frontend only. Fully reversible by `git revert`.

| Step | Item | Independent? |
|---|---|---|
| 2.1 | MHC header pill; remove EGP pill | ✅ |
| 2.2 | Remove the `+` deposit entry point | after 2.1 |
| 2.3 | Remove the withdrawal section; `canRequestWithdrawal` → false | ✅ |
| 2.4 | Hide the wallet section from customers | ✅ |
| 2.5 | `/app/credits` route + sidebar entry | ✅ |
| 2.6 | Retarget wallet notification deep links | ✅ |

**Verify after 2.1–2.6:** no role can reach a deposit or withdrawal surface; a customer sees no financial UI at all; a provider reaches MHC in one click.

**Then, server side (small, additive):**

| Step | Item |
|---|---|
| 2.7 | Fail-closed `410` on retired deposit and withdrawal routes |

**Keep open, explicitly:** `GET /wallet/me`, `/me/transactions`, `/me/transactions/:id/receipt`, and **all webhooks**. An in-flight deposit from before the freeze may still settle; dropping the IPN would strand real money.

---

## Stage 3 — MHC charge primitive (first schema change)

**Migration A — additive only:**

```sql
CREATE TABLE IF NOT EXISTS mhc_action_charges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_key     VARCHAR(80) NOT NULL,
  reference_type VARCHAR(40) NOT NULL,
  reference_id   UUID NOT NULL,
  mhc_charged    NUMERIC(14,2) NOT NULL CHECK (mhc_charged >= 0),
  transaction_id UUID REFERENCES transactions(id),
  refunded_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mhc_action_charge
  ON mhc_action_charges(action_key, reference_type, reference_id);
```

**Rollback:** `DROP TABLE mhc_action_charges;` — nothing else references it.

**Critical constraint:** `mhc_job_activations` and `MhcRepository.chargeActivation` are **not modified**. The new primitive sits beside them. `mhc.activation-race.test.ts` and `award-lifecycle.test.ts` must pass **unmodified** — that is the regression gate for this stage.

Then migrate consumers, one at a time, each independently deployable and revertable:

| Step | Item |
|---|---|
| 3.1 | Ads → MHC (`advertisement` key) |
| 3.2 | Plans → MHC or free (`subscription_upgrade`) |

---

## Stage 4 — Navigation and dashboards (no schema change)

| Step | Item | Independent? |
|---|---|---|
| 4.1 | Rename "Projects" → "Hiring"; add to sidebar | ✅ |
| 4.2 | Rename "My Services" → "My Catalogue" | ✅ |
| 4.3 | Delete the `/app/browse` redirect | ✅ |
| 4.4 | `/app/analytics` route + guard | ✅ |
| 4.5 | Award offers on the provider dashboard | ✅ |
| 4.6 | Tag filtering in search | ✅ |

All six are independent and parallelisable. 4.1–4.3 must land together to avoid a half-renamed navigation.

---

## Stage 5 — Notifications (small schema change)

| Step | Item |
|---|---|
| 5.1 | `mhc_purchase_approved` / `_rejected` |
| 5.2 | `award_activated` → **customer** |
| 5.3 | `activation_reminder` (50% and 90% of the window) |
| 5.4 | `mhc_low_balance` |
| 5.5 | Derive sidebar badges from `getNotificationCategory()` instead of five prefix-matched booleans |
| 5.6 | Log notification delivery failures at `warn` |

`describePurchaseState()` already produces correct bilingual copy for every purchase state and is tested — reuse it rather than writing new strings.

Schema: new notification `type` values plus a low-balance threshold in `app_settings`. Both additive.

---

## Stage 6 — Help & Resolution Center

Four phases, each independently revertable. Detail in `05` §3.

| Phase | Action | Rollback |
|---|---|---|
| 6.1 | Additive columns on `support_tickets`; CHECK added `NOT VALID` | Drop columns |
| 6.2 | Dual-write new reservation disputes to both tables | Stop dual-write |
| 6.3 | Backfill historic disputes into `support_tickets` | Delete rows where `reference_type='reservation'` |
| 6.4 | Point UI and admin queue at the unified table | Revert the read path |

`reservation_disputes` is **never dropped**. It becomes a read-only historical record.

`NOT VALID` on the dispute-shape constraint means existing rows are not re-checked, so the migration cannot fail on legacy data.

---

## Stage 7 — Complete the workflow

**Migration B:**

```sql
CREATE TABLE need_milestones (…);      -- no money columns
CREATE TABLE need_deliverables (…);
ALTER TABLE needs
  ADD COLUMN IF NOT EXISTS customer_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_completed_at TIMESTAMPTZ;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS need_id UUID REFERENCES needs(id);
CREATE UNIQUE INDEX uq_reviews_need_reviewer
  ON reviews(need_id, reviewer_id) WHERE need_id IS NOT NULL;
```

| Step | Item | Depends on |
|---|---|---|
| 7.1 | Milestones + deliverables | Migration B |
| 7.2 | Mutual completion | 7.1 |
| 7.3 | Reviews on completed need-jobs | 7.2 |
| 7.4 | Milestone/deliverable notifications | 7.1 |
| 7.5 | **Bid submission fee** | Stage 3 |
| 7.6 | Proposal comparison | ✅ independent |
| 7.7 | Customer trust signals on the award offer | ✅ independent |

**Every deliverable read passes `assertAwardActivated`.** No money columns on milestones — that coupling is what broke `job_milestones`.

**Ship 7.5 with the price at 0** and raise it deliberately once bid volume is observable.

---

## Stage 8 — Business teams

| Step | Item | Schema |
|---|---|---|
| 8.1 | `uq_business_teams_business` unique index | ✅ small |
| 8.2 | Split `getOverview` from `ensureOwnerTeam` | none |
| 8.3 | Invitation accept page + link email | none |
| 8.4 | Member removal + ownership transfer | none |
| 8.5 | **Enforce team permissions** | none |
| 8.6 | Seat limits from `maxTeamSlots` | none |

8.1–8.4 are prerequisites. **8.5 is where teams become real** — before it, membership grants nothing.

**Invariant:** accepting an invitation must never modify `users.primary_role`. The current code already respects this; preserve it.

---

## Stage 9 — Plans and central entitlements

| Step | Item |
|---|---|
| 9.1 | `EntitlementService.can(userId, workspace, capability)` |
| 9.2 | Migrate scattered checks (`needs`, `jobs`, `auth`) to it |
| 9.3 | Enforce or remove `maxTeamSlots`, `canBusinessFeatured`, `canPriorityListing` |
| 9.4 | Role-aware plan visibility (hide plans where no plan exists for that role) |
| 9.5 | Separate paid-tier badges from verification badges |

9.3 is a genuine choice: a limit that is defined, validated and never enforced is worse than no limit, because it implies a guarantee that does not exist. Either enforce it or delete it from the type.

---

## Stage 10 — Workspace model (largest change)

Only after stages 1–9. Detail in `02` §4.

| Step | Item |
|---|---|
| 10.1 | `workspaces` + `workspace_members`; backfill |
| 10.2 | Nullable `workspace_id` on entity tables |
| 10.3 | `resolveWorkspace` middleware — **header optional**, falls back to `primary_role` |
| 10.4 | `requireWorkspaceKind`, adopted endpoint by endpoint |
| 10.5 | Workspace switcher in the header |
| 10.6 | Capability-driven navigation |
| 10.7 | Business procurement (needs, buying) |

**Non-negotiable:** `X-Workspace-Id` stays optional throughout, and `users.primary_role` is **not dropped**. It is the fallback for every un-migrated endpoint and the rollback path for the whole stage.

**Prerequisite:** extract `ResultCard` and the search panel from `app-home-screen.tsx` (`09` P2-01) **before** 10.6. Adding workspace branching to a 2,430-line file with twenty existing role branches would roughly double it.

---

## Independence matrix

**Fully independent — parallelisable, no schema, no dependencies:**
2.1–2.6 · 4.1–4.6 · 7.6 · 7.7 · 8.1–8.3 · P1-12

**Requires schema migration:**
Stage 3 (Migration A) · Stage 6 (`support_tickets` columns) · Stage 7 (Migration B) · Stage 8.1 (index) · Stage 10 (workspaces)

**Strictly sequential chains:**

```
Stage 3 ──→ 3.1 ads
        └─→ 3.2 plans
        └─→ 7.5 bid fee

7.1 milestones ──→ 7.2 completion ──→ 7.3 reviews

8.1 index ──→ 8.2 read split ──→ 8.5 enforcement

10.1 workspaces ──→ 10.4 guards ──→ 10.7 procurement
```

---

## Migration safety checklist

Before applying any migration:

- [ ] Additive only — no `DROP COLUMN`, no type change, no destructive `UPDATE`
- [ ] New columns nullable, or `NOT NULL` with a default
- [ ] New CHECK constraints added `NOT VALID`, validated separately
- [ ] Rollback SQL written **and tested on a copy**
- [ ] `scripts/migration-dryrun.mjs` clean
- [ ] `scripts/migration-replay-check.mjs` clean
- [ ] Backup taken (`scripts/db-backup.mjs`)
- [ ] Idempotent (`IF NOT EXISTS` / `DO $$`), matching existing repository style

---

## Regression gates

The following must pass **unmodified** after every stage. If a change requires editing one of these tests, that is a signal the change altered a security or money invariant and needs review:

| Test | Protects |
|---|---|
| `mhc.activation-race.test.ts` | Activation cannot double-charge |
| `award-lifecycle.test.ts` | Award state machine |
| `contact-redaction.test.ts` | Contact masking |
| `chat-access.test.ts`, `needs.bid-chat-gate.test.ts` | Pre-activation chat gate |
| `admin-verification-auth.test.ts` | Admin authorization |
| `legacy-egp-reset-migration.test.ts` | Wallet freeze |
| `mhc-presentation.test.ts` | MHC never formatted as currency |

---

## What this plan deliberately does not do

- Does not delete the EGP wallet, escrow, commission, or withdrawal code
- Does not remove employment jobs
- Does not collapse the marketplace taxonomy (see `04` §3 — Option A is rename-and-reroute)
- Does not drop `users.primary_role`
- Does not restructure the admin RBAC model, which is already close to the target
- Does not touch `mhc_job_activations` or `chargeActivation`
- Does not make a decision about goods/products, pending confirmation of where that capability lives
