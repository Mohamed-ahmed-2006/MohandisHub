# Wave 2 Closure and Security Report

## 1. Executive Verdict

**WAVE 2 CLOSED**

The three confirmed release blockers are closed on `codex/wave2-closure-security`:
Jobs no longer performs legacy EGP financial mutations, the Cash Balance interface is
unreachable, and public-media deletion is bound to an authenticated actor plus a trusted
database object record. Wave 3 implementation was not started.

## 2. Base State

- Base commit: `b27ef26e678689be2c4e1d44a3eb3f2e85d46d49`
- Branch: `codex/wave2-closure-security`
- Worktree: `D:\Private Projects\MohandisHub-wave3-final`
- Resume audit: [`WAVE_3_RESUME_AUDIT.md`](./WAVE_3_RESUME_AUDIT.md)
- Base verification: local `main`, `origin/main`, and the configured remote main all resolved
  to the base commit before the branch was created.

## 3. Jobs Legacy EGP Closure

### Old behavior and reachability

| Trigger            | Endpoint                                        | Service path                  | Old financial mutation                                                    | Resulting state/UI                          |
| ------------------ | ----------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------- | ------------------------------------------- |
| Create hiring post | `POST /api/jobs`                                | `JobsService.createJob`       | Persisted an active application fee                                       | Fee shown on Jobs forms/cards               |
| Apply              | `POST /api/jobs/:id/apply`                      | `JobsService.applyForJob`     | Required wallet, debited applicant, credited Business/platform commission | Paid application and EGP balance dependency |
| Create milestone   | `POST /api/jobs/applications/:appId/milestones` | `JobsService.createMilestone` | Created wallet hold/escrow and calculated commission/payout               | Funded milestone UI                         |
| Review milestone   | `POST /api/jobs/milestones/:milestoneId/review` | `JobsService.reviewMilestone` | Captured hold, credited provider payout and platform commission           | Settled milestone UI                        |
| Close job          | `POST /api/jobs/:id/close`                      | `JobsService.closeJob`        | Released refundable holds                                                 | Refunded financial state                    |

The reachable surface included the API service and controller, shared DTOs, repository-backed
historical fields, Business and Expert Jobs screens, milestone/application components,
notifications, translations, and positive tests of the old money flow.

### Changes made

- New jobs and applications store zero in all retained financial columns. Historical fee values
  on an existing job are never reused by a new application.
- Applying has no wallet lookup, balance gate, debit, credit, escrow, payout, or commission call.
- Creating/reviewing milestones and closing jobs only changes recruitment/milestone state; it
  never creates, captures, or releases a wallet hold.
- Accept, reject, interview, hire, and ordinary applicant state transitions remain operational.
- EGP fee, payout, escrow, and commission controls/copy were removed from Jobs UI and
  notifications. No MHC Jobs charge was introduced.
- Jobs remains an independent recruitment domain. No Engagement is created or referenced by a
  Jobs action.

### Retained historical behavior

No production migration, table, or column was dropped. Existing financial fields remain
readable as historical/audit data, while all new action paths write zero or ignore them.

### Regression coverage

`jobs-finance-retirement.test.ts` and the updated `jobs.service.test.ts` cover wallet-free
applications, absence of debit/escrow/payout/commission calls, zeroed historical fields,
non-financial milestone review and close, recruitment transitions, and the Jobs/Engagement
boundary.

## 4. Cash Balance UI Retirement

### Old reachable surfaces

- Avatar-menu link to `?tab=wallet`
- Profile/settings Wallet section and provider Cash Balance subtab
- Query-string and hash deep-link parsing that rendered the wallet even when hidden from the
  visible section list
- `/app/settings/wallet` redirect into the legacy wallet tab
- Sidebar wallet-notification routing
- Customer-dashboard wallet balance precheck and accepted-bid payment control

### Selected retirement behavior

The established safe settings route is used: `/{locale}/app/settings/wallet` redirects every
role to `/{locale}/app/settings`. This does not send Customer or Business accounts to the
provider-only Credits page. `/{locale}/app/credits` remains guarded for providers as before.

All navigation, deep-link parsing, profile rendering, wallet notification routing, deposit/
withdraw access, and the customer payment control were removed. The old screen source is retained
only as unreachable historical code; it has no route or importer.

### Regression coverage

`legacy-cash-balance-retirement.test.ts` and `profile-screen-sections.test.ts` verify every
supported role has no Cash Balance navigation, safe role-independent deep links, absent deposit/
withdraw/payment controls, no legacy route invocations, and preservation of provider-only MHC
Credits behavior.

## 5. Storage-Deletion Security

### Original vulnerability

Moderation and retention paths parsed a database-stored but originally user-controlled public
URL into a bucket/object path and deleted that object without proving that a trusted upload record
belonged to the resource owner. A crafted same-format URL could therefore select another object.

### `release-audit-ui` inspection

Commit `bb4ce8dfffadfccd0a16a411ba8352cb888cc05d` was inspected. It disabled physical public
deletion in moderation/retention and added a source regression test, but did not preserve the
required legitimate owner/admin deletion flow. It was not merged or cherry-picked, and no
unrelated branch changes were imported.

### Final ownership model

- Public uploads are registered in the existing `upload_objects` registry with authenticated
  owner, canonical bucket, flat server-generated object key, MIME type, size, and SHA-256.
- Deletion accepts a trusted upload ID or uses a URL only to locate an exact active registry row;
  storage is called exclusively with bucket/key values from the claimed database row.
- The server rechecks actor ownership or existing `manage_media` administrator permission,
  expected resource owner, public visibility, active state, exact bucket, exact key, and the
  parent-resource relationship.
- Claiming is transactional with a row lock and `storage_deletion_jobs` state. Success marks the
  object deleted; a storage failure returns it to active and records a retryable failure.
- Untrusted legacy references may be cleared from a parent record, but never cause physical
  storage deletion.

Tests cover owner success, cross-user denial, external origin, wrong bucket, changed or missing
object key, missing trusted record, query modification, traversal, encoded and double-encoded
traversal, owner mismatch, authorized administrator behavior, storage failure handling, and proof
that no storage deletion occurs after failed authorization.

## 6. Files and Migrations Changed

- `apps/api/src/modules/jobs/jobs.service.ts` — removes all active Jobs wallet, fee, hold,
  payout, and commission mutations while retaining recruitment transactions.
- `apps/api/src/modules/jobs/jobs.controller.ts`, `packages/shared/src/jobs.ts` — treats legacy
  money inputs as optional, ignored compatibility fields.
- `apps/api/src/tests/jobs.service.test.ts`, `jobs-finance-retirement.test.ts` — Jobs closure and
  recruitment regressions.
- `apps/web/components/app/business-jobs-tab.tsx`, `expert-jobs-tab.tsx`, and
  `components/app/jobs/*` — removes Jobs financial inputs and summaries.
- `apps/web/lib/i18n/dictionaries/{en,ar}.ts`, `components/app/jobs/jobs-copy.ts` — removes
  retired Jobs financial copy.
- `apps/web/app/[locale]/app/settings/wallet/page.tsx` — safe settings redirect.
- `apps/web/components/profile/profile-screen.tsx`, `profile-screen-sections.ts` — removes wallet
  rendering and deep-link handling.
- `apps/web/components/app/app-avatar-menu.tsx`, `app-sidebar.tsx`, `customer-dashboard.tsx` —
  removes legacy navigation and action entry points.
- `apps/web/tests/legacy-cash-balance-retirement.test.ts`,
  `profile-screen-sections.test.ts` — route/navigation/action regressions.
- `apps/api/src/modules/upload/public-upload.repository.ts` — trusted registry and transactional
  deletion-claim persistence.
- `apps/api/src/modules/upload/public-upload-deletion.service.ts` — ownership, bucket, key, URL,
  namespace, and state enforcement.
- `apps/api/src/modules/upload/upload.routes.ts`, `apps/web/lib/upload/client.ts` — registers new
  public uploads and deletes them by trusted ID.
- `apps/api/src/lib/supabase-storage.ts` — canonical flat public keys.
- `apps/api/src/modules/moderation/moderation.service.ts`,
  `retention/{retention.repository.ts,retention.service.ts}`, and
  `media/{media.repository.ts,media.routes.ts}` — parent-owner-aware deletion integration.
- `apps/api/src/tests/public-upload-deletion.service.test.ts` — attack and authorization
  regression suite.
- `docs/audits/WAVE_3_RESUME_AUDIT.md` — preserved prerequisite audit evidence.
- `docs/audits/WAVE_2_CLOSURE_SECURITY_REPORT.md` — this closure record.

**Migrations changed: none.** The existing 103 migration files are untouched; the existing
`20260727090000_upload_object_registry.sql` provides the registry and deletion-job schema.

## 7. Validation

| Command                                                                | Result                         | Count/details                                                                               | Failure classification                                                                                                              |
| ---------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Targeted API Vitest: Jobs and public-upload deletion suites            | Passed                         | 52 passed                                                                                   | None                                                                                                                                |
| Final targeted Web Vitest: Cash Balance/profile suites                 | Passed                         | 14 passed after the final bounded UI removal; the broader targeted run also passed 24 tests | None                                                                                                                                |
| `npm test`                                                             | Passed                         | 895 passed: shared 20, API 555, Web 320; previous baseline 869, net +26                     | None                                                                                                                                |
| Existing opt-in PostgreSQL integration files under `npm test`          | Skipped by existing test gates | 309 skipped tests in 7 files, disclosed by Vitest                                           | Environment/policy: the harness requires a configured scratch database and performs create/drop operations prohibited for this task |
| `npm run typecheck`                                                    | Passed                         | Shared, API, Web; Next route types generated                                                | None                                                                                                                                |
| `npm run lint`                                                         | Passed                         | API and Web, zero warnings                                                                  | None                                                                                                                                |
| `npm run validate:i18n`                                                | Passed                         | EN/AR parity and validation                                                                 | None                                                                                                                                |
| `npm run build`                                                        | Passed                         | Shared/API TypeScript builds and optimized Next production build                            | None                                                                                                                                |
| `npm run format:check`                                                 | Failed outside the branch diff | 700 repository files reported because this Windows checkout is CRLF-normalized              | Environment/pre-existing formatting baseline; no files were rewritten                                                               |
| Prettier check limited to every changed/new TS, TSX, and Markdown file | Passed                         | All matched changed files                                                                   | None                                                                                                                                |
| `git diff --check`                                                     | Passed                         | No whitespace errors                                                                        | None                                                                                                                                |
| `node scripts/migration-dryrun.mjs --list`                             | Not run against a database     | Script stopped before connection: `DATABASE_URL is not set`                                 | Missing secret/environment; no credential was invented and no database was touched                                                  |
| Migration/schema review                                                | Passed statically              | 103 migration files; zero modified/added migrations                                         | None                                                                                                                                |

The executed test count increased from 869 to 895. No lower-count exception was taken and no
skip was hidden.

## 8. Git State

- Branch: `codex/wave2-closure-security`
- Code commits:
  - `8944319dece43fbf5431a3fff94f738ecc67856d` — `fix/jobs: retire legacy EGP financial paths`
  - `fad6534d54931bb6df438301c32e25672d908f7b` — `fix/web: retire reachable Cash Balance UI`
  - `2441c15ddbcb2dd3bc87b4ff8ac64c8d9cc4554a` — `fix/storage: enforce ownership-safe media deletion`
- Audit evidence/report: committed in the branch tip containing this file.
- Remote branch: `origin/codex/wave2-closure-security`
- Expected final worktree state after push: clean.
- Preserved outside the authoritative worktree, unchanged:
  - `D:\Private Projects\MohandisHub\MHC-Claude-unfinished.patch`
  - `D:\Private Projects\MohandisHub\MohandisHub-final-test-backup-20260727-e8570b3.bundle`
  - `D:\Private Projects\MohandisHub\MohandisHub-final-test-backup-20260727-final.bundle`
- The superseded architecture branch and `release-audit-ui` remain unmerged and unmodified.

## 9. Remaining Risks

- The 309 opt-in PostgreSQL integration tests were not executed because no scratch database was
  configured and their create/drop behavior was outside the task's database safety boundary.
- Public objects uploaded before registry enforcement cannot be physically deleted by the secure
  flow unless a trusted owner-preserving registry backfill is performed. Their application
  references can still be retired without risking cross-user deletion.
- Historical Jobs financial columns and the unimported wallet-screen source remain for audit/
  compatibility purposes. Regression tests fence both from active behavior.

None of these is a remaining instance of the three confirmed active blockers.

## 10. Wave 3 Entry Decision

It is safe to begin the additive BCI compatibility slice **after this closure branch is reviewed
and merged**. Do not start from unpatched `b27ef26`.

- Exact validated closure code base: `2441c15ddbcb2dd3bc87b4ff8ac64c8d9cc4554a`
- Recommended next branch after closure merge: `codex/wave3-bci-compatibility`
- Controlling architecture: [`16-wave-3-scope.md`](../architecture/wave-3/16-wave-3-scope.md),
  especially the additive BCI model and B1-B5 compatibility requirements, with
  [`README.md`](../architecture/wave-3/README.md) as the document-set index.
- Known dependencies: additive/idempotent BCI persistence, deterministic one-initial-BCI mapping,
  owner/controller authorization, legacy Business read compatibility, ambiguous-data fail-closed
  behavior, migration retry/concurrency coverage, and strict no-asset-mixing tests.

No BCI, PCI conversion, Engagement spine, settlement, or other Wave 3 implementation is included
in this branch.
