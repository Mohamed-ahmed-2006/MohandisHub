# 02 — Role, Workspace and Permission Matrix

---

## 1. What exists today

`users.primary_role ∈ {customer, expert, business, craftsman}`, plus an independent `is_admin` boolean and `admin_permissions text[]`.

The authoritative permission statement is `ROLE_PERMISSION_MATRIX` in `packages/shared/src/roles.ts:60`:

| Capability | customer | expert | craftsman | business | admin |
|---|---|---|---|---|---|
| `manageNeeds` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `bidOnNeeds` | ❌ | ✅ | ✅ | ✅ | ❌ |
| `manageProviderServices` | ❌ | ✅ | ✅ | ✅ | ❌ |
| `manageReservationAvailability` | ❌ | ✅ | ✅ | ✅ | ❌ |
| `requestWithdrawal` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `accessAdminPanel` | ❌ | ❌ | ❌ | ❌ | ✅ |

This matrix is **strictly bipartite**: an identity either creates demand or supplies it. Never both.

---

## 2. The contradiction, stated precisely

The product objective requires a business to:

| Requirement | Enforced today | Where |
|---|---|---|
| Sell its own services | ✅ allowed | `manageProviderServices: true` |
| Receive orders and opportunities | ✅ allowed | reservations, bids |
| Submit bids | ✅ allowed | `bidOnNeeds: true` |
| **Purchase services from other providers** | ❌ **blocked** | booking paths assume customer |
| **Post its own needs** | ❌ **blocked** | `requireRole('customer')` on `POST /api/needs` (`needs.routes.ts:17`) |
| Manage a team | ⚠️ schema only | see `08-business-team-admin-rbac-audit.md` |

`POST /api/needs`, `PATCH /api/needs/:id`, `POST /api/needs/:id/award` and `POST /api/needs/:id/bids/:bidId/pay` are **all** `requireRole('customer')`. There is no code path by which a business, expert or craftsman posts a need.

This is not an oversight in one endpoint; it is the design of the role model. Fixing it by adding `'business'` to those four `requireRole` calls would let a business post — and would immediately create a new problem: the business's *own* providers would see the business's *own* needs in their opportunity feed, and the UI has no way to tell a user which hat they are currently wearing. **The endpoint change is the easy 10%; the workspace concept is the necessary 90%.**

---

## 3. Other role-model problems

### 3.1 `'admin'` is modelled as a role in the shared types but as a flag in the database

```ts
export type UserRole = 'customer' | 'expert' | 'business' | 'craftsman' | 'admin';
```

No user row ever has `primary_role = 'admin'`. `requireRole('admin')` special-cases this by checking `user.isAdmin` before the role list (`require-role.ts:44`). `ROLE_META.admin` and `ROLE_PERMISSION_MATRIX.admin` are entries for a role that cannot exist.

The runtime behaviour is correct. The type is a landmine: any developer writing `if (user.role === 'admin')` writes dead code, and `switch` statements over `UserRole` carry an unreachable branch. **The database design here is already what the brief asks for.** Only the type needs correcting.

### 3.2 `canRequestWithdrawal` grants withdrawal to every role

```ts
export const canRequestWithdrawal = (role: string): role is WithdrawalEligibleRole =>
  role === 'customer' || role === 'expert' || role === 'craftsman' || role === 'business';
```

Every withdrawal rail is `false` at launch and MHC is explicitly non-cashable. This function's only consumer is `wallet-settings-screen.tsx:79`, where it gates the withdrawal section. It should return `false` for launch (or the whole concept should be feature-flagged), so no role sees a withdrawal surface.

### 3.3 Expert and craftsman are duplicated everywhere

`craftsman` was added in migration `20260318000005`. Because it was retrofitted, the codebase is full of `role === 'expert' || role === 'craftsman'` — in `app-shell.tsx`, `projects-screen.tsx`, `app-home-screen.tsx`, `auth.service.ts:514`, and the sidebar's `roles: ['expert','craftsman','business']` arrays.

`isIndividualProviderRole()` and `isProviderRole()` exist in shared and are the correct helpers, but component code does not use them. This is a cheap, low-risk consolidation.

### 3.4 Business team membership grants nothing

Covered in detail in `08`. Summary: a `business_members` row confers no permission anywhere. A member's own `primary_role` (customer, expert, …) is what the API actually enforces.

---

## 4. Proposed model: one identity, many workspaces

### 4.1 Concept

```
identity (users row)
├── customer workspace     — optional, default ON for everyone
├── individual provider    — optional (expert | craftsman metadata)
├── business workspace     — optional (owned or joined via business_members)
└── staff permissions      — orthogonal (is_admin + admin_permissions[])
```

Every request that can create or read marketplace data carries an **active workspace**. Authorization becomes:

> *Is this identity a member of this workspace, and does that workspace type permit this action?*

instead of

> *Is `users.primary_role` equal to this string?*

### 4.2 Proposed schema

```sql
CREATE TABLE workspaces (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         VARCHAR(20) NOT NULL CHECK (kind IN ('customer','individual_provider','business')),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_type VARCHAR(20) CHECK (provider_type IN ('expert','craftsman')),
  business_team_id UUID REFERENCES business_teams(id),
  display_name VARCHAR(200),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- one personal customer workspace and one individual-provider workspace per identity
CREATE UNIQUE INDEX uq_workspaces_personal
  ON workspaces(owner_user_id, kind)
  WHERE kind IN ('customer','individual_provider');

CREATE TABLE workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         VARCHAR(20) NOT NULL CHECK (role IN ('owner','admin','member')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
```

Then add a **nullable** `workspace_id` to the entity tables — `needs`, `bids`, `services`, `reservations`, `conversations`. Nullable is essential: it makes the migration additive and reversible.

### 4.3 Backfill (deterministic, reversible)

```sql
-- 1. every identity gets a customer workspace
INSERT INTO workspaces (kind, owner_user_id, display_name)
SELECT 'customer', id, display_name FROM users WHERE deleted_at IS NULL;

-- 2. expert/craftsman identities get an individual-provider workspace
INSERT INTO workspaces (kind, owner_user_id, provider_type, display_name)
SELECT 'individual_provider', id, primary_role, display_name
FROM users WHERE primary_role IN ('expert','craftsman') AND deleted_at IS NULL;

-- 3. business identities get a business workspace bound to their existing team
INSERT INTO workspaces (kind, owner_user_id, business_team_id, display_name)
SELECT 'business', u.id, bt.id, u.display_name
FROM users u LEFT JOIN business_teams bt ON bt.business_id = u.id
WHERE u.primary_role = 'business' AND u.deleted_at IS NULL;

-- 4. owners are workspace owners
INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT id, owner_user_id, 'owner' FROM workspaces;

-- 5. existing needs belong to their customer's customer workspace
UPDATE needs n SET workspace_id = w.id
FROM workspaces w WHERE w.owner_user_id = n.customer_id AND w.kind = 'customer';
```

**Rollback:** `UPDATE <table> SET workspace_id = NULL;` then `DROP TABLE workspace_members, workspaces;`. No existing column is modified or dropped. `users.primary_role` is **retained** throughout as the fallback resolver — this is what makes the migration safe.

### 4.4 Request plumbing

Client sends `X-Workspace-Id`. New middleware `resolveWorkspace`:

1. If the header is absent → resolve the identity's default workspace from `primary_role` (preserves every existing client).
2. If present → verify a `workspace_members` row exists for `(workspace_id, req.user.id)`; else `403`.
3. Set `req.workspace = { id, kind, role, providerType }`.

New guard `requireWorkspaceKind('customer')` replaces `requireRole('customer')` **one endpoint at a time**. Both guards coexist during migration.

### 4.5 Target matrix

| Action | customer ws | individual provider ws | business ws | staff |
|---|---|---|---|---|
| Post a need | ✅ | ❌ | ✅ | ❌ |
| Award a bid | ✅ (own need) | ❌ | ✅ (own need) | ❌ |
| Browse opportunities | ❌ | ✅ | ✅ | ❌ |
| Submit a bid | ❌ | ✅ | ✅ | ❌ |
| Pay MHC activation | ❌ | ✅ | ✅ (owner/admin) | ❌ |
| Publish a service | ❌ | ✅ | ✅ | ❌ |
| Book a service | ✅ | ❌ | ✅ | ❌ |
| Hold MHC balance | ❌ | ✅ | ✅ | ❌ |
| Buy MHC | ❌ | ✅ | ✅ (owner/admin) | ❌ |
| Manage team | ❌ | ❌ | ✅ (owner/admin) | ❌ |
| View analytics | ❌ | ✅ | ✅ | ✅ (perm) |
| Open a help case | ✅ | ✅ | ✅ | ❌ |
| Admin panel | ❌ | ❌ | ❌ | ✅ (perm) |

A business identity holds **both** a business workspace and a personal customer workspace. Selling and procurement are separated by the workspace switcher, not by account.

### 4.6 Business workspace member roles

| | owner | admin | member |
|---|---|---|---|
| Manage team / invite / remove | ✅ | ✅ | ❌ |
| Transfer ownership | ✅ | ❌ | ❌ |
| Manage services | ✅ | ✅ | ❌ |
| Submit bids | ✅ | ✅ | ✅ |
| **Spend MHC** | ✅ | ✅ | ❌ |
| Buy MHC | ✅ | ✅ | ❌ |
| Manage subscription | ✅ | ❌ | ❌ |
| Work on assigned projects | ✅ | ✅ | ✅ |
| View analytics | ✅ | ✅ | ❌ |

**`member` cannot spend MHC.** This is deliberate: MHC is real money the business bought, and a member accepting an award commits the business to a fee. A member who receives an award offer must escalate to an owner/admin.

---

## 5. Frontend vs backend enforcement — current state

The audit found **no case where a frontend check substitutes for a missing backend check** on the paths examined. Backend guards are present on needs, bids, MHC, admin, and analytics.

Two weaker spots worth naming:

1. **Sidebar visibility is presentation-only, correctly.** `/app/services` is hidden from customers in the sidebar, but the route itself has no guard — a customer navigating directly renders the screen. The API rejects the writes, so this is a UX defect, not a security hole. Any workspace-aware navigation work should add route guards at the same time.

2. **`analytics` uses `requireRole` but the business dashboard renders an analytics tab inline.** When analytics gets a dedicated route (see `07`), that route needs its own guard rather than relying on the tab not being rendered.

---

## 6. Migration risk

| Risk | Severity | Mitigation |
|---|---|---|
| Existing sessions lack `X-Workspace-Id` | High | Header optional; fall back to `primary_role`. Never require it. |
| A user ends up in the wrong workspace after switching | Medium | Server derives workspace from the header and validates membership; never trusts client-side state. |
| Ownership ambiguity for MHC balance | High | MHC stays on `wallets.user_id` = the **owner** identity. Workspaces do not own wallets in phase 1. |
| Double-counting plan quotas across workspaces | Medium | Quotas stay per-identity in phase 1. Revisit only after workspaces are stable. |
| `primary_role` drifts from workspaces | Medium | Keep `primary_role` authoritative for fallback; add a nightly consistency check before removing it. |

**Do not drop `users.primary_role` in this programme of work.** It is the safety net for every un-migrated endpoint.
