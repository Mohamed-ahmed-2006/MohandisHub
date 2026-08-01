# Wave 2G-A / 2H — backend blocker repair

Repairs to the completed Wave 2G/2H implementation, against the findings in
[`docs/audit/2026-07-31-wave-2gh-final-review.md`](../audit/2026-07-31-wave-2gh-final-review.md)
(review commit `a45474a2`).

- Branch: `fix/wave-2gh-backend-blockers`, from `feat/wave-2gh-team-backend-integration` (`9ea54d4`)
- Baseline: `origin/main` = `b2d146e`
- Migration repaired in place: `20260731120000_business_workspace_membership_invariants.sql` (still unapplied — 101 applied in production)
- Production migrations applied by this work: **none**

---

## 1. Product scope

Wave 2G is split, and the split is now visible in the API rather than only in a
document.

### Wave 2G-A — shipped

Team administration, team roles, invitations, membership management, workspace
access, and Owner/Admin/Member authorization **inside the team-administration
subsystem**.

### Wave 2G-B — deferred to a later workspace-principal phase

Delegated services, jobs/hiring, analytics, advertisements, bookings/orders,
plans, wallet and MHC; and workspace-wide financial authority.

Every one of those domains keys its rows to an account id that is simultaneously
the financial actor — service activation runs through `ActivationGateService`,
job milestones move escrow, and both charge MHC. Delegating them means
separating the acting member from the owning principal inside those paths, which
is a phase of its own.

**The API no longer claims otherwise.** Six of the seven storable permissions
were previously returned as effective while no endpoint read them. They are now
reported under `reservedPermissions`, are not grantable, and are never counted by
an authorization decision. Values already stored on existing roles are preserved
untouched.

| Permission                                                                                                          | Wave 2G-A                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `manage_team`                                                                                                       | **Enforced.** Grantable. Reported as effective.                                 |
| `manage_services`, `manage_jobs`, `manage_reservations`, `view_wallet`, `manage_support_disputes`, `view_analytics` | Reserved. Not grantable, not effective, not deleted from any role that has one. |

Built-in seeds were trimmed to match: Owner and Admin carry `manage_team`,
Member carries nothing. Tier — not the permission array — is what separates the
three.

---

## 2. Ownership transfer is disabled

`POST /api/business-teams/transfer-ownership` exists and always answers:

```jsonc
{ "ok": false, "error": { "code": "OWNERSHIP_TRANSFER_NOT_AVAILABLE", "message": "…" } }
```

409. No membership is read, no lock is taken, no audit row is written, and the
     request body is not even parsed — validating it would imply there is an input
     that succeeds.

**Why.** The previous implementation moved the Owner _membership_: atomic,
race-safe, and correct as far as it went. What it could not move is ownership.
`business_teams.business_id` is immutable by trigger, and every service, job,
advertisement, booking, subscription, wallet balance and ledger row belongs to
that account — as does the primary-role check most of those endpoints still make.
A transferred workspace would have had two principals: one holding team
administration and believing they owned the business, and one still holding every
asset and every charge. Splitting authority and calling it ownership is worse
than not offering it.

**Prerequisite.** A workspace principal separable from the account that
registered it, so assets, charges and financial history can be addressed by
workspace rather than by user id. That is Wave 2G-B.

Consequences elsewhere:

- `allowedActions.transferOwnership` is `false` for everyone, including the
  owner, so no screen offers the action;
- the web client has **no** `transferOwnership` method;
- the panel states ownership as a fact instead of offering a control;
- `OWNER_ROLE_IMMUTABLE` and `OWNER_CANNOT_BE_REMOVED` no longer say "transfer
  ownership first", because there is no such route.

---

## 3. Blocker resolution

| #   | Blocker                            | Resolution                                                                                                                                                                                                                                           |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | One workspace per business account | `uq_business_teams_business_id`; provisioning rewritten to `INSERT … ON CONFLICT (business_id) DO NOTHING` + reselect. Ten concurrent first-access calls produce one workspace, one owner, one audit row, and all ten callers resolve the same team. |
| 2   | Exactly one Owner at commit        | Deferred constraint trigger (`DEFERRABLE INITIALLY DEFERRED`) alongside the existing partial unique index. Upper bound immediate, lower bound at commit.                                                                                             |
| 3   | Migration compatibility            | Backfills before constraints; preflight refusals for states that cannot be repaired deterministically.                                                                                                                                               |
| 4   | Workspace access for invited users | `GET /workspaces` + a server-verified `?teamId=` selector on every team operation, plus a `/{locale}/workspaces` route that does not depend on the account role.                                                                                     |
| 5   | Invitation continuation            | Session-scoped capture, URL scrub, `next` carried through sign-in, sign-up and email verification, cleared on terminal outcomes.                                                                                                                     |
| 6   | Atomic audit events                | Already atomic; now proven by a test that makes the audit insert fail at the database and asserts the mutation rolled back. Provisioning is audited too.                                                                                             |
| 7   | Primary-role owner protection      | Service guard in `changeUserRole` + a database trigger on `users`.                                                                                                                                                                                   |
| 8   | Permissions exposed                | Split into launch/reserved (§1).                                                                                                                                                                                                                     |
| 9   | Invitation abuse and seats         | Existing `maxTeamSlots` plan entitlement enforced transactionally; technical ceiling when unconfigured; per-IP rate limit on invitation creation.                                                                                                    |
| 10  | Historical role fidelity           | `role_name_snapshot`, written once at invitation time and never rewritten.                                                                                                                                                                           |
| 11  | Route and documentation accuracy   | `/api` everywhere; the `/api/v1` references are gone.                                                                                                                                                                                                |

---

## 4. Schema changes

Migration `20260731120000` was **repaired in place** — it has never been applied,
so there is no deployed state to migrate away from.

### Preflight (new, section 0)

Three states cannot be repaired deterministically, because each is a decision
about which row is real. The migration inspects them first and refuses:

- a business account owning more than one workspace;
- a workspace with more than one stored owner;
- a membership referencing another workspace's role.

Read-only inspection of production found **none of the three**, plus: no revoked
invitations, no duplicate pending invitations, no tier drift, no malformed token
hashes, no out-of-range expiry, no null `role_id`. `maxTeamSlots` is **unset on
all four plans**.

### Added

| Object                                                              | Purpose                                                                                                                                                                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uq_business_teams_business_id`                                     | One workspace per account, and the `ON CONFLICT` target that makes provisioning idempotent.                                                                                                   |
| `business_workspace_assert_one_owner()` + two `CONSTRAINT TRIGGER`s | Exactly one owner per **committed** workspace. Deferred, so a transaction may pass through an ownerless instant. Skips a workspace that no longer exists, so `ON DELETE CASCADE` still works. |
| `users_protect_workspace_owner_role()` + trigger                    | An account owning a workspace cannot leave the `business` primary role while it exists.                                                                                                       |
| `business_team_invites.role_name_snapshot`                          | The role as offered. Backfilled from the current role name.                                                                                                                                   |

### Backfills (deterministic, before the constraints they satisfy)

| Backfill                      | Rule                                                                                                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `business_members.role`       | Recomputed from `role_id` by the same rule as the trigger, so the owner index is built over a reconciled column.                                                                                                                                            |
| `revoked_at`                  | `COALESCE(updated_at, created_at)` for `status = 'revoked'`. The baseline revoke path wrote a status and an `updated_at` at a time when no `revoked_at` column existed; validating "revoked implies a timestamp" without this aborts on the first such row. |
| `accepted_at`                 | The mirror image, for symmetry.                                                                                                                                                                                                                             |
| Stray timestamps              | A `revoked_at` on a non-revoked row (or `accepted_at` on a non-accepted one) is cleared — it would fail the same checks.                                                                                                                                    |
| Duplicate pending invitations | Retired oldest-first to `expired`. Rows, token digests and audit trail all survive; only the claim that they are live is withdrawn.                                                                                                                         |

### Rollback

Extended for the new objects and asserted by an exact-fingerprint test that now
covers **triggers** as well as tables, columns, constraints and indexes, and
restores the table comment the migration changes.

### Historical data

Nothing is deleted, merged or re-keyed. Every value written is derived from a
value the row already carried.

---

## 5. Workspace access

```
GET  /api/business-teams/workspaces          -> { workspaces[], defaultTeamId }
GET  /api/business-teams/me?teamId=…         -> overview for that workspace
POST/PATCH/DELETE …?teamId=…                 -> the same selector on every mutation
```

`teamId` is a **selector, never a grant**. It is matched inside the resolver's
own membership query:

```sql
WHERE ($2::uuid IS NULL OR t.id = $2::uuid)
  AND (t.business_id = $1
       OR t.id IN (SELECT team_id FROM business_members WHERE user_id = $1))
```

It can only narrow the set the caller already qualifies for. A workspace that
belongs to somebody else and a workspace that does not exist produce the same
`403 WORKSPACE_NOT_ACCESSIBLE`, so the selector never confirms that a team id is
real. Omitted, the caller's own business workspace wins and otherwise their
oldest membership — which is what every existing single-workspace client got.

Naming a foreign workspace never provisions one as a side effect. (That was a
real defect in the first cut of this change; the test caught it.)

The account role is not a term in any of it. `/{locale}/workspaces` renders the
team panel for anyone with a membership, which is what makes the
post-acceptance link land somewhere real for a customer, expert or craftsman —
previously the panel existed only inside the business-only dashboard, so an
invited member was told they had joined and then shown nothing.

---

## 6. Invitation continuation

`apps/web/lib/business-teams/invitation-continuation.ts`:

1. **Capture** the token from the query string into `sessionStorage` and remove
   it from the address bar with `history.replaceState` — so it leaves the
   history entry, the next navigation's `Referer`, and any screenshot. Other
   query parameters are preserved.
2. **Keep** it across the redirects authentication needs. The return path in
   `?next=` is the bare route and carries **no token**, so the auth URL, the
   verify-email URL and every history entry between them are clean.
3. **Forget** it on accepted, already-used, expired, revoked and malformed.
   `wrong_account` deliberately does not clear it — signing in as the invited
   person is the retry that works.

`sessionStorage`, not `localStorage` and not a cookie: it dies with the tab, is
never attached to a request, and is unreadable cross-origin. The raw token is
never written to a durable application database; the only durable record
anywhere is the SHA-256 digest.

`auth-form.tsx` now carries `next` through to the verification screen for an
unverified account instead of discarding it, and `verify-email-screen.tsx`
resumes it — the step that previously stranded every recipient who created an
account to accept an invitation. Both re-check the same allowlist
(`/{locale}/app`, `/{locale}/invitations/accept`; protocol-relative and absolute
URLs rejected first).

---

## 7. Seats and abuse

`maxTeamSlots` already existed in `plan_limits`; it is now read rather than
ignored. No paid seat tier is invented.

- a seat is a membership **or** a live pending invitation, counted together
  inside the creating transaction under the workspace row lock, so two
  simultaneous invitations cannot both claim the last one;
- **no plan configures `maxTeamSlots` today**, so launch has no commercial
  seat-tier enforcement. The effective limit is a technical ceiling of 50 — a
  guard against a workspace being used as an unbounded invitation-email relay,
  not a price boundary;
- duplicate-pending prevention is unchanged;
- invitation creation is rate limited per IP (30/hour) on top of the seat count,
  which also bounds the revoke-and-resend loop;
- nothing reveals whether an address has an account: `ALREADY_A_MEMBER` and
  `INVITE_ALREADY_PENDING` are facts about the caller's own workspace.

---

## 8. Verification

| Check                                     | Result                                                               |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `npm run typecheck`                       | pass                                                                 |
| `npm run lint`                            | pass                                                                 |
| `npm run validate:i18n`                   | pass                                                                 |
| `npm run test`                            | pass — shared 17, API 514 + PG skipped, web 243                      |
| `npm run build -w @mohandishub/api`       | pass                                                                 |
| `npm run build -w @mohandishub/web`       | pass                                                                 |
| `node scripts/migration-dryrun.mjs`       | pass — applied against the live schema in a transaction, rolled back |
| `node scripts/migration-replay-check.mjs` | pass — pending-migration objects only, zero live-only drift          |
| `business-teams.workspace.pg.test.ts`     | 37 pass                                                              |
| `business-teams.invariants.pg.test.ts`    | 26 pass                                                              |

Race results: ten concurrent first accesses → one workspace; ten concurrent
accepts → one membership; accept-vs-revoke → deterministic over six repeats;
sixteen concurrent membership mutations → one owner throughout.

Production: 101 applied migrations, unchanged data, zero scratch databases left
behind.
