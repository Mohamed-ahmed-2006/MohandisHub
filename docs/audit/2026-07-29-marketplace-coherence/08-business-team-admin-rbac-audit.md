# 08 — Business Teams and Admin RBAC Audit

---

## Part A — Business teams

### A.1 What exists

More than expected. Five tables:

| Table | Columns |
|---|---|
| `business_teams` | `business_id` → users, `name` |
| `business_members` | `team_id`, `user_id`, `role ∈ owner\|manager\|member\|viewer`, `role_id` |
| `business_team_roles` | `team_id`, `name`, `role_key`, `built_in`, `permissions JSONB` |
| `business_team_invites` | `team_id`, `email`, `role_id`, `token_hash`, `status`, `expires_at`, `accepted_at` |
| `business_team_audit_log` | `team_id`, `actor_user_id`, `action`, `entity_type`, `entity_id`, `detail` |

Seven permissions: `manage_team`, `manage_services`, `manage_jobs`, `manage_reservations`, `view_wallet`, `manage_support_disputes`, `view_analytics`.

Four built-in roles seeded idempotently on every `ensureOwnerTeam()` call — so permission changes to built-ins propagate on next access, which is a sensible design.

Implementation quality is good where it exists: invite tokens are SHA-256 hashed (never stored raw), role deletion requires a replacement role and reassigns members in a transaction, the owner role cannot be deleted, and every mutation writes an audit row.

### A.2 The defining problem: permissions are never enforced

```
$ grep -rn "business_members" apps/api/src --include=*.ts
business-teams.routes.ts:143
business-teams.routes.ts:191
business-teams.routes.ts:209
business-teams.routes.ts:380
business-teams.routes.ts:495
```

**Five hits, all inside the file that defines the feature.** No other module reads team membership. `manage_services` does not gate `POST /api/services` — that is gated by `requireRole('expert','business','craftsman')` on `users.primary_role`. `view_wallet` gates nothing. `manage_jobs` gates nothing.

A `business_members` row grants **a row in a table**. What the API actually enforces is the member's own `primary_role`. So a member added as "Manager" with `manage_services` still cannot manage the business's services — because their `primary_role` is `customer` or `expert`, not `business`. Conversely, if they *are* a `business` account, they manage their **own** services, not the team's.

**Classification: 3 — frontend/schema-only.** The team feature is a permission model with no enforcement surface.

### A.3 Confirmed defects

**1. A member cannot view their own team — class 5.**

`GET /api/business-teams/me` → `getOverview()` → `ensureOwnerTeam(user)`, which opens with:

```ts
if (user.role !== 'business') {
  throw new HttpError({ statusCode: 403, code: 'BUSINESS_ROLE_REQUIRED', … });
}
```

An invited member whose `primary_role` is `customer` or `expert` gets 403 on the only endpoint that lists the team. They can accept an invitation and then never see the team again.

**2. `ensureOwnerTeam` is called on read paths.**

It runs a full `BEGIN` → create-team → upsert-4-roles → upsert-owner-member → `COMMIT` transaction on every `GET /me`. Functionally idempotent, but it means a read endpoint performs five writes. Under concurrency, two simultaneous reads race on `business_teams` insertion; the `ON CONFLICT` clauses on roles and members cover most of it, but the initial team `INSERT` has **no unique constraint on `business_id`** — two concurrent first-time reads can create two teams for one business.

*Fix:* `CREATE UNIQUE INDEX uq_business_teams_business ON business_teams(business_id);`

**3. Invitations are unusable end-to-end — class 4.**

```ts
introLines: [
  'You were invited to join a MohandisHub business team.',
  `Invitation token: ${token}`,
]
```

The raw token is emailed as body text. There is no accept URL, no accept page, and no UI calling `POST /invites/accept`. The endpoint works; nothing reaches it. A user would have to copy a hex string and construct an API call by hand.

*Fix:* email `${WEB_URL}/${locale}/team/accept?token=${token}`; add the page; call the existing endpoint.

**4. No member removal, no ownership transfer — class 6.**

There is no `DELETE /members/:id` and no transfer endpoint. A member cannot be removed once added. If a business owner's account is lost, the team is orphaned.

**5. Seat limits unenforced — class 3.**

`PlanLimits.maxTeamSlots` is defined and zod-validated. `POST /invites` does not read it.

**6. Invite creation does not check `manage_team`.**

`POST /invites` calls `ensureOwnerTeam`, which only checks `role === 'business'`. Since only the business owner has that role, this is *currently* safe — but for the wrong reason. It is coincidence, not a check, and it breaks the moment membership is decoupled from `primary_role`.

### A.4 Recommended launch shape

The brief asks for owner / admin / member. Current built-ins are owner / manager / member / viewer.

**Keep four roles.** They exist, are seeded, and `viewer` is genuinely useful (an accountant who should see analytics and nothing else). Map `manager` → the brief's `admin`. Removing a working role tier to match a proposed list would be a regression, not a simplification.

**Order of work:**

1. `uq_business_teams_business` unique index *(small)*
2. Split `getOverview` from `ensureOwnerTeam`; allow any member to read *(small — fixes the 403)*
3. Invitation accept page + link email *(small)*
4. Member removal + ownership transfer *(medium)*
5. **Enforce permissions** — `requireTeamPermission('manage_services')` alongside `requireRole` *(medium; the payoff for all of the above)*
6. Seat limits from `maxTeamSlots` *(small — after 5)*
7. Team-visible projects and assignment *(large — needs workspaces)*

Step 5 is where teams start being real. Steps 1–4 are prerequisites.

### A.5 A member must not be converted into another role

The brief warns against this, and the current design is already correct: accepting an invitation inserts a `business_members` row and **never modifies `users.primary_role`**. Preserve this invariant when adding enforcement — team permissions must be additive to identity, never a replacement for it.

---

## Part B — Admin RBAC

### B.1 Current design is largely what the brief asks for

The brief describes the admin implementation as "a flag attached to an ordinary marketplace account" and proposes separating internal staff from marketplace roles. **That separation already exists.**

| Property | Status |
|---|---|
| Admin independent of `primary_role` | ✅ `is_admin` boolean + `admin_permissions text[]` |
| Permission-based, not binary | ✅ 14 permissions |
| `super_admin` implies all | ✅ `hasAdminPermission` |
| Re-read from DB per request | ✅ `loadAdminFromDb` — a stale JWT cannot retain revoked admin |
| Route-level enforcement | ✅ `requireAdminPermission` / `requireAdminAnyPermission` |
| UI tabs permission-gated | ✅ `admin-panel.tsx:146` |
| Audit log | ✅ `audit_log` table |

`loadAdminFromDb` deserves specific credit: revoking admin takes effect on the next request rather than at token expiry. That is the correct posture and must not be weakened.

An admin does still carry a marketplace `primary_role` (necessarily — every row has one), and can in principle act as a marketplace participant. Whether that matters is a policy question. **Recommendation: leave the model alone**, and if staff/participant separation is required, enforce it as a policy check (`is_admin` accounts cannot bid/award) rather than by re-architecting a working RBAC system.

### B.2 Gaps

**1. `UserRole` includes `'admin'` — class 2.**

No row has `primary_role = 'admin'`. `requireRole('admin')` special-cases `isAdmin` before checking the role list. `ROLE_META.admin` and `ROLE_PERMISSION_MATRIX.admin` describe an unreachable state.

Runtime is correct; the type invites bugs. Any `switch` over `UserRole` carries a dead branch, and `if (user.role === 'admin')` compiles and never fires.

*Fix:* remove `'admin'` from `UserRole`; introduce `type StaffPermission` separately. Type-only change — **but touching `UserRole` ripples widely, so this needs its own PR with a full typecheck**, not a drive-by edit.

**2. Missing permissions.**

`ADMIN_PERMISSIONS` has 14 entries, but disputes sit under `manage_transactions` (`admin-panel.tsx:112-115`) — conflating money access with case handling. A dispute agent should not need transaction access.

Add: `manage_disputes`, `manage_credits` (MHC packages, action prices, purchase approval), `view_analytics`.

**3. Admin UI is table-per-domain, not work-queue-oriented — class 2.**

18 tabs, each a table browser: users, plans, coupons, transactions, money audit, wallet rails, disputes, services, categories, verifications, review reports, support, notifications, ads, media, settings, operations, retention.

An agent starting a shift has no "what needs me now" view. `admin-dashboard-tab.tsx` shows stats, not queues.

*Proposal:* add a work-queue home above the existing tabs — **do not remove the tabs**, they are class 1 and used for investigation:

| Queue | Source |
|---|---|
| Verifications pending | `verification_requests` |
| MHC purchases awaiting review | `deposit_requests WHERE purpose='credit_purchase' AND status='pending_review'` |
| Support cases unassigned | `support_tickets WHERE assigned_to IS NULL` |
| Disputes open | `case_type='dispute'` (post-unification) |
| Services pending review | `services WHERE status='pending_review'` |
| Review reports | `review_reports` |
| Ads pending | `advertisements` |

Each queue: count, oldest item age, one-click claim. This is additive.

**4. Sensitive actions need explicit audit coverage.**

`audit_log` exists and `business_team_audit_log` is used consistently. Coverage of admin actions was **not exhaustively verified** in this audit — flagged as unverified rather than passed.

Actions that must be audited without exception: MHC balance adjustment, verification approve/reject, user suspend/delete, plan/price changes, payment-rail toggles, dispute resolution, and any `super_admin` action. Each needs actor, target, before/after, reason and timestamp.

**5. `manage_credits` does not exist.**

MHC purchase approval currently falls under `manage_transactions`, which also grants access to the full money ledger. A credits-desk operator approving InstaPay receipts should not thereby get the transaction ledger.

### B.3 Do not weaken

Explicitly preserve:

- `super_admin` implies all permissions
- `loadAdminFromDb` re-reads per request
- `requireAdminPermission` on every mutating admin route
- Operations tab gated to `super_admin`
- Backup/restore routes gated to `super_admin`

Any new admin surface must be permission-gated **at the route**, never only in the UI.
