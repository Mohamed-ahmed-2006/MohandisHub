# Final Pre-Tester Audit

Date: 2026-07-04

Scope: repo-only audit of `mohandishub.app` before external tester access. I did not modify application code, database schema, deployment config, or real environment files. Local real env files exist but were not read.

## Executive Summary

The project is structurally close to tester-ready: lint, typecheck, unit tests, and formatting checks pass, and the backend has meaningful server-side auth, rate limiting, admin permission checks, webhook verification, and storage safeguards.

The release should not be sent to external testers yet because the repository contains two security/privacy hygiene risks: previously committed Stripe test credentials that still need provider-side rotation, and tracked upload files under `apps/api/uploads/private`. These should be cleaned up before sharing the repo or onboarding outside testers.

After the two P0 items and the two P1 items below are fixed or explicitly scoped out of the tester plan, the app looks suitable for a focused external test round.

## Severity Counts

- P0: 2
- P1: 2
- P2: 5
- P3: 1

## Recommended Fix Before Testers

1. `P0-SEC-001`: Rotate/revoke the previously committed Stripe test credentials; the working-tree docs are now redacted.
2. `P0-SEC-002`: Audit and remove tracked upload/private-upload files from git if they are not intentional public fixtures; add ignore rules.
3. `P1-REL-001`: Fix the corrupted Arabic fallback strings that make `npm run validate:i18n` fail.
4. `P1-DATA-001`: Disable or harden admin primary-role edits before admin testers use user management.
5. Complete the manual dashboard checklist in `SERVICES_AND_DEPLOYMENT_INVENTORY.md`.

## Recommended Leave Until After Testers

1. `P2-API-001`: Replace/remove legacy seeded `/api/users` endpoints if API testing is in scope.
2. `P2-DB-001`: Fix missing `supabase/seed.sql` for local database resets.
3. `P2-FE-001`: Remove private-image preview debug logging.
4. `P2-UX-001`: Decide whether `/app/browse` should stay hidden or show a non-placeholder route.
5. `P2-UX-002`: Keep business company-document upload out of tester scripts or implement it later.
6. `P3-REL-001`: Clean corrupted console symbols in `scripts/ship.mjs`.

## Final Verdict

`NOT_READY_SECURITY_RISK`

Reason: the app itself is close, but the repo should not be shared externally until committed credential-like values and tracked private uploads are handled.

## Project Understanding

### Tech Stack

- Monorepo: npm workspaces.
- Frontend: Next.js 15 App Router, React 19, TypeScript, Tailwind, SWR, Socket.io client, Agora RTC SDK, Vercel Speed Insights.
- Backend/API: Express, TypeScript, Socket.io, PostgreSQL via `pg`, Zod validation, JWT access tokens, rotating refresh-token cookie, bcrypt, multer uploads, Helmet, CORS, express-rate-limit.
- Shared package: `packages/shared` with shared types/schemas.
- E2E: Playwright workspace under `apps/e2e`.

### Backend, Database, Auth, Email, Storage, Deploy

- Database: PostgreSQL/Supabase schema and migrations under `supabase/migrations`; API connects through `DATABASE_URL`.
- Auth: custom email/password auth, JWT access token in frontend memory, HTTP-only refresh cookie `rid`, session hint cookie `mohandishub-session` for Next middleware redirects.
- Email: Resend is the production email provider when `OTP_EMAIL_PROVIDER=resend`; console provider is used for development. Brevo remains optional legacy code.
- Storage: Supabase Storage for production uploads; local disk fallback exists for non-production.
- Deployment: Render API and worker in `render.yaml`; Vercel web config in `apps/web/vercel.json`; GitHub Actions CI/staging workflow in `.github/workflows/ci.yml`.

### Important App Flows Detected

- Public/auth flows: landing, locale redirect, login/register, forgot password, reset password, verify email, terms, privacy.
- Onboarding flows: role selection, customer, expert, craftsman, business.
- Protected app flows: dashboard, bookings, disputes, services, negotiations, advertisements, calendar, chat, history, support, plans, profile, settings, wallet settings, projects, admin, browse placeholder.
- API modules: auth, OTP, users, profiles, recommendations, admin, analytics, ads, support, services, wallet, chat, coupons, favorites, verification, upload, plans, negotiations, needs/bids, reservations, reviews, saved searches, jobs, notifications, geo, media, app status, operations backup/restore.

### Docs, Config, and Integration Files Detected

- Root/package: `package.json`, `package-lock.json`, `.npmrc`, `README.md`, `render.yaml`.
- Web: `apps/web/package.json`, `apps/web/vercel.json`, `apps/web/.env.example`, `apps/web/next.config.ts`.
- API: `apps/api/package.json`, `apps/api/.env.example`, API config under `apps/api/src/config`.
- E2E: `apps/e2e/package.json`, `apps/e2e/.env.example`.
- Supabase: `supabase/config.toml`, `supabase/migrations/*`.
- CI/deploy docs: `docs/DEPLOYMENT_RUNBOOK.md`, `docs/PRODUCTION_RUNBOOK.md`, `docs/NOWPAYMENTS_RUNBOOK.md`, `docs/OTP_EMAIL_RUNBOOK.md`, `docs/KYC_RUNBOOK.md`, `docs/PRODUCTION_QA_CHECKLIST.md`, `.github/workflows/ci.yml`.

## Findings

### P0-SEC-001 - Previously Committed Stripe Test Credentials Need Rotation

Severity: P0

Location/file path:

- `apps/api/docs/STRIPE.md:36`
- `apps/api/docs/STRIPE.md:37`
- `apps/api/docs/STRIPE.md:38`
- `apps/api/docs/STRIPE.md:139`
- `apps/api/docs/STRIPE.md:164`

What is wrong:

- The Stripe documentation previously contained actual-looking Stripe test credentials and webhook secrets. The working tree now uses redacted placeholders, but any exposed values still need dashboard rotation/revocation and may remain in git history.

Why it matters:

- Test credentials can still be abused, confused with active sandbox setup, or used to spoof test webhooks. More importantly, this normalizes committed secrets and creates git-history cleanup risk before sharing the repo externally.

How to reproduce or verify:

- Confirm `apps/api/docs/STRIPE.md` now contains redacted placeholders only.
- Rotate/revoke the previously exposed test secret key and webhook secret in Stripe.

Suggested fix:

- Rotate/revoke the affected Stripe test secret key and webhook secret in Stripe.
- Keep all concrete keys out of `apps/api/docs/STRIPE.md`.
- If the repo has already been shared outside the trusted team, consider a git-history cleanup for those values.

Fix size/risk:

- App code fix is safe/small.
- Credential rotation is manual but required.
- Git-history purge is riskier and only needed if the repo has already been broadly shared.

Fix timing:

- Fix before testers.

### P0-SEC-002 - Tracked Private Upload Files In Repository

Severity: P0

Location/file path:

- `apps/api/uploads/private/*`
- `apps/api/uploads/*`
- `.gitignore:1-10`

What is wrong:

- `git ls-files apps/api/uploads apps/api/uploads/private` shows public and private upload artifacts tracked by git.
- `.gitignore` ignores env/build artifacts but does not ignore `apps/api/uploads` or `uploads`.

Why it matters:

- Files under `uploads/private` are likely verification documents, CVs, money proofs, or tester/user-generated files. Even if they are samples, the path and handling imply private data. External testers or collaborators should not receive accidental private uploads in the repo.

How to reproduce or verify:

- Run `git ls-files apps/api/uploads apps/api/uploads/private`.
- Locally inspect the files without copying or sharing them to decide whether they are fixtures or private artifacts.

Suggested fix:

- If any file is real user/tester data, remove it from git and rotate/delete any related external copy if needed.
- Add ignore rules for upload directories.
- If fixtures are genuinely needed, move sanitized fixtures to a clearly named test fixture directory.
- If sensitive data has already been shared, consider history cleanup.

Fix size/risk:

- Removing tracked artifacts and adding ignore rules is safe/small.
- History cleanup is risky/big and should be done carefully.

Fix timing:

- Fix before testers.

### P1-REL-001 - I18n Validation Fails On Corrupted Arabic Fallback Text

Severity: P1

Location/file path:

- `apps/web/components/admin/admin-settings-tab.tsx:371`
- `apps/web/components/admin/admin-settings-tab.tsx:376`
- `apps/web/components/admin/admin-settings-tab.tsx:390`
- `apps/web/components/admin/admin-settings-tab.tsx:393`
- `apps/web/components/admin/admin-settings-tab.tsx:399`
- `apps/web/components/admin/admin-settings-tab.tsx:419`

What is wrong:

- `npm run validate:i18n` fails because the admin withdrawal-limit UI contains corrupted Arabic fallback text.

Why it matters:

- This is a release gate failure and will be visible to Arabic-language admin testers in a money/admin settings screen.

How to reproduce or verify:

- Run `npm run validate:i18n`.
- Current failure summary: `Detected possible encoding corruption pattern` in `apps/web/components/admin/admin-settings-tab.tsx`.

Suggested fix:

- Replace the corrupted fallback strings with valid Arabic text or remove the hardcoded fallback if the dictionary already provides the string.
- Rerun `npm run validate:i18n`.

Fix size/risk:

- Safe/small.

Fix timing:

- Fix before testers.

### P1-DATA-001 - Admin Can Change Primary Role Without Creating Required Role Profile

Severity: P1

Location/file path:

- `apps/web/components/admin/admin-user-detail-modal.tsx:854`
- `apps/api/src/modules/admin/admin.controller.ts:284`
- `apps/api/src/modules/admin/admin.service.ts:161`

What is wrong:

- The admin user detail modal exposes `primaryRole`.
- The backend accepts and writes `primary_role`.
- The update path does not appear to create or migrate the role-specific profile row needed by expert, craftsman, or business flows.

Why it matters:

- A tester with admin access can change a customer into a provider/business account and leave the user in an inconsistent state. Role-based pages, onboarding, verification, profile completion, and permissions may then behave unpredictably.

How to reproduce or verify:

- As an admin with `manage_users`, open a customer account in the admin user detail modal.
- Change the role to expert/craftsman/business and save.
- Log in as that user and check onboarding/profile/service/job flows that expect role-specific profile data.

Suggested fix:

- Safest pre-test fix: disable or hide primary-role editing unless there is a complete migration path.
- Better full fix: make role changes a backend transaction that creates the matching role profile, updates verification/onboarding state, and rejects invalid transitions.

Fix size/risk:

- Disabling the field is safe/small.
- Full role migration is riskier/bigger.

Fix timing:

- Fix before testers if admin user management is in the test plan. Otherwise explicitly tell testers not to use role changes and fix after first feedback.

### P2-API-001 - Legacy `/api/users` Endpoints Return Seed Users

Severity: P2

Location/file path:

- `apps/api/src/modules/users/users.routes.ts:25`
- `apps/api/src/modules/users/users.routes.ts:26`
- `apps/api/src/modules/users/users.controller.ts:17`
- `apps/api/src/modules/users/users.repository.ts:3`

What is wrong:

- Authenticated, email-verified users can call `/api/users` and `/api/users/:id`.
- These endpoints return hardcoded seed users such as `usr_1`, not database users.

Why it matters:

- It is confusing for API testers and support/debugging. It also looks like a user directory but is not connected to real data.

How to reproduce or verify:

- Call `GET /api/users` with a valid access token.
- Observe hardcoded users from `users.repository.ts`.

Suggested fix:

- Remove the legacy endpoints, restrict them to admin/debug builds, or replace them with a properly scoped database-backed public profile endpoint.

Fix size/risk:

- Safe/small if endpoints are unused.
- Medium risk if any hidden frontend code depends on them.

Fix timing:

- After testers unless API endpoint testing is in scope.

### P2-DB-001 - Supabase Local Reset References Missing Seed File

Severity: P2

Location/file path:

- `supabase/config.toml:60`
- `supabase/config.toml:65`
- `supabase/seed.sql`

What is wrong:

- `supabase/config.toml` references `./seed.sql`, but `supabase/seed.sql` does not exist.

Why it matters:

- A local `supabase db reset` may fail or confuse anyone trying to reproduce the database locally.

How to reproduce or verify:

- `Test-Path supabase/seed.sql` returns false.
- Inspect `supabase/config.toml` seed settings.

Suggested fix:

- Add an empty `supabase/seed.sql`, add a real seed file, or remove the seed path from config.

Fix size/risk:

- Safe/small.

Fix timing:

- After testers unless testers are expected to run the project locally.

### P2-FE-001 - Private Image Preview Logs Internal Upload URLs

Severity: P2

Location/file path:

- `apps/web/components/ui/image-preview-modal.tsx:27`
- `apps/web/components/ui/image-preview-modal.tsx:67`
- `apps/web/components/ui/image-preview-modal.tsx:102`

What is wrong:

- The image preview modal logs when private uploads are opened and includes internal `imageUrl` values plus whether an access token is present.

Why it matters:

- It does not print the token value, but it creates noisy console output and may expose private upload identifiers in support screenshots or shared browser logs.

How to reproduce or verify:

- Open a private-upload preview and watch the browser console.

Suggested fix:

- Remove the debug logs or guard them behind a development-only flag.

Fix size/risk:

- Safe/small.

Fix timing:

- After testers, or before testers if you expect testers to share console logs/screenshots.

### P2-UX-001 - `/app/browse` Is A Placeholder Page

Severity: P2

Location/file path:

- `apps/web/app/[locale]/app/browse/page.tsx:3`
- `apps/web/app/[locale]/app/browse/page.tsx:15`

What is wrong:

- The browse route renders `ComingSoonPage`.

Why it matters:

- A direct link or tester navigation to browse may look unfinished, even if the route is not prominent in the current sidebar.

How to reproduce or verify:

- Visit `/en/app/browse` while authenticated.

Suggested fix:

- Keep it hidden from tester scripts, redirect it to a live search/discovery flow, or replace the placeholder when browse is in scope.

Fix size/risk:

- Safe/small if hidden/redirected.
- Bigger if implementing real browse behavior.

Fix timing:

- After testers unless browse is in the test script.

### P2-UX-002 - Business Company Document Upload Is Explicitly Deferred

Severity: P2

Location/file path:

- `apps/web/components/onboarding/business-onboarding-screen.tsx:894`
- `docs/LAUNCH_SCOPE.md`

What is wrong:

- The business onboarding UI has copy for company-document upload being unavailable/coming soon.
- Launch scope notes company document upload UI as deferred.

Why it matters:

- Business testers may expect to upload company documents as part of verification and may see this as an incomplete onboarding flow.

How to reproduce or verify:

- Complete business onboarding and reach the documents section.

Suggested fix:

- For the first tester round, explicitly exclude company-document upload from the test script and rely on the current verification path.
- Implement the upload flow later if business verification requires it.

Fix size/risk:

- No-code tester-script fix is safe/small.
- Full implementation is bigger and should not be added during final audit unless required.

Fix timing:

- After testers unless business-document verification is a required tester flow.

### P3-REL-001 - Ship Script Console Text Contains Encoding Artifacts

Severity: P3

Location/file path:

- `scripts/ship.mjs`

What is wrong:

- The release helper script prints corrupted console symbols in some status/error messages.

Why it matters:

- It is confusing but does not affect application behavior.

How to reproduce or verify:

- Read or run `scripts/ship.mjs` in a terminal and inspect the status messages.

Suggested fix:

- Replace decorative symbols with plain ASCII status messages.

Fix size/risk:

- Safe/small.

Fix timing:

- After testers.

## Category Notes

### A) Critical Logic And Functionality Bugs

- No app-breaking main-flow bug was confirmed from static route/component/API review.
- The most practical main-flow risk is `P1-DATA-001`, because admin role changes can create inconsistent user state.

### B) Auth, Permissions, And Security

- Positive: API routes broadly use server-side auth middleware, email verification middleware, role middleware, admin permission checks, rate limiting, CORS, Helmet, refresh-token rotation, and trusted-origin checks for refresh/logout.
- Positive: admin routes reload admin state from the database instead of trusting stale JWT admin flags.
- Positive: Supabase backend-only RLS/storage policy migrations exist.
- Blocking risks: `P0-SEC-001` and `P0-SEC-002`.
- Uncertain but non-blocking: Next middleware uses a non-secret session hint cookie for redirect UX; real protection is API-side, so this is acceptable as long as private data is not rendered without API authorization.

### C) Database And Backend Consistency

- Main confirmed risk: `P1-DATA-001`.
- Local reset issue: `P2-DB-001`.
- I did not find a broad schema/code mismatch that blocks the app based on migrations and current type/tests, but this was not a full dynamic production DB audit.

### D) UI/UX And Tester Readiness

- Main issues: i18n gate failure, placeholder browse route, and deferred business document upload.
- Recommend giving testers a tight script that avoids deferred flows unless you want feedback on incomplete scope.

### E) Frontend Quality

- Lint and typecheck pass.
- `P2-FE-001` is the main frontend quality issue found.
- No broad React hydration issue was proven from static review.

### F) API, Integrations, And External Services

- See `SERVICES_AND_DEPLOYMENT_INVENTORY.md`.
- Highest pre-test risk is dashboard/config activation, especially Resend, Supabase, Render, Vercel, Didit, NOWPayments, Agora, and Sentry.

### G) Testing And Release Readiness

Commands run locally:

| Command                                    | Result | Notes                                                                                                          |
| ------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                             | Pass   | API and web lint passed.                                                                                       |
| `npm run typecheck -w @mohandishub/shared` | Pass   | Shared package typecheck passed.                                                                               |
| `npm run typecheck -w @mohandishub/api`    | Pass   | API typecheck passed.                                                                                          |
| `npm run typecheck -w @mohandishub/web`    | Pass   | Web typecheck passed after route type generation.                                                              |
| `npm run test -w @mohandishub/shared`      | Pass   | 3 files, 10 tests.                                                                                             |
| `npm run test -w @mohandishub/api`         | Pass   | 29 files, 135 tests.                                                                                           |
| `npm run test -w @mohandishub/web`         | Pass   | 11 files, 40 tests.                                                                                            |
| `npm run format:check`                     | Pass   | Prettier check passed.                                                                                         |
| `npm run validate:i18n`                    | Fail   | Fails on corrupted Arabic fallback strings in `admin-settings-tab.tsx`; blocking enough to fix before testers. |

Environment note: commands were run on local Node `v24.11.1`; repo CI uses Node 20. This is not a blocker, but run the final checks in the deployment/CI environment too.

Commands recommended before testers:

1. `npm run validate:i18n`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test`
5. `npm run build`
6. `npm run e2e -w @mohandishub/e2e` against staging, if staging test users and URLs are configured.

Critical manual flows to test before sending the link:

1. Signup, email OTP, login, refresh after reload, logout.
2. Forgot password and reset password through production email.
3. Customer onboarding, create need/project, provider bid, accept/award.
4. Expert/craftsman/business onboarding and verification initiation.
5. Service creation, booking/reservation, cancellation, review.
6. Wallet: small platform-owned NOWPayments deposit, manual InstaPay deposit, withdrawal request, admin approval/rejection.
7. Chat and attachments between allowed participants.
8. Admin: user search, verification review, app settings, wallet/manual money operations.
9. Private upload preview authorization as owner, admin, and unrelated user.
10. Arabic and English smoke pass on the main tester script.
