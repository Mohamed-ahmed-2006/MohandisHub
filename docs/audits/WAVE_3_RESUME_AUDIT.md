# MohandisHub Wave 3 Resume Audit

Audit date: 2026-08-06 (Africa/Cairo)

## 1. Executive Verdict

- **Current project phase:** Wave 3 product architecture is committed and pushed; Wave 3 implementation has not started.
- **Wave 2 status:** **NOT FULLY CLOSED.** The mainline contains the intended MHC, disclosure, advertisements, plans, teams, analytics, help-resolution, and wallet-route work, and the normal validation suite is green. However, three directly verified launch/security gaps remain: active Jobs EGP money paths, a reachable legacy EGP cash-wallet UI, and unsafe public-object deletion behavior for which an old local fix was never merged.
- **Wave 3 implementation status:** **NOT STARTED**, apart from inherited prerequisite security corrections to chat and public profiles. There is no Wave 3 identity/PCI/BCI schema, conversion service, Engagement spine, legacy-activation backfill, settlement model, or Wave 3 verification model.
- **Can development resume immediately?** Yes only on a focused Wave 2 closure/security branch. Do **not** start the Wave 3 schema until the three blockers in section 9 are corrected and revalidated.
- **Safest resume base:** clean `main` at `b27ef26e678689be2c4e1d44a3eb3f2e85d46d49` in `D:\Private Projects\MohandisHub-wave3-final`.

## 2. Repository and Worktree Inventory

The two paths are worktrees of the same Git repository, not independent repositories.

| Path                                          | Branch                                    | HEAD                                       | Upstream / remote state                                                             | Worktree state                                               | Identifiable purpose                                                                  |
| --------------------------------------------- | ----------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `D:\Private Projects\MohandisHub-wave3-final` | `main`                                    | `b27ef26e678689be2c4e1d44a3eb3f2e85d46d49` | `origin/main`, ahead 0 / behind 0; `git ls-remote` confirms the same remote hash    | Clean before this report; this report is the only new file   | Authoritative mainline / resume worktree                                              |
| `D:\Private Projects\MohandisHub`             | `docs/wave-3-architecture-reconciliation` | `057122864b09ec07407732d42971c71cb93fafc7` | No upstream; 4 commits unique to the branch and 3 commits behind `main` by topology | No tracked modifications; 3 untracked artifacts listed below | Earlier architecture-reconciliation worktree; dependency-equipped validation worktree |

Untracked artifacts in `D:\Private Projects\MohandisHub` were preserved exactly:

- `MHC-Claude-unfinished.patch` (85,810 bytes): touches nine Wave 2 MHC/admin/wallet files; the corresponding MHC functionality is present on current main and this is not Wave 3 work.
- `MohandisHub-final-test-backup-20260727-e8570b3.bundle`.
- `MohandisHub-final-test-backup-20260727-final.bundle`.

Relevant local-only or mis-tracked work:

- `docs/wave-3-architecture-reconciliation` contains `727977d`, `4ead3ba`, `3027ea2`, and `0571228`, none reachable from a remote ref. Its product corrections and public-profile fix were independently incorporated/superseded by `bad7d50`, `87c4aa6`, and `b27ef26` on main. **Do not merge this branch into main.** Preserve it until a final content comparison is accepted, then archive it through the normal Git workflow.
- `docs/wave-3-architecture-final` points at `b27ef26` and tracks `origin/main`; there is no remote branch with that name. The architecture itself is pushed through main.
- `release-audit-ui` is local-only and contains `bb4ce8d` (`fix: prevent cross-user public media deletion`) plus two older UI/audit commits. `bb4ce8d` is not in main and identifies a still-present security defect. Its patch should be reconciled with the current upload registry, not blindly cherry-picked.
- `audit/wave-2-visual-qa` has the unpushed documentation commit `6369493`; later main commits `5c49c4d` and `11ae5cf` implemented its follow-up work.
- `fix/wave-2gh-ui-scope` has local commit `b5e5e4f`, but main contains the equivalent later commit `f937a5c`; it is superseded.
- `polish/wave-2i-help-resolution-ui` tracks the wrong upstream (`origin/feat/wave-2i-backend-integration`) and reports ahead 1. Main contains the integrated/polished Wave 2I work; this is a tracking anomaly, not active Wave 3 implementation.
- Other old local-only release-audit commits predate the current integration history and are not a safe resume base.

The latest relevant commit date is 2026-08-02 21:45:30 +03:00 (`b27ef26`).

## 3. Verified Last Stable Point

There is **no commit that this audit can certify as a fully closed Wave 2 release**, because the Jobs money paths and cash-wallet UI are already present at the historically accepted Wave 2 checkpoint.

The verified reproducible resume base is:

- Branch: `main`.
- Commit: `b27ef26e678689be2c4e1d44a3eb3f2e85d46d49`.
- Remote: `origin/main` at the same hash (confirmed without updating local refs).
- Historical Wave 2 checkpoint: `11ae5cf64de2e0a47f2a453ab82ffe2de47cc70b` is an ancestor of main.
- Architecture checkpoint: `87c4aa62c6683064c420fe55862ad59dfd7ccc0d` exists, is an ancestor of main, and is followed by final architecture corrections in `b27ef26`.
- Production migration inventory: **103 SQL files, 103 unique versions, 0 duplicates, 0 invalid filenames**. The read-only migration listing reported **Applied 103, Pending 0**, with no repository/live-history drift warning.

Use `b27ef26` as the base because it contains both post-Wave-2 disclosure hotfixes and the final Wave 3 architecture. Treat it as the safest resume point, not as proof that Wave 2 is closed.

## 4. Work Completed

### Wave 2 completed work

The following is present in code and covered by passing tests unless a qualification is stated:

- Provider MHC credit wallet, purchase flows, action pricing, idempotent charge/refund primitives, and the provider-facing Credits UI.
- MHC activation for awarded Needs and reservations, with atomic debit/activation behavior and a pre-activation disclosure gate.
- Provider payment-method management and audited disclosure only to the customer after the specific award activation (`ProviderPaymentsService.discloseForAward`).
- Deposit and withdrawal HTTP routes fenced fail-closed with `410`; service-level guards prevent bypass through the wallet service. Read-only financial history remains available.
- Credits and Analytics API authorization for Expert, Craftsman, and Business roles; Business Analytics uses the provider analytics path.
- Advertisements migrated to the MHC charge primitive, weekly billing and renewal implemented, current action price active at zero.
- Plans migrated to scoped per-plan MHC pricing; the global pause is false, while `is_purchasable` plus an active scoped price and eligibility form the fail-closed sale boundary.
- Business team administration with only `manage_team` effective; six commercial permissions remain reserved and ownership transfer is unavailable.
- Unified Help & Resolution Center.
- Chat conversation-summary/contact masking hotfix `bc1681b` and its HTTP/socket/client/shared regression tests.
- Public profile allowlist hotfix `bad7d50`, covering Business external links, Expert external URLs, Craftsman exact address/coordinates, defensive browser filtering, and preservation of private owner fields.
- Current migrations are internally unique and fully applied according to the read-only listing.

### Wave 3 documentation completed work

- All 20 expected files under `docs/architecture/wave-3/` exist on main.
- `87c4aa6` introduced the full architecture set; `b27ef26` applied the final repository-disposition corrections.
- The documents preserve all approved decisions: admin/support-only PCI conversion, audited one-time MHC carryover, Jobs as a separate recruitment subsystem, owner-only Business commercial authority, off-platform provider payment, and no EGP wallet/escrow revival.
- Committed-blob Prettier verification passed for all 20 documents.
- Automated relative-link inspection found 0 broken links.
- No unresolved marketplace product decision remains in the document set.

### Wave 3 implementation completed work

None. The chat and public-profile fixes are inherited security prerequisites, not implementation of the Wave 3 identity, Engagement, settlement, or conversion architecture.

## 5. Partial or Unfinished Work

| Branch / commit                                                             | Files / area                                                              | Status                                                                                          | Risk                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release-audit-ui` / `bb4ce8d`                                              | `moderation.service.ts`, `retention.service.ts`, a deletion-safety test   | Unmerged security fix for deletion of public storage objects referenced by user-controlled URLs | High. Main still resolves and deletes an object from the URL alone. The old patch disables physical public deletion entirely and may need adaptation to the later upload registry. |
| `docs/wave-3-architecture-reconciliation` / `727977d`, `4ead3ba`, `0571228` | 19 Wave 3 documents                                                       | Unpushed earlier corrections; superseded by main's rebuilt/final documents                      | High merge-conflict and regression risk. Do not merge; compare only if historical provenance is needed.                                                                            |
| `audit/wave-2-visual-qa` / `6369493`                                        | Historical audit document                                                 | Audit commit unpushed; implementation follow-ups are on main                                    | Low implementation value; documentation-only residue.                                                                                                                              |
| `MHC-Claude-unfinished.patch`                                               | Nine MHC/admin/wallet files                                               | Untracked pre-integration patch artifact                                                        | High if applied: current main already contains evolved implementations. Preserve as evidence only.                                                                                 |
| Jobs EGP code on main                                                       | `JobsService`, `JobsRepository`, Jobs tests and routes                    | Implemented and tested legacy behavior, but contrary to the retired-money launch contract       | Critical product/money risk if any money wallet becomes funded/unfrozen.                                                                                                           |
| Wallet settings UI on main                                                  | `profile-screen.tsx`, `app-avatar-menu.tsx`, `wallet-settings-screen.tsx` | MHC UI is present, but the legacy EGP cash surface remains reachable                            | High product-truth risk and an explicit Wave 2 acceptance gap.                                                                                                                     |

## 6. Work Not Started

Confirmed missing Wave 3 areas:

- Personal Commercial Identity and distinct Business Commercial Identity schema.
- Server-side acting-context model and self-dealing checks.
- V0/V1/V2/V3a/V3b verification records, expiry, category credentials, and authorization migration away from `platform_verified_at`.
- Admin/support PCI conversion, source archival, replacement creation, audited MHC carryover, cooldown, notification, idempotency, and concurrency controls.
- Additive BCI compatibility mapping and commercial-asset ownership migration.
- Generic pre-activation intent model and Engagement spine.
- Legacy `mhc_job_activations` to Engagement backfill, quarantine, dual-read, and reconciliation.
- Typed fulfillment components and hybrid composition.
- Off-platform settlement evidence/confirmation/verification model and verified-GMV shadow calculations.
- Engagement-scoped reviews/reputation and commercial-identity enforcement.
- PCI/BCI advertisement ownership migration.
- Required Wave 3 test groups B through H. Group A public-profile tests are already present as a prerequisite.

## 7. Documentation-versus-Code Contradictions

1. **Jobs money must be disabled, but active code and tests preserve it.** `docs/architecture/wave-3/16-wave-3-scope.md` lines 75-84 require Jobs to remain separate and all application-fee, escrow, commission, payout, and wallet movement paths disabled/read-only. `apps/api/src/modules/jobs/jobs.service.ts` lines 190-278 debits paid applications and distributes payout/commission; lines 698-794 fund milestones with EGP holds; lines 877-1004 capture holds and credit payout/commission. `apps/api/src/tests/jobs.service.test.ts` lines 149-280 and 365-574 positively assert these money flows. The Jobs routes expose these methods. Migration-time freezing is not a durable fence because new `money` wallets inherit `is_frozen = false` from the base schema.

2. **The UI claims no provider cash balance, but renders one.** `docs/architecture/wave-3/13-mhc-activation.md` lines 21-26 and `16-wave-3-scope.md` prohibit provider cash balances/withdrawal surfaces. `apps/web/components/profile/profile-screen.tsx` lines 904-934 gives providers a `Cash Balance (EGP)` subtab backed by `WalletSettingsScreen`. The same file accepts `?tab=wallet` and wallet hashes at lines 945-979 and renders the wallet tab at line 1665 even when the tab is absent from the visible-section list. `apps/web/components/app/app-avatar-menu.tsx` lines 103-108 links every role to that path. Thus customers can deep-link into the retired wallet renderer and providers can explicitly switch to the cash view.

3. **`platform_verified_at` is documented as display-only, but still drives trust/search behavior.** `docs/architecture/wave-3/00-overview-and-terminology.md` lines 761-827 and `16-wave-3-scope.md` lines 91-102 require migration away from the legacy badge. Current `ProfilesService` still computes it from profile completion plus 1,000 EGP deposit history and writes it (`profiles.service.ts` lines 86-96, 189-199, 368-378). `ServicesRepository` uses it for `verifiedOnly` filtering and emits `provider_verified` (`services.repository.ts` lines 141-176 and 205-208). This is a documented Wave 3 migration requirement, not an architecture-document error, but it proves implementation has not started.

4. **Public storage deletion has an unmerged ownership-safety correction.** Main's `moderation.service.ts` lines 14-30 and `retention.service.ts` lines 27-47 delete a local/Supabase public object solely by parsing a URL stored on a Need/message/service. The local-only `bb4ce8d` removes physical deletion from these user-controlled references and adds a regression test. Current main has no corresponding safety test. This contradicts the expected security closure, though it is not explicitly described by the Wave 3 product documents.

Items that do match code: Jobs remains structurally separate from Needs/Engagements; Business commercial actions remain account-principal controlled; `manage_team` is the only effective delegated permission; public profile/contact disclosure corrections are implemented; advertisements and plans match the final documented baseline.

## 8. Validation Results

| Command / check                                                          | Result                                                                                                                    | Classification                                                                                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `git ls-remote --heads origin` plus local ancestry/ahead-behind checks   | Pass; remote main is `b27ef26`, local main +0/-0                                                                          | Pass                                                                                                                          |
| Wave 3 relative Markdown link scan                                       | 20 files, 0 broken relative links                                                                                         | Pass                                                                                                                          |
| Repository `npm run format:check` in the clean main worktree             | Could not resolve `prettier` because that worktree has no `node_modules`                                                  | Configuration issue                                                                                                           |
| Direct Prettier worktree check using the sibling dependency installation | Failed on 727 files because global Git `core.autocrlf=true` checked LF blobs out as CRLF                                  | Environment issue, not a committed-format defect                                                                              |
| Prettier check of the 20 committed Wave 3 blobs from `main`              | 20/20 pass                                                                                                                | Pass                                                                                                                          |
| `npm run typecheck`                                                      | Pass: shared, API, and web                                                                                                | Pass                                                                                                                          |
| `npm run lint`                                                           | Pass on the second bounded run; first run hit the 60-second tool timeout                                                  | Pass; first result was an execution timeout                                                                                   |
| `npm run validate:i18n`                                                  | Pass                                                                                                                      | Pass                                                                                                                          |
| `npm test`                                                               | Pass: shared 20, API 537, web 312 = **869 passed**; API 309 tests in 7 PostgreSQL suites skipped by opt-in configuration  | Pass with integration coverage unavailable by configuration/safety policy                                                     |
| `npm run build`                                                          | Pass: shared, API, and Next production build                                                                              | Pass; non-blocking warnings: build command disables embedded lint (separate lint passed), browserslist data is six months old |
| Static migration inventory                                               | 103 SQL files, 103 unique versions, 0 duplicate or invalid versions                                                       | Pass                                                                                                                          |
| `node scripts/migration-dryrun.mjs --list`                               | Repo 103, applied 103, pending 0; no drift warning                                                                        | Pass, read-only                                                                                                               |
| Migration replay / destructive PostgreSQL integration                    | Not run because these create and drop scratch databases; prohibited by this audit's strict safety rules                   | Not run by safety policy                                                                                                      |
| External staging E2E                                                     | Not rerun; it is not required to establish repository state and the historical target returned 404 before app tests began | Historical environment issue; not a current code verdict                                                                      |

The green unit suite does not invalidate the three blockers: the wallet authorization test checks the shared `isProviderRole` helper rather than the direct settings route; Jobs tests assert the obsolete money behavior; and main has no public-media deletion ownership regression test.

## 9. Real Blockers

Only these block the next Wave 3 implementation step:

1. **Fence Jobs money paths at both route/service boundaries.** Preserve vacancy/application/interview/hire behavior and historical money records, but make application fees, milestone funding, escrow, commission, payout, and wallet mutations fail closed or become read-only. Add regression tests proving no wallet read/write for each forbidden path.
2. **Remove every legacy EGP wallet/cash surface from non-admin product UI.** Replace provider wallet settings with MHC/payment-method content only; prevent query/hash deep links from rendering a hidden section; keep historical ledger access only where explicitly approved.
3. **Resolve the public-media deletion ownership defect.** Reconcile `bb4ce8d` with the current `upload_object_registry`. Physical deletion must require a server-owned registry record and ownership/reference safety, or remain metadata-only. Add the missing cross-user regression test.

No migration-count, architecture-decision, chat-disclosure, public-profile, typecheck, lint, unit-test, or build blocker was found.

## 10. Recommended Resume Point

- **Repository:** `D:\Private Projects\MohandisHub-wave3-final`.
- **Base branch:** `main`.
- **Base commit:** `b27ef26e678689be2c4e1d44a3eb3f2e85d46d49`.
- **Working branch:** create a new `codex/`-prefixed Wave 2 closure/security branch from that exact commit; do not merge the reconciliation worktree.
- **Required preliminary corrections:** the three blockers in section 9, in this order: public-media deletion safety, Jobs money fencing, retired wallet UI removal. Re-run typecheck, lint, i18n, all normal tests, builds, targeted regression tests, and the read-only migration list.
- **Architecture corrections before implementation:** none required. The product architecture is ready. The implementation task must translate it into a technical schema/API design without reopening approved decisions.
- **Exact next task:** implement and test the three-part Wave 2 closure/security patch above. Only after that branch is reviewed and merged should the first Wave 3 BCI slice begin.

## 11. First Wave 3 Vertical Slice

**Objective:** introduce the additive Business Commercial Identity compatibility spine without changing existing commercial behavior or re-keying historical assets.

**Backend scope:**

- Define the BCI persistence model and deterministic mapping from each legacy Business account to exactly one initial BCI.
- Add an owner/controller relation and a server-side resolver from the authenticated user plus requested business context to the BCI.
- Keep `business_teams.business_id`, workspace IDs, memberships, invitations, roles, and audit rows unchanged as compatibility anchors.
- Add read compatibility so existing Business profile/team/assets remain available through the mapped BCI.
- Keep every commercial write owner/account-principal controlled. No team permission may authorize a commercial action.
- Add audit output for backfill/mapping creation and reconciliation, without creating a general ownership-transfer mechanism.

**Frontend scope:** none for the first migration slice beyond preserving existing Business screens. Do not add a context switcher or delegated commercial controls until the server-side model and multi-BCI tests are proven.

**Migrations:** one additive, idempotent migration set for BCI entity, owner/controller relation, and legacy mapping/compatibility references. It must preflight ambiguous data, preserve all IDs/history, create no duplicate mapping on retry, and have a non-destructive rollback plan. Do not re-key assets in place.

**Authorization requirements:** authenticated owner only; no `manage_services`, `manage_jobs`, `manage_reservations`, `manage_wallet`, `manage_support`, or `view_analytics` delegation; no ownership transfer; no delegated MHC spending.

**Audit requirements:** actor, initial controlling user, legacy Business account, resulting BCI, deterministic idempotency key/version, timestamp, and reconciliation outcome. Existing business-team audit history remains untouched.

**Tests:** architecture group B1-B5 in `16-wave-3-scope.md`, plus migration retry/concurrency, ambiguous-data fail-closed, authorization-negative tests for all team tiers, no asset mixing across two BCIs, and proof that existing profile/team/assets remain readable throughout.

**Explicit exclusions:** PCI conversion, MHC carryover, Engagements, Needs/Offers redesign, Jobs migration, delegated authority, ownership transfer, workspace-owned assets, delegated MHC spending, advertisement ownership migration, settlement, reviews, and frontend context switching.

## 12. Recommended Agent Assignment

- **Agent:** Codex.
- **Thinking level:** High.
- **Assignment:** first execute the three-part Wave 2 closure/security patch from section 9; after review/merge, execute the BCI compatibility slice.
- **Reason:** both tasks cross security boundaries, legacy money behavior, migration safety, authorization, and regression-test design. They require direct repository work and careful reconciliation of an unmerged historical fix with the current schema; High reasoning is appropriate and sufficient.
