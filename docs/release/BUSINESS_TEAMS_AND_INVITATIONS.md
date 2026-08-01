# Business Teams and Invitations (Wave 2G / Wave 2H)

Business workspace membership, permissions, and the secure invitation lifecycle.

- Branch: `feat/wave-2gh-team-backend-integration`
- Baseline: `origin/main` = `b2d146e`
- Migration added: `20260731120000_business_workspace_membership_invariants.sql`
- Production migrations applied by this work: **none**. The migration is dry-run
  verified against the live schema and is pending deployment.

> **Superseded in part.** Ownership transfer is **not available**, and six of the
> seven workspace permissions are **reserved rather than enforced**. Wave 2G is
> split into 2G-A (shipped: team administration, roles, invitations, membership,
> workspace access) and 2G-B (deferred: delegated services, jobs, analytics,
> advertisements, bookings, plans, wallet, MHC). See
> [`docs/release/WAVE_2GH_BACKEND_BLOCKERS.md`](./WAVE_2GH_BACKEND_BLOCKERS.md)
> for what changed and why.

---

## 1. What existed before

The tables have been in place since `20260318000002` (`business_teams`,
`business_members`) and `20260613120000` (`business_team_roles`,
`business_team_invites`, `business_team_audit_log`). The API around them was one
516-line route file with no service layer, no authorization layer, and these
gaps:

| Area                         | State before                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization                | A single check: `user.role !== 'business'`. Members could not read their own team; any business account was allowed everything.                                                                                         |
| Owner invariant              | None. Nothing prevented two owner rows in one workspace.                                                                                                                                                                |
| Provisioning                 | Re-asserted the business account as `owner` on **every request**, which would have silently reversed an ownership transfer at the next page load.                                                                       |
| Invitation preview           | Did not exist.                                                                                                                                                                                                          |
| Invitation acceptance        | No email match — any authenticated account holding the link could accept. Hard-coded `role = 'member'` regardless of the invited role. `ON CONFLICT DO UPDATE` overwrote the role of somebody already in the workspace. |
| Duplicate invitations        | Unprevented.                                                                                                                                                                                                            |
| Member role update / removal | Did not exist.                                                                                                                                                                                                          |
| Ownership transfer           | Did not exist.                                                                                                                                                                                                          |
| Role belonging               | `business_members.role_id` could reference a role from another workspace.                                                                                                                                               |
| Token                        | Hashed (SHA-256), but the raw token was emailed as body text and nothing structurally prevented storing plaintext.                                                                                                      |
| Custom role keys             | `custom_${Date.now()}` — two roles created in the same millisecond collided into a 500.                                                                                                                                 |

### Production data compatibility

Read-only inspection of the live database before any change:

| Fact                                          | Value                                   |
| --------------------------------------------- | --------------------------------------- |
| Workspaces                                    | 1                                       |
| Memberships                                   | 1 (all `owner`)                         |
| Workspaces with 0 owners                      | 0                                       |
| Workspaces with >1 owner                      | **0** — no ambiguity, no stop condition |
| Built-in roles seeded per workspace           | `owner`, `manager`, `member`, `viewer`  |
| Members holding `viewer`                      | **0**                                   |
| Members holding a role from another workspace | 0                                       |
| Invitations                                   | 0                                       |
| Non-normalised emails (users or invitations)  | 0                                       |
| Audit rows                                    | 0                                       |
| Applied migrations                            | 101                                     |

---

## 2. Canonical role model

### Product tiers

Three, and only three, are exposed:

| Tier       | Stored in `business_members.role` | Capability                                                                                                                                                                |
| ---------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**  | `owner`                           | Team administration, role management, member removal. Exactly one per workspace. Ownership belongs to the business account and cannot be transferred.                     |
| **Admin**  | `manager`                         | Operational team administration: invite, revoke, update non-owner roles, remove non-owner members. Cannot transfer ownership, grant Owner, or remove or demote the Owner. |
| **Member** | `member`                          | Permitted operations only. No team administration unless an explicit custom permission grants a narrower slice (see below).                                               |

`manager` **is** the Admin tier. The internal value is preserved so no existing
membership row has to be rewritten; the mapping happens in
`business-teams.constants.ts` and in the database trigger, and `manager` is never
presented to a user as a tier of its own. `admin` is accepted as an alias on read
for robustness but is not written.

### The `viewer` value

Classified as a **legacy built-in role**:

- it was seeded into every workspace by the old provisioning path;
- **no member anywhere holds it** (verified against production);
- it is not one of the three approved product tiers.

Treatment: the row is **kept**, flagged `is_legacy = true` by the migration, and
excluded from the assignable set. Any row that ever pointed at it stays valid and
resolves to the **Member** tier. New workspaces do not seed it. Nothing is
deleted, merged or re-keyed.

### Custom roles

Custom roles widen **permissions**, never **tier**. A custom role always resolves
to the Member tier — enforced both in `tierForRole()` and by the
`business_members_resolve_tier` trigger — which is what makes "a custom role
cannot confer ownership" structural rather than advisory.

The one narrow exception the product model allows: a member whose role carries
the explicit `manage_team` permission may invite, revoke, update non-owner roles
and remove non-owner members. It never extends to ownership transfer, granting
Owner, editing roles, or touching the Owner.

Permission arrays are read from the database on every request and filtered
against the known permission set. The **owner's** effective permissions are the
full set unconditionally: a trimmed permission array cannot lock an owner out of
their own workspace.

---

## 3. Authorization

One resolver, `business-teams.authorization.ts`, used by every operation.

```
readWorkspaceContext(db, userId) -> {
  teamId, businessAccountId, teamName,
  userId, memberId,
  tier, isOwner,
  roleId, roleName, roleKey, roleBuiltIn,
  permissions[]
}
```

Guards: `requireWorkspace`, `requireTeamAdministration`, `requireRoleManagement`,
`requireOwnership`. Capabilities: `hasPermission`, `canAdministerTeam`,
`canManageRoles`, `allowedActionsFor`.

### Cross-workspace protection

**No endpoint anywhere in this codebase accepts a business or team identifier
from the client.** Audited across every business-owned surface:

| Surface                                             | How the workspace is determined                               |
| --------------------------------------------------- | ------------------------------------------------------------- |
| Business team, roles, members, invitations          | Resolved from `req.user.id` by the central resolver.          |
| Business settings / profile (`profiles.controller`) | `req.user.id`.                                                |
| Services / catalogue (`services.routes`)            | `req.user.id` as provider, plus per-row ownership checks.     |
| Hiring / jobs (`jobs.routes`)                       | `req.user.id` as the business, plus per-row ownership checks. |
| Business analytics (`analytics.routes`)             | `req.user.id`.                                                |
| Advertisements, reservations, wallet                | `req.user.id`.                                                |

Every member/invitation/role lookup in the team module is additionally scoped by
`team_id = <resolved workspace>` in SQL, so naming an identifier from another
workspace is a **miss**, never a cross-workspace write. Covered by the
`denies every cross-workspace mutation` test.

### Deliberate scope boundary

Delegated member access to jobs, services, catalogue and analytics is **not**
implemented in this wave, and this is deliberate rather than an oversight.

Those surfaces key every row to `req.user.id`, which is simultaneously the
resource owner and the financial actor: job milestones move escrow, service
activation goes through `ActivationGateService`, and both charge MHC. Rewriting
the acting identity there would mean editing protected financial and activation
paths that this wave is explicitly forbidden to touch.

The permission vocabulary (`manage_services`, `manage_jobs`,
`manage_reservations`, `view_wallet`, `manage_support_disputes`,
`view_analytics`) is resolved and exposed server-side today, ready for that work.
No security hole is left open by deferring it: the surfaces are unreachable to a
non-owner rather than loosely guarded.

---

## 4. Endpoints

Mounted at `/api/business-teams` (the router is mounted at `/api`; this project
has no version segment).

Every response is `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.

### `GET /api/business-teams/me`

Authenticated + email-verified. Returns `BusinessTeamOverview`:

```jsonc
{
  "team": { "id": "uuid", "businessId": "uuid", "name": "Acme Corp" },
  "viewer": {
    "userId": "uuid", "memberId": "uuid",
    "tier": "owner" | "admin" | "member",
    "isOwner": true,
    "roleId": "uuid", "roleName": "Owner", "roleKey": "owner",
    "permissions": ["manage_team", "..."],
    "allowedActions": {
      "inviteMembers": true, "revokeInvites": true, "viewInvites": true,
      "updateMemberRoles": true, "removeMembers": true,
      "manageRoles": true, "transferOwnership": false
    }
  },
  "roles": [{ "id": "uuid", "name": "Admin", "key": "manager", "builtIn": true,
              "legacy": false, "tier": "admin", "assignable": true,
              "permissions": ["..."], "memberCount": 2,
              "createdAt": "...", "updatedAt": "..." }],
  "members": [{ "id": "uuid", "userId": "uuid", "email": "...", "displayName": "...",
                "roleId": "uuid", "roleName": "Admin", "roleKey": "manager",
                "tier": "admin", "isOwner": false, "isSelf": false,
                "createdAt": "..." }],
  "invites": [{ "id": "uuid", "email": "...", "roleId": "uuid", "roleName": "Member",
                "status": "pending", "expiresAt": "...", "createdAt": "...",
                "acceptedAt": null }]
}
```

`invites` is `[]` for a caller who may not administer the team. No token or token
hash appears anywhere in the response.

**Not** behind `requireRole('business')`: workspace membership is independent of
the primary account role, so an invited expert or craftsman reaches their own
workspace.

### `GET /api/business-teams/invites/preview?token=...`

The only unauthenticated route in the module. Rate limited (60 / 15 min / IP) on
top of a 256-bit token space. A signed-in caller's token is used to answer the
account-match question; an expired or malformed session is treated as an
anonymous visitor, not a 401.

```jsonc
{
  "state": "valid" | "expired" | "revoked" | "already_used" | "malformed" | "wrong_account",
  "teamName": "Acme Corp",
  "inviterDisplayName": "Alice Owner",
  "maskedEmail": "b••@example.com",
  "roleName": "Member",
  "expiresAt": "2026-08-07T…",
  "requiresAuthentication": true,
  "signedInAccountMatches": true | false | null
}
```

- a token matching nothing returns `malformed` with all fields null — the same
  answer a syntactically bad token gets, so the response shape never confirms
  that a token exists;
- the invited address is always masked;
- `signedInAccountMatches` is `null` for an anonymous visitor, because answering
  it would disclose the invited address;
- nothing here reveals whether any email address has an account.

### `POST /api/business-teams/invites`

Body `{ email, roleId }`. Requires team administration.

Workspace is server-resolved. The role must exist in that workspace, must not be
`owner` (`OWNER_ROLE_NOT_ASSIGNABLE`), and must not be legacy. The email is
canonicalised. Inside one transaction, under a workspace row lock: reject an
existing member (`ALREADY_A_MEMBER`), retire pending invitations that have passed
their expiry, reject a live duplicate (`INVITE_ALREADY_PENDING`), insert with an
explicit 7-day expiry, write the audit row. The email is sent **after commit**.

### `POST /api/business-teams/invites/:inviteId/revoke`

Requires team administration. Scoped to the caller's workspace, so an id from
another workspace is `INVITE_NOT_FOUND`. Pending only; `accepted` returns
`INVITE_ALREADY_ACCEPTED` and the membership is untouched. Revoking an
already-revoked invitation is a **no-op success**.

### `POST /api/business-teams/invites/accept`

Body `{ token }`. Authenticated + email-verified.

Order matters: the invitation row is locked `FOR UPDATE`, then the invited
address is compared against the authenticated account **before** any state is
reported. A stranger holding a leaked link learns only that it is not theirs,
never whether it is still live.

| Situation                                     | Result                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Valid, matching account, not already a member | Membership created with the invitation's own `role_id`; invitation marked accepted with `accepted_by` and `accepted_member_id` |
| Same person clicks again                      | `{ accepted: true, created: false }` — idempotent, no second membership                                                        |
| Already a member by another route             | Invitation accepted, **existing membership left alone**                                                                        |
| Wrong account                                 | `403 INVITE_WRONG_ACCOUNT`                                                                                                     |
| Revoked                                       | `410 INVITE_REVOKED`                                                                                                           |
| Expired                                       | `410 INVITE_EXPIRED`                                                                                                           |
| Unknown token                                 | `404 INVITE_NOT_FOUND`                                                                                                         |

The primary account role is never mutated.

### `PATCH /api/business-teams/members/:memberId`

Body `{ roleId }`. Requires team administration. The owner is refused
(`OWNER_ROLE_IMMUTABLE`). The role must be assignable and belong to this
workspace, so Owner cannot be granted (`OWNER_ROLE_NOT_ASSIGNABLE`) and a role
from another workspace is `ROLE_NOT_FOUND`. Transactional, audited.

### `DELETE /api/business-teams/members/:memberId`

Requires team administration. The owner is refused
(`OWNER_CANNOT_BE_REMOVED`). A member from another workspace is
`MEMBER_NOT_FOUND` — stable, not a silent success. Access ends on the caller's
very next request. Historical records are preserved (§6).

### `POST /api/business-teams/transfer-ownership`

Body `{ memberId, confirmation }`. Owner only.

`confirmation` must equal the workspace name (case-insensitive, trimmed) —
`CONFIRMATION_MISMATCH` otherwise. Inside one transaction: lock
`business_teams`, **re-check ownership under that lock**, lock both memberships,
demote the current owner to Admin, promote the target to Owner, audit.

`business_teams.business_id` is **not** rewritten. It is the account that owns
this workspace's services, jobs, advertisements, wallet and financial history;
moving it would orphan every record keyed to it. What transfers is workspace
administration ownership. A database trigger refuses the column change outright,
so no future code path can make that mistake quietly.

### Error codes

| Code                                                                                                                                                                | Status                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `UNAUTHORIZED`                                                                                                                                                      | 401                                               |
| `NO_BUSINESS_WORKSPACE`                                                                                                                                             | 403                                               |
| `WORKSPACE_MEMBERSHIP_REQUIRED`                                                                                                                                     | 403                                               |
| `WORKSPACE_ADMIN_REQUIRED`                                                                                                                                          | 403                                               |
| `WORKSPACE_OWNER_REQUIRED`                                                                                                                                          | 403 / 409 (409 when lost under the transfer lock) |
| `INVITE_WRONG_ACCOUNT`                                                                                                                                              | 403                                               |
| `MEMBER_NOT_FOUND`, `ROLE_NOT_FOUND`, `INVITE_NOT_FOUND`, `WORKSPACE_NOT_FOUND`                                                                                     | 404                                               |
| `ALREADY_A_MEMBER`, `INVITE_ALREADY_PENDING`, `INVITE_ALREADY_ACCEPTED`, `OWNER_ROLE_IMMUTABLE`, `OWNER_CANNOT_BE_REMOVED`                                          | 409                                               |
| `INVITE_EXPIRED`, `INVITE_REVOKED`                                                                                                                                  | 410                                               |
| `VALIDATION_ERROR`, `CONFIRMATION_MISMATCH`, `OWNER_ROLE_NOT_ASSIGNABLE`, `ROLE_NOT_ASSIGNABLE`, `INVALID_REPLACEMENT_ROLE`, `ROLE_DELETE_BLOCKED`, `ALREADY_OWNER` | 400                                               |

---

## 5. Token security

| Property             | Mechanism                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Randomness           | `randomBytes(32)`, base64url (256 bits)                                                                                                                                                      |
| Storage              | SHA-256 hex digest only                                                                                                                                                                      |
| Plaintext impossible | `CHECK (token_hash ~ '^[0-9a-f]{64}$')`. Raw tokens are base64url, whose alphabet includes `-`, `_` and uppercase — characters this CHECK rejects. Writing the plaintext is a failed INSERT. |
| Delivery             | A link in the invitation email. The token exists in the recipient's inbox and nowhere else.                                                                                                  |
| Logs                 | `request-logging` records `req.path`, never the query string. Email-send failures are logged without the token or the link. `error-handler` never logs the URL or the body.                  |
| API responses        | Neither the token nor its digest is ever serialised.                                                                                                                                         |
| Comparison           | Digest lookup; the email comparison is `timingSafeEqual` after canonicalisation.                                                                                                             |
| Expiry               | 7 days, bounded by `CHECK (expires_at > created_at AND expires_at <= created_at + 30 days)`                                                                                                  |

### Email identity

Canonical form is `trim().toLowerCase()`. `auth.repository` looks accounts up
with `email.toLowerCase()`, so lowercasing is the rule this project already
relies on; trimming can only make two values the repository would already treat
as one compare equal. Production holds zero non-normalised addresses in either
`users` or `business_team_invites`.

### Token survival through authentication

The acceptance page links to `/{locale}/auth?mode=login|register&next=<path>`.
`next` is validated by the auth flow's existing allowlist, widened from
`/{locale}/app` to also permit `/{locale}/invitations/accept`, with
protocol-relative and absolute URLs rejected first. The parameter now survives
the login/register toggle instead of being dropped when the query is rebuilt.

A newly registered recipient still verifies their email before returning to the
invitation — existing, deliberate behaviour. The invitation remains valid for
seven days.

---

## 6. Schema

`supabase/migrations/20260731120000_business_workspace_membership_invariants.sql`

### Added

| Object                                                                                 | Purpose                                                                                                                                                      |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `business_team_roles.is_legacy`                                                        | Marks a built-in role retained for compatibility but no longer offered. Set to `true` for existing `viewer` rows.                                            |
| `business_members_resolve_tier()` + `trg_business_members_resolve_tier`                | Rejects a `role_id` from another workspace (`check_violation`); derives `business_members.role` from the assigned role. Custom roles always map to `member`. |
| `uq_business_members_single_owner`                                                     | Partial unique index on `(team_id) WHERE role = 'owner'`.                                                                                                    |
| `business_teams_reject_business_id_change()` + `trg_business_teams_immutable_business` | Refuses any change to `business_teams.business_id`.                                                                                                          |
| `business_team_invites.accepted_by`, `accepted_member_id`, `revoked_at`, `revoked_by`  | Acceptance and revocation linkage. `accepted_member_id` is `ON DELETE SET NULL`, so removing a member keeps the invitation history.                          |
| `chk_business_team_invites_token_hash_shape`                                           | 64 lowercase hex characters.                                                                                                                                 |
| `chk_business_team_invites_expiry_shape`                                               | `expires_at > created_at` and `<= created_at + 30 days`.                                                                                                     |
| `chk_business_team_invites_accepted_shape`                                             | `(status = 'accepted') = (accepted_at IS NOT NULL)`.                                                                                                         |
| `chk_business_team_invites_revoked_shape`                                              | `(status = 'revoked') = (revoked_at IS NOT NULL)`.                                                                                                           |
| `uq_business_team_invites_pending_email`                                               | Unique `(team_id, lower(btrim(email))) WHERE status = 'pending'`.                                                                                            |
| `idx_business_team_invites_token_hash`                                                 | `(token_hash, status)` for the `FOR UPDATE` lookup.                                                                                                          |

### Not done

- no membership, role, invitation or audit row is deleted, merged or re-keyed;
- `business_teams.business_id` is unchanged for every existing workspace;
- the pre-existing `UNIQUE(team_id, user_id)` on `business_members` is kept —
  removal is a real `DELETE`, so a removed person can be invited back without a
  soft-delete predicate to work around;
- nothing in advertisements, MHC, plans, wallets, activation or any financial
  table is touched.

### The "exactly one owner" split

The partial unique index enforces **at most one**. The lower bound — never zero —
is held by the ownership-transfer transaction, which swaps both memberships under
a `business_teams` row lock and refuses to remove or demote an owner anywhere
else. A database constraint cannot express "at least one" without a deferred,
whole-table check that would serialise unrelated writes.

### `status = 'expired'`

Written **only** when invitation creation retires a pending invitation that has
passed its expiry. Expiry as _seen_ by preview and acceptance is computed from
`expires_at`, so a GET never mutates a row.

### Rollback

Documented in the migration header and asserted by a fingerprint test. Order:

```sql
DROP TRIGGER IF EXISTS trg_business_teams_immutable_business ON public.business_teams;
DROP TRIGGER IF EXISTS trg_business_members_resolve_tier ON public.business_members;
DROP FUNCTION IF EXISTS public.business_teams_reject_business_id_change();
DROP FUNCTION IF EXISTS public.business_members_resolve_tier();

DROP INDEX IF EXISTS public.uq_business_members_single_owner;
DROP INDEX IF EXISTS public.uq_business_team_invites_pending_email;
DROP INDEX IF EXISTS public.idx_business_team_invites_token_hash;

ALTER TABLE public.business_team_invites
  DROP CONSTRAINT IF EXISTS chk_business_team_invites_token_hash_shape,
  DROP CONSTRAINT IF EXISTS chk_business_team_invites_expiry_shape,
  DROP CONSTRAINT IF EXISTS chk_business_team_invites_accepted_shape,
  DROP CONSTRAINT IF EXISTS chk_business_team_invites_revoked_shape;

ALTER TABLE public.business_team_invites
  DROP COLUMN IF EXISTS accepted_by,
  DROP COLUMN IF EXISTS accepted_member_id,
  DROP COLUMN IF EXISTS revoked_at,
  DROP COLUMN IF EXISTS revoked_by;

ALTER TABLE public.business_team_roles
  DROP COLUMN IF EXISTS is_legacy;
```

Triggers before their functions; columns after the constraints that reference
them. Dropping the three linkage columns takes their foreign keys with them,
which is the only way to remove them. Idempotent — running it twice produces the
same result — and asserted as an **exact fingerprint set**, so any collateral
casualty fails the test.

### Preserved historical behaviour

- existing `viewer` role rows and any membership pointing at one keep working and
  resolve to the Member tier;
- accepted invitations keep `status`, `accepted_at` and `accepted_by` after the
  member is removed;
- the audit log is append-only and covers create, accept, revoke, role update,
  removal and transfer;
- deleting a custom role reassigns both its members **and** the invitations
  issued for it to the replacement role, so the record of what was offered
  survives instead of being blocked by `ON DELETE RESTRICT`.

---

## 7. Concurrency

| Race                                         | Mechanism                                                             | Outcome                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 10 simultaneous accepts                      | `FOR UPDATE` on the invitation row                                    | One membership; one call reports `created: true`, nine report `created: false`; all ten succeed |
| Accept vs revoke                             | Both take the same invitation row lock                                | Deterministic: either accepted with a membership, or revoked with none. Never both              |
| 10 simultaneous transfers                    | `FOR UPDATE` on `business_teams`, ownership re-checked under the lock | Exactly one succeeds; nine get `WORKSPACE_OWNER_REQUIRED`; one owner remains                    |
| Two invitations to the same address          | Workspace row lock + partial unique index                             | One pending invitation                                                                          |
| Second owner written directly                | `uq_business_members_single_owner`                                    | `23505`                                                                                         |
| Role from another workspace written directly | `trg_business_members_resolve_tier`                                   | `23514`                                                                                         |

---

## 8. Audit events

Written inside the same transaction as the change, to `business_team_audit_log`:

| Action                             | Entity | Detail                                     |
| ---------------------------------- | ------ | ------------------------------------------ |
| `business_team.role.create`        | role   | name, permissions                          |
| `business_team.role.update`        | role   | name, permissions                          |
| `business_team.role.delete`        | role   | replacementRoleId                          |
| `business_team.invite.create`      | invite | email, roleId, roleName (never the token)  |
| `business_team.invite.revoke`      | invite | —                                          |
| `business_team.invite.accept`      | invite | memberId, roleId, createdMembership        |
| `business_team.member.role_update` | member | roleId, roleName, previousTier             |
| `business_team.member.remove`      | member | removedUserId, tier                        |
| `business_team.ownership.transfer` | member | previous and new owner user and member ids |

---

## 9. Frontend

Antigravity's Wave 2G/2H UI (`feat/wave-2gh-team-invitations-ui`, `1c6c95e`) was
cherry-picked in its original order and **integrated, not rebuilt**. The visual
structure, Arabic/English copy, table layouts, badge styles, mobile behaviour and
deep links are the ones already there.

What changed:

- the panel reads its standing from `overview.viewer` instead of inferring it
  from the primary account role;
- the three "pending backend deployment" notices are gone — member removal (with
  a confirmation step), member role changes and ownership transfer (with the
  typed workspace name) call the real endpoints;
- role pickers offer only `assignable` roles, so Owner and the retired `viewer`
  seed are never presented as choices that would fail;
- the acceptance screen calls the real preview endpoint before claiming anything,
  and gained a wrong-account state;
- error handling matches stable backend codes rather than searching message text.

Frontend checks remain **presentation only**. Every action is authorized again by
the endpoint; the `refuses a direct call that bypasses the frontend entirely`
test invokes each hidden control directly and asserts the refusal.

---

## 10. Verification

| Check                                     | Result                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run typecheck`                       | pass                                                                          |
| `npm run lint`                            | pass                                                                          |
| `npm run validate:i18n`                   | pass                                                                          |
| `npm run test` (shared + api + web)       | pass                                                                          |
| `npm run build -w @mohandishub/api`       | pass                                                                          |
| `npm run build -w @mohandishub/web`       | pass                                                                          |
| `node scripts/migration-dryrun.mjs`       | pass — applied against the live schema inside a transaction, then rolled back |
| `node scripts/migration-replay-check.mjs` | pass — no drift                                                               |
| `RUN_PG_INTEGRATION=1` API suites         | pass, including 39 business-team scenarios                                    |
| Scratch databases remaining               | 0                                                                             |
| Production migrations applied             | 0                                                                             |
| Production data changed                   | none                                                                          |

### Deployment

The migration is **pending**. Applying it takes the workspace from 101 to 102
applied migrations. It is additive and safe to apply while the API is running:
every constraint it adds is already satisfied by the current data (verified), and
the current API code violates none of them.
