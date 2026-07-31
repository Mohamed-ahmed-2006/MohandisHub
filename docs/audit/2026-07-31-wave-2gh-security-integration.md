# Wave 2G/2H security and integration audit

Date: 2026-07-31

Auditor: Codex, independent audit worktree

Backend baseline: `origin/main` at `b2d146e0cdc50ccea3284649057ffc32eb7f2fe5`

Frontend baseline: `origin/feat/wave-2gh-team-invitations-ui` at `1c6c95e4cda88aff544919e854cac72e3a054d3a`

Excluded: unfinished `feat/wave-2gh-team-backend-integration`; Wave 2I; migrations or production-data changes

## Executive conclusion

Wave 2G/2H is not launch-ready on the audited baselines.

The current team routes do not expose a conventional client-controlled cross-business IDOR: role and invite identifiers are scoped to the team derived from the authenticated primary business account. The most important concrete vulnerability is instead invitation acceptance: `POST /api/business-teams/invites/accept` treats possession of the token as sufficient and never binds the invite email to the authenticated account. A verified account that obtains another recipient's token can consume it and persist a membership, including an `owner` role assignment.

That persisted membership grants no useful workspace access on current `main`, because the rest of the application is still user-owned rather than workspace-owned. This is not a mitigation suitable for launch: it is the integration gap Wave 2G is intended to close. Enabling member access without first fixing invite binding, role/owner invariants, and centralized server-side permission checks would turn the persisted unauthorized membership into cross-business access.

Three other launch blockers are structural:

1. `business_teams.business_id` is not unique, so concurrent first use can create two teams for one business.
2. Stored workspace permissions are not consulted by services, jobs, reservations, wallet, support, or analytics. Accepted non-business members cannot even load the team overview.
3. Business assets are owned by a user ID, not a team/workspace ID. An ownership-transfer endpoint cannot safely transfer the business merely by updating `business_teams.business_id`.

Antigravity's frontend merges mechanically without conflict into the audited `main`, but it cannot complete a real invitation journey: the backend email contains a token but no link; the signed-out flow uses a `redirect` parameter that the login route drops; the backend collapses expired/revoked/already-used into one error while the UI expects distinct states; and successful non-business invitees are sent to an app surface that has no invited-workspace context.

## 1. Current architecture

### Identity, ownership, and tenancy

- `users.primary_role` is the primary account role (`customer`, `expert`, `business`, or `craftsman`). Platform administration is a separate `users.is_admin` flag plus `admin_permissions`.
- `business_teams.business_id` references `users.id`. The code treats this user as the owner and resolves a team only by the authenticated user's ID.
- `business_members` links users to teams and carries both a legacy string `role` and a newer `role_id` reference.
- `business_team_roles` contains four seeded built-ins and arbitrary custom roles with a JSONB permission array.
- Domain assets are not team-owned. Representative ownership columns are:
  - `jobs.business_id -> users.id`;
  - `services.provider_id -> users.id`;
  - `reservations.provider_id -> users.id`;
  - `wallets.user_id -> users.id`;
  - `business_profiles.user_id -> users.id`.
- Controllers pass the authenticated actor's `req.user.id` to domain services. Repositories then bind reads and writes to that user ID. There is no active-workspace or actor/tenant separation.

Consequently, a membership is currently a detached record. It does not authorize acting for the business that owns the team, and changing `business_teams.business_id` would not transfer the business profile, wallet, services, jobs, reservations, or other user-owned assets.

### Authentication and platform administration

- `authenticate` verifies the bearer token, then refreshes `primary_role`, admin state, permissions, active state, and email verification from the database on every request when database configuration is present.
- `requireEmailVerified` gates all business-team routes.
- `requireRole` handles primary account roles and the separate platform-admin flag.
- Platform admin routes load current admin state through `loadAdminFromDb` and apply named admin permissions.
- A limited admin with `manage_users` cannot grant admin power: `adminController.updateUser` requires `super_admin` for `isAdmin` or `adminPermissions` changes and forbids self-change. No concrete admin privilege-escalation route was found in this audit.
- `PATCH /api/admin/users/:id/role` does allow an admin with `manage_users` to change another user's primary role. It forbids self-change but has no business-owner/team guard, so it can orphan a team owner from the only current management path.

### Backend-only database access

`20260610132000_backend_only_rls_storage_indexes.sql` enables RLS and revokes browser roles from `business_teams` and `business_members`. `20260613120000_phase2_5_product_value.sql` does the same for roles, invites, and the team audit log. The audited application therefore expects all access to pass through the API.

## 2. Exact files and symbols controlling authorization

| Area                       | File                                                                                        | Symbol or query                                                                                                  | Security effect                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Team router gate           | `apps/api/src/modules/business-teams/business-teams.routes.ts`                              | `router.use(authenticate, requireEmailVerified)`                                                                 | Requires an authenticated, verified account for every team route.                                                                                                                                                                             |
| Team/owner resolution      | same                                                                                        | `requireUser`, `ensureOwnerTeam`                                                                                 | Requires `req.user.role === 'business'`; resolves or creates a team with `business_id = req.user.id`; re-seeds roles and reasserts that user's owner membership. This is primary-role authorization, not membership/permission authorization. |
| Built-in permissions       | same                                                                                        | `BUILT_IN_ROLES`, `permissionSchema`, `roleSchema`                                                               | Defines owner/manager/member/viewer and seven permissions. These values are not enforced outside this router.                                                                                                                                 |
| Identifier scoping         | same                                                                                        | role update/delete SQL, invite create SQL, revoke SQL                                                            | Scopes `roleId`, `replacementRoleId`, and `inviteId` to the team returned by `ensureOwnerTeam`.                                                                                                                                               |
| Invite capability          | same                                                                                        | `tokenHash`, `/invites` handler, `/invites/accept` handler                                                       | Generates 192-bit random tokens, stores SHA-256 only, but acceptance checks token/status/expiry and does not check recipient email.                                                                                                           |
| Team audit                 | same                                                                                        | `audit`                                                                                                          | Writes `business_team_audit_log`, usually after the business mutation and on another connection.                                                                                                                                              |
| Current user refresh       | `apps/api/src/middleware/authenticate.ts`                                                   | `authenticate`                                                                                                   | Re-reads role/admin/active/email-verification state from `users`; does not attach current email or display name.                                                                                                                              |
| Primary role/admin gate    | `apps/api/src/middleware/require-role.ts`                                                   | `requireRole`, `hasAdminPermission`, `requireAdminPermission`                                                    | Enforces account-role and platform-admin permission checks. It does not know about business-team roles.                                                                                                                                       |
| Platform admin refresh     | `apps/api/src/middleware/load-admin-from-db.ts`                                             | `loadAdminFromDb`                                                                                                | Reloads current `is_admin` and `admin_permissions`.                                                                                                                                                                                           |
| Admin power mutation       | `apps/api/src/modules/admin/admin.controller.ts`                                            | `updateUser`, `changeUserRole`                                                                                   | Super-admin gate protects admin power; `manage_users` may change another user's primary role without checking team ownership.                                                                                                                 |
| Domain authorization       | `apps/api/src/modules/jobs/jobs.routes.ts`                                                  | `businessMw`                                                                                                     | Requires primary role `business`; controllers pass `req.user.id` as `businessId`.                                                                                                                                                             |
| Domain authorization       | `apps/api/src/modules/services/services.routes.ts` and `services.controller.ts`             | `providerMw`, `createService`, `listMyServices`                                                                  | Requires a provider primary role; operations use the actor's user ID as provider ID.                                                                                                                                                          |
| Domain authorization       | `apps/api/src/modules/reservations/reservations.routes.ts` and `reservations.controller.ts` | provider route gates and `requireUser`                                                                           | Uses the actor's user ID; no workspace permission resolution.                                                                                                                                                                                 |
| Domain authorization       | `apps/api/src/modules/analytics/analytics.routes.ts` and `analytics.controller.ts`          | `GET /me`, `getMyAnalytics`                                                                                      | Requires provider primary role and reports on the actor's user-owned records.                                                                                                                                                                 |
| Domain authorization       | `apps/api/src/modules/wallet/wallet.routes.ts` and `wallet.controller.ts`                   | `/me` routes                                                                                                     | Uses the actor's wallet. `view_wallet` has no effect.                                                                                                                                                                                         |
| Domain authorization       | `apps/api/src/modules/support/support.routes.ts` and `support.controller.ts`                | ticket routes, `requireUser`                                                                                     | Uses the actor's tickets. `manage_support_disputes` has no effect.                                                                                                                                                                            |
| API mount                  | `apps/api/src/app.ts`, `apps/api/src/routes/index.ts`                                       | `app.use('/api', apiRouter)`, `apiRouter.use('/business-teams', ...)`                                            | The actual prefix is `/api`, not `/api/v1`.                                                                                                                                                                                                   |
| Shared contract            | `packages/shared/src/product-growth.ts`                                                     | `BusinessTeamPermission`, `BusinessTeamRole`, `BusinessTeamMember`, `BusinessTeamInvite`, `BusinessTeamOverview` | Defines transport shapes but no runtime authorization.                                                                                                                                                                                        |
| Frontend client            | `apps/web/lib/business-teams/client.ts`                                                     | `businessTeamsApiClient`, `BUSINESS_TEAM_PERMISSIONS`                                                            | Calls `/api/business-teams/*`; Antigravity adds `acceptInvite`.                                                                                                                                                                               |
| Frontend role presentation | `apps/web/components/app/business-team-panel.tsx`                                           | `BusinessTeamPanel`, `userWorkspaceRole`, `canAdministerTeam`, `isOwner`                                         | Presentation-only classification. Manager/admin is treated as admin; all other roles, including custom roles and viewer, are treated as member.                                                                                               |
| Acceptance UI              | `apps/web/components/team/invitation-acceptance-screen.tsx` on Antigravity tip              | `InvitationAcceptanceScreen`, `handleAccept`                                                                     | Reads a raw token from the URL query, posts it, and infers states from English error-message substrings.                                                                                                                                      |
| Login return path          | `apps/web/app/[locale]/login/page.tsx`, `apps/web/components/auth/auth-form.tsx`            | `LoginPage`, `getSafeNextPath`                                                                                   | Login discards `redirect`; auth accepts only `next` values below `/{locale}/app`, so the invitation route cannot be restored.                                                                                                                 |

## 3. Routes covered and uncovered

The actual deployed prefix in this repository is `/api`. References to `/api/v1` in Antigravity's contract document are documentation errors.

### Existing business-team routes

| Method and route                                    | Accepted identifiers          | Current authorization path                                                                        | Cross-workspace result                                                                                                       |
| --------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/business-teams/me`                        | none                          | authenticate -> verified email -> `ensureOwnerTeam` primary business role                         | Resolves only `business_id = actor.id`. Members with other primary roles receive 403.                                        |
| `POST /api/business-teams/roles`                    | permission list               | same owner path                                                                                   | Creates only in the actor-owned team.                                                                                        |
| `PATCH /api/business-teams/roles/:roleId`           | `roleId`                      | same owner path; update includes `WHERE team_id = actorTeam AND id = roleId AND built_in = false` | Another team's role is not updated and returns `ROLE_NOT_FOUND`.                                                             |
| `DELETE /api/business-teams/roles/:roleId`          | `roleId`, `replacementRoleId` | same owner path; both roles are selected with the actor's `team_id`                               | Another team's role/replacement cannot be selected.                                                                          |
| `POST /api/business-teams/invites`                  | `email`, `roleId`             | same owner path; `INSERT ... SELECT` requires the role to have the actor's `team_id`              | Another team's role ID produces `INVALID_ROLE`.                                                                              |
| `POST /api/business-teams/invites/:inviteId/revoke` | `inviteId`                    | same owner path; update includes actor `team_id`, invite ID, and pending status                   | Another team's invite is unchanged and returned as not found.                                                                |
| `POST /api/business-teams/invites/accept`           | raw token in JSON body        | authenticate -> verified email -> token hash/status/expiry row lock                               | Exception: the invite's stored team/role are trusted, but the authenticated account is not checked against the invite email. |

No existing team route accepts a client-provided `businessId` or `teamId`. No current horizontal cross-business IDOR was found through the role and invite ID parameters above.

### Missing team routes/capabilities

- Authenticated invite preview with recipient-match result and generic non-enumerating failures.
- Member-visible team/workspace discovery and selection.
- `PATCH /api/business-teams/members/:memberId` with same-team role enforcement.
- `DELETE /api/business-teams/members/:memberId` with owner/last-owner protection.
- Transactional ownership transfer.
- Invite resend/replace with one-pending-invite semantics.
- Team audit-log read surface with suitable permission and redaction.
- Explicit role deletion behavior for pending and historical invitations.
- Permission enforcement on services, jobs, reservations, wallet, support/disputes, and analytics.

### Adjacent identifier-bearing routes

- `PATCH /api/admin/users/:id/role` accepts a user ID and primary account role. It is platform-admin scoped, not workspace scoped. It must not change a current business owner until ownership is transferred safely.
- `PATCH /api/admin/users/:id/business-profile` and `POST /api/admin/business/:userId/review` are protected by platform admin permissions and do not grant team access.
- Business job/service/reservation routes accept resource IDs, but service/repository checks bind those resources to `req.user.id`. They protect the primary owner's records from other users but do not support team delegates.

## 4. Role mapping findings

### Stored mapping

| Key        | Current seeded permissions                                                             | Current backend effect                                                                  |
| ---------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `owner`    | all seven                                                                              | Role assignment is displayed; only the primary business account is actually authorized. |
| `manager`  | services, jobs, reservations, support/disputes, analytics; no `manage_team`, no wallet | Same: no operational permission is enforced.                                            |
| `member`   | jobs, reservations, analytics                                                          | Same.                                                                                   |
| `viewer`   | analytics                                                                              | Same.                                                                                   |
| `custom_*` | any route-validated subset, including `manage_team` or `view_wallet`                   | Same.                                                                                   |

### Inconsistencies

1. Antigravity calls the product built-ins Owner, Admin, and Member, maps `manager`/`admin` to frontend admin, and demotes every other key to frontend member. The backend seeds `manager` and `viewer`, not `admin`.
2. The frontend shows invite/revoke controls to `manager`, although the seeded manager role does not contain `manage_team`.
3. A custom role containing `manage_team` is treated as frontend member and has controls hidden.
4. The invite role dropdown includes the built-in Owner role. The backend also permits that role, so an invite may create another owner-role membership without an ownership transfer.
5. `business_members.role` and joined `role_id` can disagree. Acceptance inserts legacy role `member` even when `role_id` is owner, manager, viewer, or custom; conflict updates change only `role_id`.
6. `ensureOwnerTeam` reasserts the primary business user's `role = 'owner'` and owner `role_id` on every call, making the legacy and new models even more dependent on that one code path.

The completed backend must authorize from a single, explicit server-side permission resolver. It must not authorize from frontend role labels, client-supplied permission arrays, legacy `business_members.role`, or a role ID without same-team validation.

## 5. Existing database guarantees

- Primary keys on teams, memberships, roles, invites, and audit rows.
- Foreign keys:
  - team owner to `users`;
  - member to team and user;
  - role to team;
  - member role to role with `ON DELETE SET NULL`;
  - invite to team and role, with role deletion restricted;
  - inviter/actor to users.
- `UNIQUE (team_id, user_id)` prevents duplicate memberships in one team.
- `UNIQUE (team_id, role_key)` prevents duplicate role keys per team.
- `token_hash` is unique.
- Checks constrain the legacy member role and invitation status vocabulary.
- Invitation expiry defaults to seven days; acceptance requires `expires_at > now()`.
- Team, member, role, invite, and team-audit tables are backend-only through RLS/revocation migrations.
- Role deletion uses a transaction and locks the target role. Member reassignment and deletion occur together.
- Invite acceptance locks the invite row and commits membership plus accepted status together. Double acceptance is therefore serialized.
- Revoke is a conditional update of a pending invite. Accept-versus-revoke is a single-winner race: whichever changes the pending row first prevents the other operation from succeeding.

## 6. Missing database guarantees

1. No unique constraint on `business_teams.business_id` despite the stated one-team-per-business model.
2. No database check that `business_teams.business_id` belongs to a business-role user. More importantly, the schema does not define whether this column is account owner, tenant owner, or business identity.
3. No composite foreign key proving `business_members.role_id` belongs to `business_members.team_id`.
4. No composite foreign key proving `business_team_invites.role_id` belongs to `business_team_invites.team_id`.
5. No guarantee of exactly one owner, at least one owner, or a unique owner-role assignment per team.
6. No coherence rule between legacy `business_members.role` and the referenced role key.
7. No partial unique index for one pending invite per normalized email and team.
8. No case-insensitive unique guarantee for user email or pending invite email. Application paths lowercase email, but the `users.email` uniqueness constraint is case-sensitive and invite normalization is not centralized.
9. No JSONB array/type/value constraint on role permissions. API validation protects current writes, but direct/internal writes can persist arbitrary JSON.
10. No state/timestamp constraints such as accepted status requiring `accepted_at`, non-accepted status forbidding it, or accepted-by linkage.
11. No `accepted_by_user_id`, invitation version, or ownership version for reliable attribution and compare-and-swap behavior.
12. No seat-limit enforcement. `maxTeamSlots` exists in plan contracts/admin UI but invite creation and acceptance do not use it.
13. No tenant/workspace foreign key on business assets, so database constraints cannot express member access or atomic ownership transfer.

The missing same-team foreign keys are defense-in-depth findings, not a claimed external IDOR on current routes. Current role/invite creation scopes IDs correctly. They become critical if new member assignment or transfer code trusts IDs without matching `team_id`.

## 7. Invitation-token lifecycle

### Creation

1. Owner-only `POST /invites` validates a trimmed email and UUID role ID.
2. `ensureOwnerTeam` resolves the actor's team.
3. `randomBytes(24).toString('hex')` produces a 192-bit token.
4. SHA-256 of the raw token is stored; the role is selected with the same team ID.
5. Email is stored lowercased. There is no pending-duplicate check, existing-member check, or seat check.
6. The audit detail stores the submitted email.
7. Email sending is fire-and-forget. The email body contains `Invitation token: <raw token>` but no acceptance URL. A rejected send promise is not caught by this route, while the invite remains committed.

### Delivery and client handling

- The database never stores the raw token, and the API request logger records `req.path`, not request bodies or query strings.
- The frontend requires `/[locale]/invitations/accept?token=...`, but the backend does not generate that link.
- The token remains in browser history and the page URL because the component never removes it with `history.replaceState`.
- URL-query placement can expose the capability to browser history, screenshots, same-origin referrers, and infrastructure/access logs outside the audited application logger. No repository-wide `Referrer-Policy` hardening was found.
- The signed-out link uses `/login?redirect=...`. `LoginPage` discards that parameter, and `AuthForm.getSafeNextPath` only accepts `next` paths under `/{locale}/app`; the invitation token is lost before acceptance.

### Acceptance

1. Any authenticated, email-verified account may submit the token.
2. The API hashes it and locks a pending, unexpired invite.
3. It upserts membership for `user.id`, preserving the invite's `role_id` but setting legacy role to member on insert and not updating legacy role on conflict.
4. It marks the invite accepted and commits.
5. It attempts a separate audit insert after commit, without recording the invite ID in `entity_id`.

There is no query or comparison involving invite email or current user email. An existing membership is silently reassigned to the invited role by `ON CONFLICT ... DO UPDATE SET role_id`, so an invitation is also an implicit role-change capability.

### Revoke, expiry, replay, and errors

- Revoke changes only a pending invite for the owner-derived team.
- Expiry is enforced at acceptance time but does not update stored status. An expired row may still appear as pending in the owner overview and may be revoked.
- Replay and double acceptance are prevented by pending status plus row locking.
- Invalid, expired, revoked, and accepted tokens all produce `404 INVITE_NOT_FOUND` with `Invite is invalid or expired.`
- This generic response avoids public account/state enumeration, which should be preserved.
- Antigravity's UI cannot distinguish those states: it classifies any such message as expired; its `wrong_account` state is never set or rendered.

## 8. Concrete exploitable paths and verified non-findings

### Threat-model coverage

| Threat                                        | Audited status and concrete control/path                                                                                                                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Horizontal cross-business access              | No current IDOR found in team role/invite identifiers: update/delete/create/revoke SQL includes the owner-derived `team_id`. Member-domain access is absent, so the completed backend must add and negatively test tenant resolution rather than accept a client business/team ID.   |
| Platform admin privilege escalation           | No path found. `PATCH /api/admin/users/:id` requires `super_admin` for admin-power fields and forbids self-change.                                                                                                                                                                   |
| Member privilege escalation                   | Stored team permissions currently grant no backend capability. Owner-role invitation creates dangerous persisted state, but it does not currently let the invitee read the victim workspace. Enabling membership authorization makes H-01 exploitable for access unless fixed first. |
| Custom-role overreach                         | Current backend ignores custom permissions outside team data. The risk is prospective: a new resolver must validate same-team role and server-stored permissions and must not trust role names/client arrays.                                                                        |
| Invitation replay                             | Prevented by pending status plus `SELECT ... FOR UPDATE`; later attempts receive the generic not-found response.                                                                                                                                                                     |
| Token leakage                                 | Database stores SHA-256 only and the API logger omits body/query. Antigravity moves the raw bearer into an unsanitized URL query/history; frontend/infrastructure exposure remains M-02.                                                                                             |
| Wrong-account acceptance                      | Confirmed H-01: acceptance never compares invite email to the authenticated database email.                                                                                                                                                                                          |
| Duplicate pending invitations                 | Confirmed M-01: there is an index but no partial unique constraint or service check.                                                                                                                                                                                                 |
| Duplicate memberships                         | Blocked per team by `UNIQUE (team_id, user_id)`; acceptance instead silently updates the existing role ID.                                                                                                                                                                           |
| Accept-versus-revoke race                     | Single-winner under current PostgreSQL row locking/conditional update. Missing concurrency test remains a release gap.                                                                                                                                                               |
| Concurrent ownership transfer                 | No route exists, so no current exploit is claimed. The schema has no single-owner/version invariant; H-04 defines the required transaction.                                                                                                                                          |
| Removing/demoting the owner                   | No member mutation routes exist. Owner invites already allow multiple owner-role rows; future generic member routes must reject owner/last-owner mutation.                                                                                                                           |
| Assigning a role from another workspace       | Current owner routes scope role IDs to their team. The database lacks composite same-team FKs, so future member routes/internal writes must not rely on the plain role FK.                                                                                                           |
| Deleted-role assignments                      | Current delete locks/reassigns members, and invite `RESTRICT` blocks deletion when referenced. No external assignment of a deleted role was found; null-role and historical-invite behavior still need explicit constraints/tests.                                                   |
| Primary account-role mutation                 | Confirmed M-04: `PATCH /api/admin/users/:id/role` can change another current owner to non-business and orphan team management.                                                                                                                                                       |
| Frontend-only authorization                   | Confirmed integration risk: `canAdministerTeam`/`isOwner` hide controls, while no workspace permission enforcement exists server-side.                                                                                                                                               |
| Unsafe redirects preserving invitation tokens | Confirmed M-02: frontend creates a nested token-bearing `redirect`, login drops it, auth would reject the invitation path even under `next`, and the acceptance page never scrubs the URL.                                                                                           |
| Sensitive token logging                       | No raw-token log call found in repository code; `requestLoggingMiddleware` logs `req.path` only. Query-string use may still reach browser/proxy/platform logs outside that logger.                                                                                                   |
| Email account enumeration                     | No current public route reveals account existence; invitation state failures are deliberately generic. Preserve this property when adding preview/wrong-account responses.                                                                                                           |

### H-01: wrong-account acceptance (high, launch blocker)

Concrete route trace:

1. A business owner calls `POST /api/business-teams/invites` with a role in the owner's team.
2. A different verified account obtains the raw invitation token, for example because the intended recipient forwards it or it leaks from the proposed query-string URL/history.
3. The different account calls `POST /api/business-teams/invites/accept` with the token.
4. The handler selects only `id`, `team_id`, and `role_id`. It never loads invite email or authenticated email.
5. The handler inserts/updates `business_members.user_id = attacker.id` and consumes the invite.

If the invited role is Owner, the persisted membership references the Owner role. Current `main` still denies that account team/domain access unless its primary role and owner-derived team happen to match, so no current read of the victim business was demonstrated. The upcoming member-integration work would convert this persisted unauthorized membership into effective cross-business access unless acceptance is fixed first.

Required fix: inside the locked acceptance transaction, load the current user's canonical email from the database and compare it to a canonical invite email. On mismatch return a generic failure and make no state change. Do not rely on email from a JWT or client body.

### H-02: duplicate-team creation race (high, launch blocker)

Concrete route trace:

1. Two first-time `GET /api/business-teams/me` requests for one business execute concurrently.
2. Both transactions run `SELECT ... WHERE business_id = actor.id` and see no row.
3. Both execute `INSERT INTO business_teams` successfully because no unique constraint covers `business_id`.
4. Each creates its own roles and owner membership.
5. Later `SELECT ... LIMIT 1` has no ordering and can select one of two teams, leaving invites/members in the other team hidden but valid.

Required fix: add the unique invariant and use a conflict-safe insert/reselect or explicit lock. Test it on real PostgreSQL with concurrent connections.

### H-03: permissions and tenancy are not integrated (high launch impact; no current bypass claimed)

`BusinessTeamPermission` is currently data/UI only. The domain routes use primary role and actor user ID. A member cannot exercise any granted permission, and a primary business account effectively has full team management without a `manage_team` check.

The immediate failure mode is denial of advertised functionality. The security risk appears if the backend branch makes the UI the only gate or swaps in client-provided `businessId`: a manager/member could call hidden actions directly or target another tenant. Every business-domain route must resolve server-side actor membership, same-team role, permission, and tenant resource ownership.

### H-04: unsafe owner model for transfer (high launch impact)

There is no transfer endpoint today, so no transfer race is claimed on `main`. However:

- multiple owner-role memberships can be created through normal invites;
- no database constraint defines exactly one owner;
- `business_teams.business_id` is both team lookup key and apparent owner;
- business assets belong to that user ID independently of the team;
- admin primary-role mutation can remove the current owner's ability to call `ensureOwnerTeam`.

A transfer that only changes owner-role memberships or only changes `business_id` would produce inconsistent ownership. The tenant model must be decided before the endpoint is implemented.

### M-01: duplicate invites and email abuse (medium)

The same owner can create multiple pending invites for the same normalized email/team, including for existing members, and can do so up to the broad global API limit. Each request creates a row and attempts an email. `maxTeamSlots` is ignored. This supports duplicate invitation spam, ambiguous role assignment, and last-invite-wins role changes when multiple tokens are accepted.

### M-02: token exposure and broken login continuation (medium)

The frontend places the bearer token in the query string, never scrubs it, and nests it inside an unsupported `redirect` query parameter. This both expands token exposure and fails the signed-out acceptance journey.

### M-03: audit is non-atomic and incomplete (medium)

Team mutations commit before their audit inserts. Audit failure can therefore return an error after the mutation succeeded, encouraging unsafe retries and leaving missing audit history. Acceptance omits the invite ID. Team creation/role seeding/owner upsert performed by `GET /me` are unaudited. Audit rows are deleted with the team. Invite creation stores email PII in `detail`, contrary to the general audit-log migration guidance not to log PII.

### M-04: primary-role mutation can orphan the owner (medium)

An admin with `manage_users` can change another business owner's primary role. The team and owner membership remain, but all team routes then fail `BUSINESS_ROLE_REQUIRED`. This is a concrete availability/integrity failure even though it does not grant the admin new power.

### M-05: custom-role deletion is blocked by invitation history (medium)

Role deletion reassigns members but does not reassign, snapshot, revoke, or delete invitations. `business_team_invites.role_id` uses `ON DELETE RESTRICT`, so any pending or historical invite referencing the role causes the role deletion transaction to fail. The route does not translate that constraint failure into a stable contract error.

### Verified non-findings

- No current role/invite IDOR was found: role IDs, replacement IDs, and invite IDs are team-scoped in SQL.
- No current invitation replay was found: row locking and pending status serialize acceptance.
- Accept-versus-revoke is single-winner on PostgreSQL; no path was found where both statuses commit.
- No raw invitation token is stored in the database or logged by the repository's API request logger.
- No public email-account enumeration was found in invite creation or acceptance. Creation does not reveal whether an account exists; acceptance intentionally collapses invalid states.
- No limited-admin-to-super-admin escalation was found. Admin-power changes require an existing super admin and cannot target self.
- No member privilege escalation through stored permissions is currently effective because member authorization is absent. This must not be mistaken for a completed security control.

## 9. Severity and launch impact

| ID                                                                  | Severity         | Launch impact                                                                                    |
| ------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| H-01 wrong-account acceptance                                       | High             | Block Wave 2H and block enabling member access.                                                  |
| H-02 duplicate-team race                                            | High             | Block team rollout; can split one business into inconsistent teams.                              |
| H-03 missing server-side workspace authorization/tenant integration | High             | Block Wave 2G; current feature is non-functional for delegates and unsafe to complete piecemeal. |
| H-04 incomplete owner/tenant model                                  | High             | Block ownership transfer and owner-role invitations.                                             |
| M-01 duplicate invites/seat and email abuse                         | Medium           | Fix before public invitation sending.                                                            |
| M-02 URL token exposure and broken login return                     | Medium           | Fix before sending clickable invitation links.                                                   |
| M-03 non-atomic/incomplete audit                                    | Medium           | Fix before privileged member/owner mutations.                                                    |
| M-04 primary-role owner orphaning                                   | Medium           | Add guard before treating teams as durable business workspaces.                                  |
| M-05 role deletion blocked by invites                               | Medium           | Fix before enabling custom-role lifecycle in production UI.                                      |
| Contract/status/normalization drift                                 | Low individually | Resolve during integration to prevent misleading UI and brittle clients.                         |

## 10. Required fixes

### Required before Wave 2G/2H launch

1. Define a durable workspace/tenant identity and decide which records belong to it. Do not implement transfer until services, jobs, reservations, profiles, wallets/financial visibility, support, and analytics have an explicit ownership strategy.
2. Add a centralized backend resolver such as `resolveBusinessWorkspaceAccess(actorUserId, workspaceId, permission)` that:
   - derives membership from the database;
   - verifies role and membership belong to the same workspace;
   - distinguishes actor ID from tenant/owner ID;
   - treats owner authority explicitly;
   - checks named permissions for every protected action;
   - returns indistinguishable not-found/forbidden results where cross-tenant enumeration matters.
3. Add database invariants for one team per business, same-team role references, canonical pending-invite uniqueness, permission shape, accepted attribution/state, and a single coherent owner model.
4. Reject Owner as a normal invitation/member-role assignment. Ownership must change only through the transfer transaction.
5. Bind invite acceptance to the current database email and record `accepted_by_user_id`. Reject silent role mutation of an existing membership unless the product explicitly defines and authorizes that behavior.
6. Enforce seat limits and one pending invite per canonical email/team transactionally. Make repeated creation idempotent or rotate/revoke the prior invite safely.
7. Deliver a real acceptance link. Keep the secret out of ordinary query strings where practical (for example, a fragment read client-side and immediately scrubbed), never consume on GET, and preserve it across auth using a narrowly scoped same-origin mechanism. Post the token only in the authenticated acceptance request.
8. Return stable error codes/statuses and make the frontend branch on codes, not English messages. Preserve generic responses against email/state enumeration.
9. Put mutation and audit/outbox writes in the same transaction. Record actor, invite/member/role ID, before/after role, and ownership version without raw tokens or unnecessary email PII.
10. Implement role deletion semantics for referenced invitations and ensure deleted/null roles cannot be assigned or returned as valid memberships.
11. Guard platform primary-role mutation and user deletion/deactivation for current workspace owners. Require completed transfer or an explicit super-admin recovery workflow.

### Ownership-transfer transaction requirements

- Lock the workspace/owner row and target membership.
- Verify the actor is the current owner from database state, not client state.
- Verify the target is an active, verified member of the same workspace and is eligible under the chosen business identity model.
- Use an ownership version or expected-current-owner condition so two concurrent transfers cannot both report success.
- Update the authoritative owner and both memberships atomically.
- Prevent owner removal/demotion through every generic member/role route.
- Enforce exactly one owner in the database, not merely in service code.
- Write the transfer audit/outbox record in the same transaction.
- Define what happens to user-owned business profile, services, jobs, reservations, financial records, and subscriptions; do not silently leave a split business.

## 11. Test matrix

### Unit tests

| Area                   | Required cases                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email canonicalization | trim/case normalization shared by users and invites; DB-loaded current email comparison; Unicode/invalid cases according to policy.                                    |
| Permission resolver    | owner, manager, member, viewer, every custom permission; deny missing/null/deleted/cross-team role; primary account role must not substitute for workspace membership. |
| Role policy            | Owner not assignable by invite/member patch; manager behavior follows permissions rather than label; legacy role mismatch cannot grant access.                         |
| Invite state mapping   | stable codes for invalid, expired, revoked, accepted, wrong account, existing membership, and seat limit.                                                              |
| Frontend safe return   | only same-origin approved paths; invitation continuation supported deliberately; external/protocol-relative paths rejected.                                            |
| Token hygiene          | redaction helpers never log token/query; acceptance component scrubs URL immediately.                                                                                  |

### API tests

| Threat            | Required negative/positive cases                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Horizontal access | Owner A cannot patch/delete Role B, use Role B as replacement, invite with Role B, revoke Invite B, update/remove Member B, or transfer Team B.                                        |
| Wrong account     | Recipient succeeds; same local address with different case follows canonical policy; different signed-in account fails without consuming; subsequent correct recipient still succeeds. |
| Role escalation   | Member/viewer/custom without `manage_team` cannot invite/revoke/update roles; forged permission arrays and role IDs are ignored/rejected; Owner role invitation rejected.              |
| Member lifecycle  | Existing member invite does not silently change role; owner cannot be removed/demoted; last owner cannot be removed; deleted/null role rejected.                                       |
| Primary role      | Non-business workspace member can access only authorized workspace capabilities; changing/deactivating owner is blocked or routed through recovery.                                    |
| Enumeration       | Unknown email, existing email, invalid token, wrong account, revoked, and accepted cases expose only the intended generic information.                                                 |
| Audit             | Each successful mutation creates one correctly linked audit event; failed authorization/state changes create no success event and no mutation.                                         |

### Real PostgreSQL tests

Use an isolated scratch database and apply migrations there; do not mock SQL semantics.

- `business_teams.business_id` uniqueness.
- composite same-team role foreign keys for members and invites.
- one pending canonical invite per team/email.
- membership uniqueness and intended cross-team membership policy.
- exactly-one-owner invariant and owner-removal rejection.
- permission JSON constraints.
- invite accepted/status/timestamp/accepted-by constraints.
- role delete with pending, accepted, revoked, and expired invite history.
- RLS/revocations for all five business-team tables.
- migration replay from the current production migration chain.

### Concurrency tests

- Two first-use team requests create exactly one team and one owner membership.
- Two accepts of one invite: exactly one state transition and no duplicate membership/audit.
- Accept versus revoke: exactly one succeeds; the loser receives a stable conflict/gone result.
- Two simultaneous invites for the same canonical email: one pending row/email delivery.
- Two simultaneous accepts for different invites to the same user: deterministic role policy, not last-lock-wins escalation.
- Two ownership transfers from the same owner: one succeeds; the other fails expected-owner/version check.
- Transfer versus owner removal/demotion/primary-role mutation.
- Role deletion versus invite creation/acceptance/member reassignment.
- Seat-limit boundary with simultaneous invitation acceptance.

### Frontend contract tests

- Render the acceptance page for signed-in and signed-out users; do not limit tests to the API client.
- Follow the actual email link through locale routing, login, return, accept, and URL scrubbing.
- Assert the secret is absent from the URL/history after capture and never appears in rendered error text or telemetry.
- Branch on backend code/status, not localized message substring.
- Verify wrong-account guidance without revealing recipient email to an unauthorized account.
- Verify accepted non-business members can select/open the invited workspace after backend integration.
- Verify owner/manager/member/viewer/custom visibility against the same permission fixtures used by backend tests.
- Verify hidden buttons do not substitute for API rejection by issuing direct requests in contract/E2E tests.
- Verify Owner is absent from ordinary invite and role-update choices.
- Verify `/api` route prefix and response shapes against a running API, not fetch mocks alone.

### Existing coverage and gaps

- `apps/api/src/tests/phase2_5-product-value.test.ts` checks source strings and route mounting, not authorization behavior.
- `apps/api/src/tests/launch-surface.test.ts` checks that the feature is advertised/mounted, not that it is safe.
- No current API test invokes the business-team router with multiple users/teams.
- No current real-PostgreSQL or concurrency test covers business teams.
- Antigravity's `apps/web/tests/business-team-invitations.test.ts` has 11 passing tests, but they mock fetch or assert local arrays/regexes. It does not render the panel/acceptance screen, follow login, inspect URL hygiene, or integrate with the API.

## 12. Antigravity integration risks

1. **No email link:** backend invitation email supplies raw token text only; the new page is never linked.
2. **Broken signed-out continuation:** the component emits `redirect`, `LoginPage` drops it, and auth recognizes only `next` under the app subtree.
3. **Token in query:** the component reads `?token=` and never scrubs it.
4. **Wrong-account handling is fictional:** the state exists in the type but is never selected or rendered; current backend accepts the wrong account.
5. **Status mismatch:** backend uses one 404/message for invalid, expired, revoked, and accepted. Frontend message matching categorizes all of them as expired before the `already` branch can run.
6. **Workspace link mismatch:** success links to `/{locale}/app`; navigation/dashboards are selected by primary account role, with no active invited workspace.
7. **Role-policy mismatch:** frontend treats manager/admin as team administrators despite manager lacking `manage_team`; custom `manage_team` roles are treated as members; viewer is omitted from the approved product taxonomy.
8. **Owner invitation:** the role dropdown renders every returned role, including Owner.
9. **Client-only gating:** forms/buttons are hidden by `userWorkspaceRole`, but no shared permission resolver or direct-request negative test backs this presentation.
10. **Contract prefix drift:** documentation says `/api/v1`; code and client use `/api`.
11. **Stale baseline:** Antigravity documents `origin/main` at `1aa7978`; the audited main is `b2d146e`. A three-way merge simulation is currently conflict-free, but validation must run after integration with the completed backend branch.
12. **Error contract loss:** `businessTeamsApiClient.request` throws only `Error(message)` and discards HTTP status and backend error code, preventing reliable state handling.

## 13. Shared-file conflict risks

### Current frontend-to-main merge

`git merge-tree --write-tree origin/main origin/feat/wave-2gh-team-invitations-ui` completed without conflicts at audit time. No commits after Antigravity's merge base modified its three existing shared production files (`business-team-panel.tsx`, `business-teams/client.ts`, `dashboard.css`) on the audited main.

### Files likely to conflict with the backend integration branch

The unfinished backend branch was intentionally not inspected. The following files are natural convergence points and require manual review rather than blind conflict resolution:

- `apps/api/src/modules/business-teams/business-teams.routes.ts`
- `apps/api/src/middleware/authenticate.ts`
- `apps/api/src/middleware/require-role.ts`
- `apps/api/src/routes/index.ts`
- `packages/shared/src/product-growth.ts`
- `packages/shared/src/roles.ts`
- `apps/web/lib/business-teams/client.ts`
- `apps/web/components/app/business-team-panel.tsx`
- `apps/web/components/team/invitation-acceptance-screen.tsx`
- `apps/web/components/auth/auth-form.tsx`
- `apps/web/app/[locale]/login/page.tsx`
- `apps/web/middleware.ts`
- `apps/api/src/utils/send-transactional-email.ts`
- business-team migration(s) added by the backend branch
- services/jobs/reservations/analytics/wallet/support middleware, controllers, and repositories if permissions become real

Do not resolve shared types by weakening them to optional fields. The backend and frontend should agree on stable error codes, active workspace identity, current member/permissions, accepted invite result, and owner policy.

## 14. Review checklist for Claude's completed backend branch

### Authorization and tenant isolation

- [ ] Every route derives actor identity from authentication and tenant identity from server-side membership/resource lookup.
- [ ] No route trusts client `businessId`, `teamId`, `memberId`, or `roleId` without a same-workspace predicate.
- [ ] A single permission resolver is reused across team and domain routes.
- [ ] Owner is explicit; manager/member/viewer/custom roles follow permissions consistently.
- [ ] Direct API requests are denied even when the frontend would hide the action.
- [ ] Cross-business negative tests cover every identifier-bearing route.

### Invitations

- [ ] Token remains high entropy and only a hash is stored.
- [ ] Invite is bound to the current database email during the locked acceptance transaction.
- [ ] Wrong-account failure does not consume the invite or enumerate the recipient.
- [ ] Owner cannot be assigned by ordinary invite.
- [ ] Existing membership behavior is explicit and cannot silently escalate/change role.
- [ ] Duplicate pending invites and seat limits are transactionally enforced.
- [ ] Accept/revoke/double-accept concurrency has real PostgreSQL tests.
- [ ] Email contains a working link; token is scrubbed and not logged.
- [ ] Email send failure is caught/retried through an outbox or produces an honest invitation-delivery state.

### Ownership and roles

- [ ] One-team and one-owner database invariants exist.
- [ ] Transfer locks/versions the current owner and target member and has a single winner under concurrency.
- [ ] Generic member routes cannot remove/demote the owner.
- [ ] Admin primary-role mutation/deletion/deactivation cannot orphan the owner.
- [ ] Same-team composite role constraints exist for members and invites.
- [ ] Deleted/null roles cannot authorize or break overview serialization.
- [ ] Role deletion handles all invitation statuses deliberately.
- [ ] Legacy `business_members.role` is removed, synchronized, or proven irrelevant.

### Domain integration

- [ ] The chosen workspace owns or can safely proxy services, jobs, reservations, analytics, support/disputes, and wallet visibility.
- [ ] Financial permissions are fail-closed and do not let delegates mutate the owner's personal wallet.
- [ ] Ownership transfer has defined behavior for all user-owned business assets and subscriptions.
- [ ] The frontend can select/open an invited workspace independent of primary account role.

### Audit and contracts

- [ ] Audit/outbox rows commit atomically with mutations and contain stable entity IDs and before/after state.
- [ ] No raw token or unnecessary email PII enters logs/audit/telemetry.
- [ ] API returns stable codes for invitation states; frontend uses codes.
- [ ] Actual `/api` prefix and shared types match the frontend.
- [ ] Frontend's Owner/Admin/Member/Viewer/custom mapping matches backend policy.
- [ ] All unit, API, PostgreSQL, concurrency, and frontend contract tests in section 11 pass after merging current `main`, backend, and Antigravity.

## Validation performed

- Confirmed requested refs: `origin/main = b2d146e`; Antigravity tip `= 1c6c95e`; Wave 2I worktree/branch was not modified.
- Read-only merge simulation of current main and Antigravity: successful, no conflicts.
- Main relevant tests after building shared package: 3 files, 14 tests passed (`phase2_5-product-value`, `launch-surface`, `admin-verification-auth`).
- Antigravity exact-tip invitation tests: 1 file, 11 tests passed.
- Antigravity exact-tip web typecheck: passed.
- Antigravity exact-tip full web lint: passed.
- Audit-branch full workspace typecheck: passed.
- Audit-branch full API and web lint: passed.
- Real PostgreSQL tests were not run: no `DATABASE_URL` or Docker runtime was available, and no existing business-team PostgreSQL test exists. No migration was applied and no production data was written.
