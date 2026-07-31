# Wave 2G/2H final independent implementation review

Date: 2026-07-31

Reviewed baseline: `origin/feat/wave-2gh-team-backend-integration` at `9ea54d4724a398e4b936c7a64581135cbbcd7028`

Original audit: `audit/wave-2gh-security-and-integration` at `00698625d49848aa15edf5e6d25cb7e47cb4f859`

Review branch: `review/wave-2gh-final`

## Executive verdict

Do not merge or apply migration `20260731120000` yet.

- **Ownership transfer:** architectural prerequisite. The endpoint transfers team-administration standing, not ownership of the business, catalogue, jobs, advertisements, bookings, subscriptions, MHC, wallet, or financial history. The UI and contract call this “Business Ownership” and “full workspace access,” which is materially misleading. Keep the endpoint disabled for launch.
- **Wave 2G:** partially complete. Server-authoritative team administration exists, but workspace-wide delegated work does not. Six of seven exposed permissions have no domain authorization effect, invited non-business members cannot reach the team panel in the current frontend, and the resolver cannot select among multiple memberships.
- **Wave 2H:** partially complete. The backend invitation state machine is substantially sound, but seat limits, query-token hygiene, registration/email-verification continuation, multi-workspace access, and migration compatibility are unresolved.
- **Migration:** blocker. It omits uniqueness for `business_teams.business_id`, does not enforce the lower owner bound, and can fail on legitimate baseline history such as revoked invitations because it adds the revoked-shape check without backfilling `revoked_at`.

No production code was changed in this review. No migration was applied and no production data was read or written.

## 1. Current architecture

### Identity and tenancy

- `users.primary_role` remains the account role. `authenticate` in `apps/api/src/middleware/authenticate.ts` refreshes that role, active/deleted state, email verification, and platform-admin state from the database.
- `business_teams.business_id` remains the immutable original business account. The base FK is `ON DELETE CASCADE`.
- Workspace standing is a `business_members` row plus `business_team_roles`. `manager` is presented as Admin; custom roles always resolve to the Member tier.
- `readWorkspaceContext` in `apps/api/src/modules/business-teams/business-teams.authorization.ts` resolves a workspace from the authenticated user only. It accepts either `t.business_id = userId` or a membership, then orders the original account's team first and otherwise the oldest team, with `LIMIT 1` (lines 78-118).
- No active-workspace identifier or workspace selector exists. A user can have memberships in multiple teams at the database level, but can operate only the single row selected by this query. A business account with its own team can never select a team it joined or later received through transfer.
- All team mutations scope member, invite, and role IDs to that server-resolved `teamId`; no team mutation accepts a client-supplied business/team ID.

### Authorization symbols

| File | Symbol | Effect |
| --- | --- | --- |
| `apps/api/src/middleware/authenticate.ts` | `authenticate` | Establishes current account identity and primary role. |
| `apps/api/src/modules/business-teams/business-teams.authorization.ts` | `readWorkspaceContext` | Resolves one workspace and current membership/role/permission array. |
| same | `canAdministerTeam`, `requireTeamAdministration` | Owner/Admin or stored `manage_team`. |
| same | `requireRoleManagement` | Owner only. |
| same | `requireOwnership` | Membership Owner only. |
| same | `allowedActionsFor` | Emits presentation actions for team-panel operations only. |
| `apps/api/src/modules/business-teams/business-teams.constants.ts` | `ALL_BUSINESS_TEAM_PERMISSIONS`, `BUILT_IN_ROLE_SEEDS`, `tierForRole`, `isAssignableRole` | Defines Owner/Admin/Member mapping and assignability. |
| `apps/api/src/modules/business-teams/business-teams.service.ts` | `resolveContext`, `provisionWorkspace` | Provisions primary business accounts and invokes the resolver. |
| same | `createRole`, `updateRole`, `deleteRole` | Owner-only custom-role lifecycle. |
| same | `createInvite`, `revokeInvite`, `previewInvite`, `acceptInvite` | Invitation lifecycle. |
| same | `updateMemberRole`, `removeMember`, `transferOwnership` | Membership and transfer mutations. |
| `apps/api/src/middleware/require-role.ts` | `requireRole` | Still protects domain routes by `users.primary_role`, not workspace role. |

Database/browser access remains backend-only under the earlier RLS/revoke migrations. That is useful defense in depth, but application-service database credentials bypass those browser-role policies, so application authorization and database invariants remain required.

## 2. Exact route coverage

The deployed prefix is `/api`, not `/api/v1`. `apps/api/src/routes/index.ts` mounts the router at `/business-teams`.

| Route | Authorization and identifier trace | Result |
| --- | --- | --- |
| `GET /api/business-teams/invites/preview?token=` | rate limit -> optional auth -> `previewInvite` -> SHA-256 lookup | Public, generic unknown/malformed response; valid possession reveals only team, inviter, role, expiry, and masked email. Token remains in the URL. |
| `GET /api/business-teams/me` | auth + verified email -> `getOverview` -> `resolveContext` | Workspace-aware, but one implicit workspace only. |
| `POST/PATCH/DELETE /api/business-teams/roles[/roleId]` | `requireRoleManagement`; role and replacement constrained by `team_id` | Owner-only and cross-workspace scoped. |
| `POST /api/business-teams/invites` | `requireTeamAdministration`; role loaded by current `team_id` | Owner/Admin/`manage_team`; Owner/viewer/cross-team role rejected. No seat check. |
| `POST /api/business-teams/invites/:inviteId/revoke` | `requireTeamAdministration`; invite queried by current `team_id` and ID under lock | Cross-workspace safe. |
| `POST /api/business-teams/invites/accept` | authenticated DB email -> token-hash row lock -> canonical email match | Correct-account only; no client workspace ID. |
| `PATCH/DELETE /api/business-teams/members/:memberId` | `requireTeamAdministration`; member and role queried by current `team_id` | Cross-workspace safe; Owner protected. |
| `POST /api/business-teams/transfer-ownership` | `requireOwnership`; team lock -> owner recheck -> same-team target | Race-safe membership swap, but not a real business ownership transfer. |

Uncovered capabilities are workspace selection and all business-domain operations. There is also no endpoint that lets an invited non-business user navigate directly to or select an accepted workspace.

## 3. Original audit resolution matrix

“Repository test” below means the feature branch contains the named test. The real-PostgreSQL file was not executed in this review environment: its 39 tests skipped because no approved local PostgreSQL was available.

| Original finding | Classification | Exact implementation / route / invariant | Repository test evidence | Remaining launch impact |
| --- | --- | --- | --- | --- |
| H-01 wrong-account invitation acceptance | **Fixed** | `acceptInvite` lines 824-872 reads the authenticated account email and compares it with `emailsMatch` before status/acceptance. Route: `POST /api/business-teams/invites/accept`. The transaction rolls back on mismatch. | `business-teams.workspace.pg.test.ts:601`; canonical case test at `:617`. Missing: wrong user then correct user on the same token. | No identified acceptance bypass. Add the missing non-consumption test before merge. |
| H-02 duplicate team creation on concurrent first access | **Not fixed** | `provisionWorkspace` lines 179-197 performs a missing-row `SELECT ... FOR UPDATE` then plain `INSERT`. A missing row locks no gap at READ COMMITTED. Neither the base schema nor `20260731120000` makes `business_teams.business_id` unique. Route: concurrent `GET /api/business-teams/me`. | No ten-first-access test exists. | **Launch blocker:** one business can split into multiple teams, roles, owners, invitations, and audit histories. |
| H-03 stored but unenforced workspace permissions | **Partially fixed** | `manage_team` is enforced by `canAdministerTeam`; the other six permissions are only returned by `GET /me`. Services/jobs/reservations/support/analytics/wallet continue to use primary role and `req.user.id`. | PG tests `:218` and `:247` prove stored permissions and `manage_team` only. No real domain-permission test. | Blocks calling Wave 2G workspace delegation complete. UI role creation advertises capabilities the API ignores. |
| H-04 unsafe ownership transfer in user-owned asset model | **Not fixed** | `transferOwnership` lines 1117-1221 swaps Owner/Admin memberships. Migration trigger makes `business_id` immutable. All domain assets remain keyed to the old account. | PG tests `:1006`, `:1061`, `:1106`, `:1133` prove the membership transaction and immutability, not transferred capabilities. | **Launch blocker for transfer:** split control and misleading ownership claims. |
| M-01 duplicate invites, existing members, seats, email abuse | **Partially fixed** | `createInvite` canonicalizes email, locks the team, rejects existing membership, retires stale invites, and migration adds normalized pending uniqueness. `maxTeamSlots` is never read. | PG tests `:634`, `:665`, `:695`. No seat/quota or concurrent-create test. | Invitations can exceed purchased team seats; resend/delivery policy remains unbounded apart from global rate limiting. |
| M-02 token URL exposure and broken login continuation | **Partially fixed** | Existing verified-user login uses allowlisted `next` in `auth-form.tsx:122-130,340-344`. The token remains in acceptance and auth query strings and is never scrubbed. Registration/unverified login sets `safeNext = null`, then `verify-email-screen.tsx` redirects to onboarding without the invite. | API log-redaction tests at `business-teams.routes.test.ts:276,327`; no rendered continuation/scrubbing/verification test. | Query/history/referrer/proxy exposure remains. New-account acceptance is stranded after verification. |
| M-03 non-atomic and incomplete auditing | **Partially fixed** | `inTransaction` and `audit` (`business-teams.service.ts:123-162`) use the same client for mutations, including invite ID on acceptance. Provisioning/role seeding is still unaudited; audit rows cascade with team deletion; invite-create audit stores normalized email PII. | Race/service tests inspect some history at PG `:954`; no rollback-on-audit-failure coverage. | Mutation/audit atomicity is fixed. Completeness, retention independence, PII policy, and provisioning history remain. |
| M-04 owner orphaning after primary-role changes | **Partially fixed** | Team-panel resolution no longer requires primary `business`, so the membership Owner retains team administration. Domain routes still require primary roles and original user identity. `admin.repository.ts:updateUser` can still change `primary_role` without workspace-owner/domain checks. | PG test `:299` proves joining does not mutate account role; no admin-role-mutation/owner recovery test. | Changing/deactivating the original business account can strand all business operations even while another member is called Owner. |
| M-05 historical invitations block role deletion | **Fixed** for availability, with an audit caveat | `deleteRole` lines 454-519 reassigns members and every invitation before deleting the custom role in one transaction. | PG historical test begins at `:954`. | Deletion no longer fails, but historical accepted/revoked invitations are rewritten to the replacement role, losing the exact role originally offered. |
| Contract/status/normalization drift | **Partially fixed** | Stable error codes, canonical email, Manager->Admin, legacy Viewer, assignability, and `/api` docs are aligned. Active-workspace and domain-capability semantics are not. | Route tests and `apps/web/tests/business-team-invitations.test.ts`. | Integration remains misleading for multi-workspace and domain operations. |

### Antigravity risk-by-risk resolution

| Original integration risk | Classification | Current result |
| --- | --- | --- |
| No invitation acceptance link | **Fixed** | `deliverInviteEmail` creates `/{locale}/invitations/accept?token=...` (currently hard-coded `en`). |
| Signed-out continuation | **Partially fixed** | Verified login works; registration/unverified flow loses `next` at email verification. |
| Token in query and never scrubbed | **Not fixed** | Acceptance reads `useSearchParams`; no `history.replaceState`; auth nests the token in another query value. |
| Wrong-account UI was fictional | **Fixed** | Preview and accept emit stable wrong-account state/code and the screen renders it. |
| Backend/frontend status mismatch | **Fixed** | Preview states and `BusinessTeamApiError.code` replace message matching. |
| Success link / active workspace mismatch | **Not fixed** | Success links to `/app`; `BusinessTeamPanel` is rendered only by `BusinessDashboard`, which is selected only for primary role `business`. Resolver has no workspace selector. |
| Manager/viewer/custom-role policy mismatch | **Partially fixed** | Manager=Admin and Viewer is legacy; `manage_team` is authoritative. Other custom/built-in operational permissions have no domain effect. |
| Owner offered by invitation UI | **Fixed** | Backend marks Owner non-assignable and UI filters `assignable`. |
| Frontend-only team authorization | **Fixed** for team-panel routes | All team mutations re-authorize server-side; PG tests `:319-461`. This does not create domain authorization. |
| `/api/v1` documentation mismatch | **Fixed** | `docs/implementation/WAVE_2_GH_TEAM_UI_CONTRACT.md` explicitly documents `/api`. |
| Stale Antigravity baseline | **Not reproducible** | The integrated feature tip contains the frontend commits and was reviewed directly. |
| Client discards stable error metadata | **Fixed** | `BusinessTeamApiError` carries backend status/code; client tests begin at web test `:220`. |

## 4. Role mapping findings

| Role | Stored tier | Stored permissions | Actual effect today |
| --- | --- | --- | --- |
| Owner | `owner` | all seven | Full team panel, role management, transfer. Domain operations still belong to the original account identity. |
| Admin | `manager` | team/services/jobs/reservations/support/analytics | Team invite/revoke/member administration. Non-team permissions have no effect. |
| Member | `member` | jobs/reservations/analytics | No team administration and no delegated domain operation. |
| Viewer | `viewer` legacy | historical | Resolves to Member, not assignable. Existing pending Viewer invitations can still be accepted because acceptance does not re-check `is_legacy`. |
| Custom | stored `member` tier | selected array | `manage_team` works. Every other permission is descriptive only. |

A custom role with `manage_team` can assign itself or another non-owner to Admin because `updateMemberRole` treats role assignment as team administration. That does not grant Owner, but it will become a privilege-widening path if domain permissions are later enforced. The intended delegation boundary must be decided before domain authorization is connected.

## 5. Existing and pending database guarantees

Existing baseline guarantees:

- primary keys on teams, members, roles, invitations, and audit rows;
- `UNIQUE(team_id, user_id)` membership;
- `UNIQUE(team_id, role_key)` role key;
- unique invitation `token_hash`;
- invitation status and membership-tier check constraints;
- FKs among users, teams, roles, members, and invitations.

Pending `20260731120000` adds:

- partial unique index `uq_business_members_single_owner` for **at most one** stored `role='owner'` per team;
- `business_members_resolve_tier` trigger for future insert/update tier derivation and cross-workspace role rejection;
- immutable `business_teams.business_id` trigger;
- normalized one-pending-invite index;
- SHA-256 token shape and bounded-expiry checks;
- accepted/revoked timestamps and linkage columns;
- legacy Viewer classification.

## 6. Missing or insufficient database guarantees

1. No `UNIQUE(business_id)` on `business_teams`; concurrent initialization is not protected.
2. No database lower bound requiring at least one Owner. Direct owner membership deletion or role change can commit zero owners. The API blocks ordinary remove/demote and transfer keeps the zero-owner interval inside one transaction, but the invariant is not structural.
3. The one-owner index is based on denormalized `business_members.role`; existing rows are not reconciled before the index, and the new trigger validates only future writes.
4. Existing cross-workspace `role_id` rows are not preflighted or repaired; the trigger is prospective.
5. Accepted status does not require non-null `accepted_by` or `accepted_member_id`; revoked status does not require `revoked_by`. “Linkage” is stored by the service, not fully guaranteed by checks.
6. `users.email` is case-sensitive unique at the database level. Application registration lowercases, but imports/direct writes can create canonical duplicates.
7. Deleting the original `business_id` user cascades deletion of the entire team even after membership ownership was transferred.

### Production-data compatibility

Compatibility is not established and must be checked read-only before application:

- baseline revoke SQL set `status='revoked'` without a `revoked_at` column. Any historical revoked row makes `chk_business_team_invites_revoked_shape` fail immediately;
- baseline allowed duplicate pending invitations, so the new partial unique index can fail;
- the first-access race allowed duplicate teams and owners across those teams; this migration neither detects nor repairs them;
- duplicate stored Owners, tier/role drift, malformed token hashes, over-30-day expiry, or accepted/timestamp drift can also block immediate constraint/index creation.

The rollback order documented in the migration is mechanically sensible (triggers before functions, then indexes, constraints, and columns). The test named “exact fingerprint” is not exact: it starts from a post-migration schema, permits a hand-maintained removal allowlist, and fingerprints neither functions nor comments. The migration changes the existing invitation table comment and rollback does not restore it.

## 7. Invitation-token lifecycle

1. `createInvite` canonicalizes with trim/lowercase, resolves an assignable same-workspace role, rejects existing membership/live pending invitation, creates 256-bit base64url entropy, and stores only SHA-256 hex.
2. The invitation row and audit row commit atomically. Email is sent after commit; failures log only a generic error and do not include token/link.
3. The email contains a clickable query-token URL. API request logging uses `req.path`, and tests verify token absence from application logs/error bodies. Browser history, auth query strings, upstream access logs, and referrer behavior remain exposure surfaces.
4. Preview is public/rate-limited. Unknown and malformed tokens are indistinguishable. Valid-token possession reveals a masked address plus invitation context; signed-in mismatch is reported only for a live invite.
5. Acceptance re-reads the authenticated DB email, locks the invite, checks identity before status, preserves an existing membership, otherwise inserts the invitation's exact `role_id`, updates linkage/status, and audits in one transaction.
6. Repeated accepts are idempotent. Accept and revoke lock the same row, so both cannot win. These claims have authored PG tests but were not independently executed here.
7. Role deletion rewrites all historical and pending invitation `role_id` values. A deleted role cannot remain referenced, but the historical promise changes. Legacy/inactive Viewer invitations can still be accepted at Member tier.
8. Acceptance never changes `users.primary_role`.

No public email-account enumeration route was found. Public preview requires possession of an unguessable token and unknown tokens are generic. An authorized team administrator can distinguish existing-member and already-pending outcomes inside their own workspace; that is workspace administration data, not public account enumeration.

## 8. Ownership-transfer verdict

### Explicit answers

1. **Is the transferred user a real workspace owner or only team administrator?** Only the top team administrator. They can manage roles, invitations, memberships, and another membership transfer. They do not own business assets or financial identity.
2. **Can the old owner still operate business assets?** Yes, while the original account remains active and retains the necessary primary role. Services, jobs, ads, analytics, reservations, plans, wallet, MHC, and profile records continue to use that account ID.
3. **Can both users reach privileged surfaces through different models?** Yes. The new membership Owner controls team administration; the old original account controls business-domain and financial surfaces and remains team Admin after transfer.
4. **Can the new owner transfer again?** A non-business, single-workspace member can. A user with an older membership or a primary-business-owned team may resolve a different team and be unable to reach the transferred workspace at all.
5. **Can the old owner regain Owner automatically through provisioning?** No. `provisionWorkspace` inserts an owner only if none exists and will not overwrite the old owner's Admin membership. The new Owner can explicitly transfer it back.
6. **Does UI claim broader ownership?** Yes. `business-team-panel.tsx:603-622` says “Business Ownership” and “Transfer primary ownership”; the contract says Owner has “full workspace access” and “billing/ownership control.” Neither is true.
7. **Is “Owner” misleading?** Yes. It means Owner of one membership administration table, not owner of the business workspace's operational or financial principal.
8. **Safe to launch now?** No. Keep `POST /api/business-teams/transfer-ownership` and its UI disabled until a coherent principal model is delivered. Renaming it “transfer team administration” is acceptable only if product deliberately wants that narrower capability and documents that the original account retains all assets and financial control.

### Capability trace after transfer

| Capability | Current authorization | New membership Owner | Old original account |
| --- | --- | --- | --- |
| Team/member/invite administration | workspace membership/tier | Full | Admin after transfer |
| Custom role management/next transfer | membership Owner | Yes, subject to resolver ambiguity | No |
| Business profile/settings | `profilesController` passes `req.user.id` | Own profile only, usually none for transferred business | Original business profile |
| Services/catalogue | provider primary role + controller `user.id`; repository provider ownership | Own provider services only if account role permits | Original business services |
| Jobs/hiring | `businessMw` requires primary `business`; controller passes `user.id` | Only own business jobs if independently a business account | Original jobs |
| Analytics | provider primary role + `getProviderAnalytics(user.id)` | Own account analytics only | Original business analytics |
| Advertisements | provider role + `advertiser_id === user.id` | Own ads only | Original ads and charging identity |
| Provider bookings/reservations | provider role + provider/participant `user.id` | Own participant/provider records only | Original business reservations/orders |
| Plans/subscriptions | controller/service `user.id` | Own plan | Original business plan/quota |
| Wallet/MHC/financial actions | controller/service `user.id` and activation/charging gates | Own balances only | Original business balances/history/actions |
| Support/disputes | actor/participant/admin identity | Own cases only | Original account cases |

## 9. Wave 2G domain authorization verdict

| Domain | Classification | Concrete trace |
| --- | --- | --- |
| Team settings, members, invites | Workspace-aware and permission-enforced | `resolveContext` + `requireTeamAdministration`; IDs scoped by `team_id`. |
| Custom role lifecycle/transfer | Workspace-aware and Owner-enforced | `requireRoleManagement` / `requireOwnership`; transfer semantics remain unsafe. |
| Business profile/settings | Original-account only | `profiles.controller.ts:get/updateBusinessProfile` pass `req.user.id`. |
| Services/catalogue | Primary-role plus original-account only | `services.routes.ts:providerMw`; controller passes `user.id` as `providerId`. |
| Jobs/hiring | Primary-business-role and original-account only | `jobs.routes.ts:businessMw`; controller passes `user.id` as `businessId`. |
| Analytics | Primary-provider-role and original-account only | `analytics.routes.ts` + `getMyAnalytics` -> `getProviderAnalytics(id)`. |
| Advertisements | Primary-provider-role and original-account only | routes require provider role; service checks/creates with `advertiser_id=userId`. |
| Reservations/orders/bookings | Individual provider/customer participant identity | controller passes `user.id`; service/repository checks participant/provider. No workspace delegation. |
| Subscriptions/plans | Individual/original-account only | `plansController` passes `user.id`. |
| MHC/wallet/financial | Individual/original-account only | all controllers pass `user.id`; intentionally not delegated. |
| Public search/catalogue | Unrelated | Public read paths do not mutate a workspace. |
| Admin surfaces | Platform-admin authorization | Separate `is_admin`/admin permissions; unrelated to workspace roles. |

`GET /business-teams/me` exposes `manage_services`, `manage_jobs`, `manage_reservations`, `view_wallet`, `manage_support_disputes`, and `view_analytics`, but no corresponding domain middleware reads them. Admin and Member therefore cannot do useful work for the business beyond team administration. A removed member loses team-panel access on the next call, but no domain access is revoked because membership never granted domain access. Their own account-role capabilities remain unchanged.

A member cannot make a domain endpoint act as another business merely by supplying a business ID: the audited create/list/mutate paths derive owner/provider/business identity from `req.user.id` and resource ownership checks. That is safe isolation, but it is also proof that delegation is unavailable. There are no direct-request negative tests spanning membership plus services/jobs/analytics/reservations.

## 10. Concrete exploitable or failing paths

### P0 — duplicate workspace race

Ten concurrent first `GET /api/business-teams/me` requests for one business account can all observe no row at `provisionWorkspace:181-184`, then each insert at `:192-195`. There is no conflicting unique key. Each transaction can commit a distinct team and Owner. Later resolution silently selects the oldest. This is a concrete database-integrity race.

### P0 — misleading partial ownership transfer

`POST /api/business-teams/transfer-ownership` promotes the target membership while immutable `business_id` and every domain controller continue to name the old account. A transferred Owner may believe they control the business, but the old account can still create/modify/charge business assets. A business-account target with its own team may not even resolve the transferred team. This is split authority, not ownership transfer.

### P1 — accepted workspace is inaccessible or ambiguous

`acceptInvite` can create multiple team memberships. `readWorkspaceContext ... LIMIT 1` exposes only one, and `BusinessTeamPanel` is nested only under the primary-business dashboard. A customer/expert/craftsman can accept successfully, click “Open Business Workspace,” and never see the team panel. A business user sees their own team first. The acceptance success claim is false for these concrete cases.

### P1 — registration continuation drops the token

The acceptance screen correctly places the invitation path in `next`. After registration or an unverified login, `auth-form.tsx:340-343` deliberately ignores it and routes to email verification. `verify-email-screen.tsx` then routes to onboarding/app without restoring `next`. The token remains unused in history and the user is stranded.

### P1 — seat-limit bypass

`createInvite` and `acceptInvite` never read plan `maxTeamSlots`. A team admin can add memberships beyond the purchased limit. Duplicate controls do not address quota.

### P1 — migration apply failure on baseline history

Baseline revoke wrote no `revoked_at`; the pending migration immediately validates equality between revoked status and non-null `revoked_at`. Any historical revoked row aborts the migration. Duplicate pending invitations and duplicate stored Owners create analogous failures. No preflight/backfill handles them.

### P2 — invitation token URL persistence

The raw bearer remains in the emailed URL, acceptance URL, nested auth `next` query, browser history, and subsequent navigation until replaced by another page. Application logs are tested clean, but upstream/browser/referrer exposure is not eliminated.

No horizontal role/member/invite IDOR, Owner assignment by Admin, wrong-account acceptance, token-in-database leak, or accept/revoke double-win was found in the traced implementation.

## 11. Test matrix and execution

### Required matrix

| Layer | Required coverage | Current status |
| --- | --- | --- |
| Unit | canonical email, masking, permission/tier mapping, safe-next exact allowlist, invite states, seat policy | Permission/invite mapping exists. Safe-next, registration continuation, URL scrubbing, seat policy missing. |
| API | every team route positive/negative, cross-workspace IDs, wrong account non-consumption, Owner protection, forged direct requests | Strong team-route coverage. Missing wrong-then-correct accept, seats, multi-workspace selection, platform primary-role mutation, and domain-spanning requests. |
| Real PostgreSQL | migration replay plus all invite/member/role/owner invariants | Authored in `business-teams.workspace.pg.test.ts`; 39 skipped here due no approved local PostgreSQL. |
| Concurrency | ten first accesses; ten accepts; accept-vs-revoke; ten transfers | Accept/revoke/transfer authored. Ten first accesses absent. None independently executed here. |
| Frontend contract | rendered signed-out/login/register/verify/accept states; token scrub; non-business workspace navigation; forged request response | API-client/presentation helpers tested. Full rendered journeys and non-business navigation absent. |

### High-value required tests

| Test | Status |
| --- | --- |
| Ten concurrent first access requests create one workspace | **Missing; implementation would fail.** |
| Ten concurrent accepts create one membership | Authored at PG `:754`; skipped here. |
| Accept versus revoke | Authored at PG `:792`; skipped here. |
| Ten concurrent transfers leave one Owner | Authored at PG `:1061`; skipped here, but does not make transfer semantically safe. |
| Transferred Owner domain capabilities | Missing. |
| Old owner domain capabilities after transfer | Missing. |
| Invited non-business member can open accepted workspace | Missing; frontend trace shows failure. |
| Custom permission affects one domain route or explicitly proves unavailability | Missing. |
| Removed member across team and domain endpoints | Team-only test at PG `:419`; domain portion missing. |
| Frontend-forged direct requests denied | Team-only PG `:439` and web `:473`; domain portion missing. |

### Commands run

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm run validate:i18n` | Pass |
| `npm run test` | Pass: shared 17; API 514 passed/240 skipped; web 217. Five API files, including PostgreSQL suites, skipped. |
| `npm run build -w @mohandishub/api` | Pass |
| `npm run build -w @mohandishub/web` | Pass |
| `node scripts/migration-dryrun.mjs` | Not executed against a DB: failed closed because `DATABASE_URL` is absent in this isolated worktree. |
| `node scripts/migration-replay-check.mjs` | Not executed against a DB: failed closed because `DATABASE_URL` is absent. |
| Business-team PG file with `RUN_PG_INTEGRATION=1` | One file/39 tests skipped: no approved local DB. |

The only discovered external `.env` points to a remote Supabase `postgres` database. It was deliberately not used. No PostgreSQL race claim is marked independently executed.

## 12. Migration verdict

**Blocker; changes required before application.**

Required changes:

1. Add a production-preflighted unique invariant for one `business_teams` row per `business_id`, and make `provisionWorkspace` conflict-safe/reselect the winner.
2. Add read-only preflight queries and an explicit data policy for duplicate teams, duplicate Owners, canonical duplicate pending invitations, cross-team role references, tier drift, revoked rows without timestamps, and acceptance-shape drift.
3. Backfill legitimate baseline revoked rows before validating the revoked-shape constraint, or add/validate the constraint in a staged safe order.
4. Decide whether accepted/revoked actor/member linkage is mandatory and enforce it if so.
5. Do not claim the database enforces “exactly one Owner.” It enforces only an upper bound. Add a coherent lower-bound strategy or document/API-test every owner-removing lifecycle, including account deletion/retention.
6. Expand replay/fingerprint validation to functions, triggers, comments, and a true pre-migration baseline; restore changed comments on rollback if exact restoration is required.
7. Run dry-run, replay, and every PG/race suite against an approved local or disposable database before merge.

## 13. Required fixes before merge

1. **P0:** keep ownership transfer endpoint/UI disabled, or explicitly rename it to team-administration transfer with narrow semantics. Do not ship it as business/workspace ownership.
2. **P0:** enforce one team per business and make concurrent provisioning idempotent; add the ten-request PG test.
3. **P0:** make migration `20260731120000` compatible with baseline revoked/duplicate/drift states and prove it on a sanitized production-shaped snapshot.
4. **P1:** stop advertising Wave 2G domain permissions as operative. Either hide/label them “planned” or implement the smallest safe workspace-principal slice below.
5. **P1:** add active workspace selection and a team-panel route available to invited users regardless of primary account role.
6. **P1:** preserve invitation continuation through registration and email verification, then scrub the raw token from the address bar after capturing it in memory/session-scoped storage.
7. **P1:** enforce `maxTeamSlots` transactionally across pending/accepted policy as product decides, with concurrent invite/accept tests.
8. **P1:** add the missing domain-negative tests, wrong-user-then-correct-user test, transfer capability tests, and removed-member domain test.
9. **P2:** guard platform primary-role/deactivation/deletion flows for the immutable original business principal; define recovery rather than leaving assets inaccessible.
10. **P2:** make audit retention/PII policy explicit and preserve the original offered-role snapshot when deleting a role.

## 14. Deferred architecture: smallest safe next phase

Do not rewrite ActivationGateService, MHC charging, wallets, or historical financial ownership. Introduce a narrow server-side workspace-principal resolution layer:

1. Add an explicit active `teamId` selected from the caller's current memberships; validate it server-side on every request. Do not infer one team with `LIMIT 1`.
2. Resolve `{ teamId, businessAccountId, memberId, tier, permissions }` in one shared middleware/service. Never accept `businessAccountId` from the client.
3. Pilot one non-financial domain, preferably catalogue/service drafting or read-only analytics. Translate an allowed workspace permission to the immutable `businessAccountId` only inside that domain service.
4. Keep charging, plans, wallet, MHC, payouts, and historical records on `businessAccountId`. Record the acting member separately for audit.
5. Prove same-workspace positive access, cross-workspace denial, removal revocation, custom-role limits, and original-account behavior before expanding to jobs/reservations.
6. Treat ownership of the financial/business principal as a later dedicated phase. Until then use “team administrator,” not “business Owner.”

## 15. Antigravity integration and shared-file risks

Highest-risk integration points:

- `apps/web/components/team/invitation-acceptance-screen.tsx`: query token, registration continuation, false success/open-workspace claim.
- `apps/web/components/auth/auth-form.tsx` and `verify-email-screen.tsx`: `next` is dropped for unverified users.
- `apps/web/components/app/business-team-panel.tsx`: fake operational permission labels and misleading ownership transfer copy.
- `apps/web/components/app/app-home-screen.tsx` and `business-dashboard.tsx`: team panel exists only under primary `business` role.
- `apps/web/lib/business-teams/client.ts` and `packages/shared/src/product-growth.ts`: contracts need active workspace identity if multi-membership is supported.
- `apps/api/src/modules/business-teams/business-teams.authorization.ts`: implicit one-workspace resolver.
- `apps/api/src/modules/business-teams/business-teams.service.ts`: provisioning race, seat enforcement, transfer semantics, role-history rewrite.
- `supabase/migrations/20260731120000_business_workspace_membership_invariants.sql`: missing team uniqueness, compatibility/backfill, lower Owner bound.
- services/jobs/analytics/advertisements/reservations/plans/mhc/wallet/profile controllers and services: keep under special review when workspace delegation begins; do not mass-replace `req.user.id` in financial paths.

## 16. Suggested final checklist for Claude's branch

- [ ] Ten first-access requests produce one `business_teams` row and one Owner, with all callers succeeding.
- [ ] Read-only production preflight reports no unhandled row that can break `20260731120000`.
- [ ] The migration is dry-run/replay clean on approved disposable PostgreSQL.
- [ ] Wrong-account acceptance does not consume the token; the intended account subsequently succeeds.
- [ ] Duplicate pending invite and membership invariants hold under concurrency and seat limits.
- [ ] Cross-workspace member/invite/role identifiers remain scoped in service and database.
- [ ] Owner cannot be assigned, removed, or demoted; zero-Owner lifecycle and account retention are addressed.
- [ ] Transfer endpoint is disabled or renamed until business-principal ownership exists.
- [ ] New Owner and old original account capability tests match product copy exactly.
- [ ] Non-business and multi-workspace users can select/open the accepted workspace.
- [ ] Registration/email verification preserves the invite and the browser URL is scrubbed.
- [ ] Every permission shown in UI is either enforced by a real domain route or clearly marked unavailable.
- [ ] Removed membership immediately fails team and any delegated domain authorization.
- [ ] Primary account role remains unchanged and admin mutation/deletion cannot orphan operations silently.
- [ ] Audit rows commit with mutations and preserve sufficient non-PII before/after history.
- [ ] `/api` contract, stable errors, frontend states, and generated/shared types remain aligned.

## 17. Final severity summary

### High / launch blockers

- Duplicate first-access workspace creation.
- Misleading, split-authority ownership transfer.
- Migration incompatibility and missing one-team invariant.
- Wave 2G domain permissions are advertised but not implemented.
- Accepted workspace is inaccessible/ambiguous for non-business and multi-workspace users.

### Medium

- Seat limits are unenforced.
- Registration/email-verification loses the invitation continuation.
- Raw token persists in query/history surfaces.
- Primary-role/deactivation lifecycle can strand original-account assets.
- Audit completeness/retention/PII and role-history fidelity remain incomplete.

### Fixed material risks

- Wrong-account acceptance.
- Cross-workspace scoping inside team administration.
- Token hashing and application-log redaction.
- Duplicate pending invitation and duplicate membership controls (subject to migration/data compatibility).
- Accept replay and accept-versus-revoke serialization.
- Owner assignment/removal/demotion through team APIs.
- Atomic mutation/audit writes.
- Stable invitation state/error contract and `/api` documentation.
