# Wave 2G & Wave 2H Team Management & Invitations — Implemented Contract

The frontend implementation, role permission model, invitation lifecycle state
machine, and the backend contracts the UI is wired to, for:

- **Wave 2G**: Business-team permissions and membership management
- **Wave 2H**: Secure team invitations

UI branch: `feat/wave-2gh-team-invitations-ui` (`1c6c95e`, cherry-picked)
Integration branch: `feat/wave-2gh-team-backend-integration`
Baseline: `origin/main` (`b2d146e`)

> **Status.** Every contract in §3 of the original draft has been implemented.
> This document now describes what exists rather than what was proposed. Backend
> internals — schema, concurrency, token security, audit — are in
> [`docs/release/BUSINESS_TEAMS_AND_INVITATIONS.md`](../release/BUSINESS_TEAMS_AND_INVITATIONS.md).

> **Superseded in part.** Ownership transfer is **not available**, and six of the
> seven workspace permissions are **reserved rather than enforced**. Wave 2G is
> split into 2G-A (shipped: team administration, roles, invitations, membership,
> workspace access) and 2G-B (deferred: delegated services, jobs, analytics,
> advertisements, bookings, plans, wallet, MHC). See
> [`docs/release/WAVE_2GH_BACKEND_BLOCKERS.md`](../release/WAVE_2GH_BACKEND_BLOCKERS.md)
> for what changed and why.

---

## 1. Product & permission model

Business workspace membership is decoupled from the user's primary account role
(`users.primary_role`). Joining, leaving, being promoted or being demoted in a
workspace **never** changes it. A user may hold a primary account role of
`business`, `expert`, `customer` or `craftsman` and simultaneously hold any
workspace tier.

### Built-in workspace tiers

Three, and only three, are exposed to users.

| Tier       | Stored value | Capabilities                                                                                                                                                 |
| :--------- | :----------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**  | `owner`      | Team administration, role management, member removal. Exactly one per workspace. Ownership itself belongs to the business account and cannot be transferred. |
| **Admin**  | `manager`    | Invite, revoke, assign non-owner roles, remove non-owner members. **Cannot** grant Owner, or remove or change the Owner. Nobody can transfer ownership.      |
| **Member** | `member`     | Only the operations their assigned role permits. No unrestricted team administration.                                                                        |

`manager` **is** the Admin tier. The stored value is preserved so no existing
membership row has to be rewritten; the mapping is server-side and `manager` is
never presented as a tier of its own. There is no ambiguous pair of built-in
tiers.

**`viewer` is a legacy built-in role, not an approved tier.** It was seeded into
every workspace by the old provisioning path and holds no members anywhere in
production. Its rows are kept and flagged `is_legacy`; it resolves to the
**Member** tier, is excluded from every role picker, and is not seeded into new
workspaces. Nothing is deleted.

### Custom roles

Custom roles widen **permissions**, never **tier** — a custom role always
resolves to Member, enforced in the service and by a database trigger. Their
permission arrays are server-authoritative: read from the database on every
request and filtered against the known permission set.

The one narrow exception: a member whose role carries the explicit `manage_team`
permission may invite, revoke, update non-owner roles and remove non-owner
members. It never extends to granting Owner, editing roles, or touching the
Owner.

`manage_team` is also the **only** permission an authorization decision reads in
Wave 2G-A. The other six values the schema stores are reported as
`reservedPermissions`, are not grantable, and are never counted as capabilities.
A role that already carries one keeps it untouched.

> **Security rule.** The backend is authoritative. Frontend checks control
> visibility and hint text only, and every action is re-authorized by the
> endpoint that performs it. A hidden control invoked directly is refused
> exactly as a visible one would be.

---

## 2. Where the frontend gets its permissions

`GET /api/business-teams/me` returns a `viewer` block. The UI reads its own
standing from it and does **not** infer anything from the account role:

```ts
overview.viewer.tier; // 'owner' | 'admin' | 'member'
overview.viewer.isOwner;
overview.viewer.permissions; // BusinessTeamPermission[]
overview.viewer.allowedActions; // the booleans below
```

| `allowedActions` key                                                                  | True for                                        |
| :------------------------------------------------------------------------------------ | :---------------------------------------------- |
| `inviteMembers`, `revokeInvites`, `viewInvites`, `updateMemberRoles`, `removeMembers` | Owner, Admin, or a Member holding `manage_team` |
| `manageRoles`                                                                         | Owner only                                      |
| `transferOwnership`                                                                   | Nobody — the capability does not exist          |

Roles carry `tier`, `legacy` and `assignable`. Pickers offer only
`assignable` roles, so Owner and the retired `viewer` seed are never presented as
choices that would be refused. Members carry `tier`, `isOwner` and `isSelf`.

---

## 3. Endpoints

Base path `/api/business-teams`. The API router is mounted at `/api`; this
project has no version segment. Responses are `{ ok: true, data }` or
`{ ok: false, error: { code, message } }`.

Every workspace-scoped route accepts an optional `?teamId=`. It selects among
the caller's own memberships and is verified server-side on every request; a
workspace that is not theirs and one that does not exist both answer
`403 WORKSPACE_NOT_ACCESSIBLE`.

| Method                      | Route                       | Auth     | Purpose                                   |
| :-------------------------- | :-------------------------- | :------- | :---------------------------------------- |
| `GET`                       | `/workspaces`               | Bearer   | Every workspace this account can open     |
| `GET`                       | `/me?teamId=`               | Bearer   | Workspace overview + caller standing      |
| `GET`                       | `/invites/preview?token=`   | **none** | Server-verified invitation preview        |
| `POST`                      | `/invites`                  | Bearer   | Create invitation                         |
| `POST`                      | `/invites/:inviteId/revoke` | Bearer   | Revoke a pending invitation               |
| `POST`                      | `/invites/accept`           | Bearer   | Accept with `{ token }`                   |
| `PATCH`                     | `/members/:memberId`        | Bearer   | Change a member's role                    |
| `DELETE`                    | `/members/:memberId`        | Bearer   | Remove a member                           |
| `POST`                      | `/transfer-ownership`       | Bearer   | Always `OWNERSHIP_TRANSFER_NOT_AVAILABLE` |
| `POST` / `PATCH` / `DELETE` | `/roles`, `/roles/:roleId`  | Bearer   | Custom role management (Owner only)       |

None of these is behind `requireRole('business')`: workspace membership is
independent of the account role, so an invited expert or craftsman reaches their
own workspace.

### 3.1 Invitation preview

`GET /api/business-teams/invites/preview?token=:token`

Callable without a session, because an invited person frequently has no account
yet. A signed-in caller's token is used to answer the account-match question; an
expired session is treated as anonymous, not as a 401.

```jsonc
{
  "ok": true,
  "data": {
    "state": "valid", // valid | expired | revoked | already_used | malformed | wrong_account
    "teamName": "Engineering Studio Ltd",
    "inviterDisplayName": "Alice Owner",
    "maskedEmail": "b••@engineer.com",
    "roleName": "Senior Engineer",
    "expiresAt": "2026-08-06T12:00:00.000Z",
    "requiresAuthentication": false,
    "signedInAccountMatches": true,
  },
}
```

- an unknown token and a syntactically bad one both return `malformed` with all
  fields null, so the response never confirms that a token exists;
- the invited address is always masked;
- `signedInAccountMatches` is `null` when nobody is signed in — answering it
  would disclose the address;
- nothing reveals whether any email address has an account.

### 3.2 Create invitation

`POST /api/business-teams/invites` — body `{ email, roleId }`

Owner/Admin (or `manage_team`). The workspace is server-resolved. Owner cannot be
offered. Duplicate active membership and duplicate pending invitations are
refused. The email carries a link; the raw token is never stored.

### 3.3 Revoke invitation

`POST /api/business-teams/invites/:inviteId/revoke`

Pending only. Repeating it is a no-op success. An accepted invitation returns
`INVITE_ALREADY_ACCEPTED` and the membership is untouched.

### 3.4 Accept invitation

`POST /api/business-teams/invites/accept` — body `{ token }`

Identity is checked before state, so a stranger with a leaked link learns only
that it is not theirs. Response:

```jsonc
{
  "accepted": true,
  "created": true,
  "teamId": "uuid",
  "teamName": "Engineering Studio Ltd",
  "roleName": "Senior Engineer",
  "tier": "member",
}
```

`created: false` means the membership already existed — the invited person
clicking twice gets an idempotent answer, not an error.

### 3.5 Member role update

`PATCH /api/business-teams/members/:memberId` — body `{ roleId }`

Owner/Admin. The Owner cannot be updated here in either direction. Owner cannot
be assigned. A role from another workspace is not found.

### 3.6 Member removal

`DELETE /api/business-teams/members/:memberId`

Owner/Admin. The Owner cannot be removed. A member from another workspace is a
stable 404. Access ends on the removed member's very next request; their
historical records are preserved.

### 3.7 Ownership transfer — not available

`POST /api/business-teams/transfer-ownership` always answers
`409 OWNERSHIP_TRANSFER_NOT_AVAILABLE`. Nothing is read, locked, written or
audited, and the body is not parsed.

Moving the Owner membership would move team administration while
`business_teams.business_id` — the account that owns the workspace's services,
jobs, advertisements, bookings, subscriptions and financial history — stayed
where it was, along with the primary-role check most of those endpoints make.
That is split authority, not ownership, and describing it as ownership in the UI
was the misleading part. The prerequisite is a workspace principal separable
from the registering account (Wave 2G-B).

`allowedActions.transferOwnership` is `false` for everyone including the owner,
and the web client has no method for it.

### 3.8 Error codes

The UI matches on `error.code`, never on message text.

| Code                               | Status | Screen behaviour                                              |
| :--------------------------------- | :----- | :------------------------------------------------------------ |
| `NO_BUSINESS_WORKSPACE`            | 403    | Panel shows the no-workspace state                            |
| `WORKSPACE_ADMIN_REQUIRED`         | 403    | Administration controls stay hidden; a direct call is refused |
| `WORKSPACE_OWNER_REQUIRED`         | 403    | Role management is owner-only; a direct call is refused       |
| `OWNERSHIP_TRANSFER_NOT_AVAILABLE` | 409    | The capability does not exist; nothing is offered             |
| `WORKSPACE_NOT_ACCESSIBLE`         | 403    | A `teamId` that is not one of the caller's, or does not exist |
| `TEAM_SEAT_LIMIT_REACHED`          | 409    | Invite form error                                             |
| `INVITE_WRONG_ACCOUNT`             | 403    | "Signed in with a different account", with the masked address |
| `INVITE_EXPIRED`                   | 410    | "Invitation Expired"                                          |
| `INVITE_REVOKED`                   | 410    | "Invitation Revoked"                                          |
| `INVITE_NOT_FOUND`                 | 404    | "Invalid Invitation Link"                                     |
| `ALREADY_A_MEMBER`                 | 409    | Invite form error                                             |
| `INVITE_ALREADY_PENDING`           | 409    | Invite form error                                             |
| `OWNER_CANNOT_BE_REMOVED`          | 409    | Refusal surfaced                                              |
| `OWNER_ROLE_IMMUTABLE`             | 409    | Refusal surfaced                                              |
| `OWNER_ROLE_NOT_ASSIGNABLE`        | 400    | Owner is never offered, so this is a forged-call refusal      |
| `CONFIRMATION_MISMATCH`            | 400    | "Type the workspace name exactly to confirm"                  |

---

## 4. Invitation lifecycle

```
[ Owner/Admin creates invite ]  → email link, 7-day expiry
           │
           ▼
     ┌───────────┐
     │  Pending  │
     └─────┬─────┘
           │
 ┌─────────┼──────────────┬──────────────┬────────────────────┐
 ▼         ▼              ▼              ▼                    ▼
Accept   Expiry        Revoke      Wrong account         Re-invite after
 │       (derived      │           (refused, invite      expiry retires
 │        from          │            stays pending)      the stale row
 ▼        expires_at)   ▼                                to `expired`
Accepted  Expired     Revoked
```

`status = 'expired'` is written only when a new invitation retires a stale
pending row. Expiry as _seen_ by preview and acceptance is derived from
`expires_at`, so a GET never mutates a row.

### Acceptance screen behaviour

1. **Before acceptance** — the screen calls the preview endpoint and shows the
   workspace, offered role, inviter and masked address only after the server has
   confirmed them. Nothing is claimed before verification.
2. **Not signed in** — offers both "Sign In to Accept" and "Create an Account",
   each carrying `?next=` back to the invitation with its token intact.
3. **Wrong account** — names the masked address to sign in with.
4. **Accepted** — "Invitation Accepted!" with a link to the real workspace.
5. **Already used / expired / revoked** — distinct states, each from a stable
   backend code.

### Token handling in the browser

The token is read from the query string of the emailed link and passed to the
preview and accept calls. It is kept in a relative in-app path, never sent to a
third party, and never written to logs, analytics or error reporting. The API
logs `req.path` and never the query string.

---

## 5. Files

| File                                                        | Change                                                                                                                                                     |
| :---------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/components/app/business-team-panel.tsx`           | Reads `viewer.allowedActions`; real removal, role change and transfer; assignable-only pickers                                                             |
| `apps/web/components/team/invitation-acceptance-screen.tsx` | Real preview; wrong-account state; code-based error mapping; `?next=` sign-in and register links                                                           |
| `apps/web/app/[locale]/invitations/accept/page.tsx`         | Unchanged from the UI branch                                                                                                                               |
| `apps/web/lib/business-teams/client.ts`                     | `listWorkspaces`, `previewInvite`, `updateMemberRole`, `removeMember`; `BusinessTeamApiError` carrying the backend code. No `transferOwnership`.           |
| `apps/web/app/dashboard.css`                                | Unchanged from the UI branch                                                                                                                               |
| `apps/web/components/auth/auth-form.tsx`                    | `next` allowlist widened to `/invitations/accept`                                                                                                          |
| `apps/web/components/auth/auth-form-screen.tsx`             | `next` preserved across the login/register toggle                                                                                                          |
| `apps/web/tests/business-team-invitations.test.ts`          | Extended to the implemented contract                                                                                                                       |
| `packages/shared/src/product-growth.ts`                     | `BusinessWorkspaceTier`, `BusinessTeamViewer`, `BusinessTeamAllowedActions`, `BusinessInvitePreview`, `BusinessInviteAcceptResult`, member/transfer bodies |

---

## 6. Responsive, localisation and accessibility

Preserved from the UI branch, and extended only where new controls were added:

- Arabic RTL and English LTR throughout, including every new string (removal
  confirmation, transfer form, wrong-account guidance, invitation summary);
- mobile layout near 375px — tables keep their `overflow-x: auto` wrappers and
  `min-width`, action rows wrap, and the transfer form uses the existing
  `dashboard-form` stack;
- `role="alert"` on error text, `role="status"` on confirmations,
  `role="alertdialog"` on the removal confirmation, `aria-expanded` on the
  transfer toggle, and `aria-label` on every new input and select;
- existing deep links (`/{locale}/invitations/accept?token=…`) unchanged.
