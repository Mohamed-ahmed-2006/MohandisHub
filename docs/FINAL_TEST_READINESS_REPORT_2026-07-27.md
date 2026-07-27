# MohandisHub final-test readiness report

Date: 2026-07-27  
Branch: `codex/final-integration-20260722`  
Scope: local repository and non-production validation only

## 1. Executive summary

The release-hardening implementation is complete in three reviewable commits. The verified P1
environment-isolation defect and the integration regression that caused local E2E to contact the
production API are fixed. The eleven previously open code/data findings RA-032 through RA-042 are
implemented with additive migrations and regression tests. Advertising now has a reviewable,
wallet-backed lifecycle but remains disabled in production.

Local validation passes: installation, type checking, lint, 311 unit tests, coverage thresholds,
localization, formatting, production build, dependency exception policy, and the isolated browser
matrix. The browser matrix covered English and Arabic at 320, 768, 1366, and 1920 pixels and failed
on console errors, page errors, network failures, overlap defects, or Axe violations.

No production service, infrastructure, user, or data was accessed. No destructive database command
was run.

Final unresolved finding counts:

| Severity | Count | Summary                                                                                         |
| -------- | ----: | ----------------------------------------------------------------------------------------------- |
| P0       |     0 | None                                                                                            |
| P1       |     0 | All verified P1 code defects are fixed and regression-tested                                    |
| P2       |     2 | Expiring Next transitive advisory exception; historical Stripe-style webhook-secret fingerprint |
| P3       |     0 | None                                                                                            |

The code is suitable to enter dedicated final staging testing. It is not approved for public launch
because the disposable database, authenticated staging journeys, Resend, Didit, and NOWPayments
sandbox checks were unavailable locally.

## 2. Architecture understood

- `apps/web`: Next.js 15.5 web application deployed to Vercel. Browser/API calls cross the public API
  trust boundary; private files use the same-origin proxy.
- `apps/api`: Express/TypeScript API and worker deployed to Render. Authentication, authorization,
  pricing, wallet mutations, advertising transitions, upload ownership, and external-provider calls
  are enforced here.
- `packages/shared`: shared types and calculation-facing DTOs.
- `supabase/migrations`: PostgreSQL schema, constraints, indexes, triggers, and backend-owned
  transactional functions.
- External boundaries: Supabase database/storage, Resend email, Didit identity verification,
  NOWPayments sandbox crypto, and inactive Paymob/InstaPay/Stripe rails.
- Asynchronous work: reservation/retention workers, deposit reconciliation, and storage-deletion
  outbox processing.

Trust decisions remain server-side. The client cannot select roles, payment capabilities,
advertisement prices/statuses, wallet amounts, review outcomes, or ownership identifiers.

## 3. Audit reconciliation and findings

The previously fixed RA-001 through RA-031 controls were retained and their release regressions
remain covered. The final reconciliation for the previously open findings is:

| Original ID | Decision | Final status       | Evidence                                                                                                                                             | Commit               |
| ----------- | -------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| RA-032      | Accepted | Fixed              | Completed-reservation counts and visible reservation-linked review averages are maintained by database triggers and backfilled                       | `c446fae`            |
| RA-033      | Accepted | Fixed              | Shared strict positive-integer pagination rejects invalid input with `INVALID_PAGINATION` and bounds limits/offsets                                  | `c446fae`            |
| RA-034      | Accepted | Fixed              | Deposit intents persist before provider contact, accept an idempotency key, and reconcile unknown outcomes                                           | `c446fae`            |
| RA-035      | Accepted | Fixed              | Uploads are signature-detected; spoofed, truncated, mismatched, and oversized files are rejected                                                     | `c446fae`            |
| RA-036      | Accepted | Fixed              | Upload registry and retryable deletion outbox separate database commit from idempotent storage cleanup                                               | `c446fae`            |
| RA-037      | Accepted | Fixed              | Didit terminal identity/profile/audit writes use one locked transaction with rollback tests                                                          | `c446fae`            |
| RA-038      | Accepted | Fixed              | Earnings, revenue, conversion, forecast, and service-view definitions now use documented source-of-truth records                                     | `c446fae`            |
| RA-039      | Accepted | Fixed              | External HTTP calls use bounded timeouts/retries; FX uses fresh live/admin rates and `pending_fx` reconciliation                                     | `0469e76`, `c446fae` |
| RA-040      | Accepted | Mitigated, P2 open | Next/PostCSS/Sentry were upgraded; remaining inherited Next advisories are covered by the expiring reachability exception                            | `0469e76`            |
| RA-041      | Accepted | Fixed for staging  | Advertising lifecycle, holds, review, delivery tokens, metrics, localization, and destinations are complete; production remains disabled             | `e8570b3`            |
| RA-042      | Accepted | Fixed              | Legacy no-snapshot settlement blocks safely; audited super-admin reconciliation, Cairo-day limits, strict ranges, and elapsed-time expiry were added | `c446fae`            |

### New integration findings

#### FT-001 — P1 — Fixed — Environment isolation

- Impact: tests or local E2E could load production-target configuration.
- Reproduction: start the previous API/E2E commands while `apps/api/.env` exists.
- Root cause: implicit dotenv discovery and a local browser default that did not override the web API
  target.
- Files: `apps/api/src/config/env.ts`, `apps/e2e/playwright.config.ts`,
  `scripts/e2e-dev-web.mjs`, `scripts/e2e-local-stub-api.mjs`.
- Fix: explicit deployment environments, loopback-only local launchers, production host/project
  refusal, and fail-closed staging configuration.
- Tests: `env-isolation.test.ts`, `env-production.test.ts`, `phase7-readiness.test.ts`, and the full
  browser suite.
- Remaining risk: remote staging still requires separately supplied sandbox credentials.
- Commit: `0469e76`.

#### FT-002 — P2 — Fixed — Public-page contrast

- Impact: primary navigation and Arabic language controls failed WCAG AA contrast.
- Reproduction: run Axe against `/en` and `/ar` at 320–1920 pixels.
- Root cause: a bright orange token and opacity blending reduced contrast to 2.59–2.85:1.
- Files: `apps/web/app/globals.css`, `apps/web/components/language-toggle.css`.
- Fix: accessible primary/accent token and opaque language label.
- Tests: eight responsive Axe cases now pass with zero violations.
- Remaining risk: authenticated staging screens still require credentialed accessibility coverage.
- Commit: `0469e76`.

#### FT-003 — P2 — Fixed — Local telemetry request

- Impact: local browser gates failed on an unnecessary Vercel telemetry network request.
- Root cause: Speed Insights rendered outside Vercel.
- File: `apps/web/app/layout.tsx`.
- Fix: render Speed Insights only when `VERCEL=1`.
- Tests: browser fixture reports zero unexpected failed requests.
- Commit: `0469e76`.

#### FT-004 — P2 — Unresolved — Historical webhook-secret fingerprint

- Impact: a value matching a Stripe webhook signing secret remains reachable in historical versions
  of `apps/api/docs/STRIPE.md`. If real and not revoked, it is credential exposure.
- Evidence: redacted scan of 162 commits found one stable fingerprint in four historical blobs. The
  value is absent from the current tree and was not printed.
- Current containment: Stripe packages/clients/configuration are removed; both legacy endpoints
  return `STRIPE_DISABLED`; production kill switches reject activation.
- Required mitigation: verify the value is a dummy or revoke it in Stripe, then perform the
  separately approved history rewrite and scan a fresh clone.
- Remaining risk: future accidental Stripe reactivation could make an unrevoked historical webhook
  secret relevant.
- Launch effect: blocks public release policy completion, but does not block isolated staging tests
  while Stripe remains disabled.

## 4. Calculation audit

| Calculation                           | Source of truth                                              | Edge cases covered                                                                     | Result                                                    |
| ------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Reservation settlement/disputes       | Server snapshot plus integer-piastre wallet transaction      | zero, partial allocation, invalid/negative, rounding, conservation                     | Pass                                                      |
| Legacy settlement                     | Pricing snapshot presence                                    | missing snapshot                                                                       | Safely blocked and routed to audited reconciliation       |
| Advertising quote/hold/capture/refund | Server daily price snapshot and wallet hold                  | 1–365 days, insufficient balance, rejection, pause, cancellation, pro-rata unused time | Pass                                                      |
| Deposits                              | Persisted intent and provider/idempotency key                | duplicate/concurrent requests, provider timeout, unknown outcome, FX outage            | Pass in unit/failure-injection tests                      |
| FX conversion                         | Timestamped live/admin rate                                  | missing, stale over 24 hours, invalid, callback without fresh rate                     | Pass; quotes pause or enter `pending_fx`                  |
| Service aggregates                    | PostgreSQL completed reservations and visible linked reviews | no orders/reviews, hidden reviews, backfill, service changes                           | Migration written; real DB execution not verified locally |
| Provider earnings                     | Completed reservation credits                                | empty/ranged results                                                                   | Pass by query definition                                  |
| Platform revenue                      | Completed commission credits                                 | empty/ranged results                                                                   | Pass by query definition                                  |
| Conversion                            | Completed reservations / deduplicated service views          | zero views, strict date ranges                                                         | Pass                                                      |
| Forecast                              | Active reservation holds                                     | no holds and invalid legacy statuses                                                   | Pass                                                      |
| Pagination                            | Shared parser                                                | zero, negative, decimal, malformed, overflow, excessive limit                          | Pass                                                      |
| Withdrawal daily limit                | PostgreSQL Cairo calendar day                                | day boundary and concurrent requests                                                   | Pass in atomicity tests                                   |
| Negotiation expiry                    | Absolute elapsed time                                        | past/future boundary                                                                   | Pass                                                      |

## 5. Security and permission audit

- Authentication and roles were not redesigned.
- `primaryRole` remains rejected from admin-controlled input.
- Factory reset still requires server-side `super_admin`, the exact confirmation body, and the
  production opt-in.
- Didit webhook/admin terminal changes lock the record and commit identity/profile/audit state
  together.
- Advertisement destinations must be active and advertiser-owned at submission, approval,
  delivery, and click.
- Upload ownership and detected content type are server-controlled; object keys are randomized.
- Private upload identifiers and sensitive provider errors are not logged.
- External requests have timeouts and bounded retry rules; non-idempotent unknown outcomes reconcile
  from persisted state.
- No active Stripe package exists. Stripe, Paymob, InstaPay, NOWPayments fiat/withdrawals, and
  advertising default to disabled; production validation rejects unsafe enablement.
- Hooks execute in stable order and React Hooks lint rules remain enabled.
- `avatarUrl` persistence/serialization regressions remain covered.
- Arabic dictionaries validate and the browser checks confirm Arabic RTL.
- `/app/browse` remains intentionally handled; no placeholder/debug UI or sensitive debug endpoint
  was introduced.

## 6. Commands and validation results

| Command                                                                                       | Result                                                                |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------- |
| `npm ci`                                                                                      | Pass; clean lockfile installation, 731 packages                       |
| `npm run format:check`                                                                        | Pass                                                                  |
| `npm run typecheck`                                                                           | Pass for shared, API, and web                                         |
| `npm run lint`                                                                                | Pass with zero warnings; Hooks rules active                           |
| `npm run test`                                                                                | Pass: shared 13, API 244, web 54; 311 total                           |
| `npm run test:coverage`                                                                       | Pass configured thresholds; API 21.02% statements, web 63.69%         |
| `npm run validate:i18n`                                                                       | Pass                                                                  |
| `npm run build`                                                                               | Pass; Next.js 15.5.22 production build                                |
| `npx playwright test --reporter=line`                                                         | Pass locally: 18 passed, 4 credential-dependent sandbox tests skipped |
| Axe/viewport matrix inside Playwright                                                         | Pass: EN/AR at 320, 768, 1366, 1920; zero Axe violations              |
| Browser console/page/network fixture                                                          | Pass: zero unexpected errors/failures in executed tests               |
| `npm run audit:release`                                                                       | Pass under `NEXT-15-TRANSITIVE-2026-07`, expires 2026-08-27           |
| `npm ls stripe '@stripe/stripe-js' --all`                                                     | Empty dependency tree                                                 |
| `supabase db lint --local`                                                                    | Not verified: local PostgreSQL port 54322 unavailable                 |
| `supabase status`                                                                             | Not verified: Docker/Supabase local runtime unavailable               |
| `git rev-list --objects --all \| rg '(^                                                       | /)apps/api/uploads/'`                                                 | Pass: no reachable named upload objects |
| Redacted strong-secret pattern scan over `git rev-list --all`                                 | 162 commits scanned; one historical Stripe-style fingerprint remains  |
| `git bundle verify D:\Private Projects\MohandisHub-final-test-backup-20260727-e8570b3.bundle` | Pass; complete-history bundle                                         |

The four skipped Playwright tests require staging customer/provider/admin accounts and paid
provider/service/slot fixtures. CI now fails closed when these values are missing.

## 7. Changes made

- `0469e76` — environment isolation, payment kill switches, Stripe removal, provider timeouts,
  dependency upgrades/policy, fail-closed CI, isolated E2E, accessibility integration fixes.
- `c446fae` — pagination, upload registry/signatures/outbox, deposits/reconciliation, FX freshness,
  analytics, service aggregates, Didit transactionality, reservation/time/calculation invariants.
- `e8570b3` — complete reviewable wallet-backed advertising lifecycle and localized web/admin flows.

All database changes are new additive migrations. No existing migration was rewritten. Existing
successful response shapes, authentication model, role model, and permissions were preserved.

Backup bundle:
`D:\Private Projects\MohandisHub-final-test-backup-20260727-e8570b3.bundle` (verified, 8,927,708
bytes). It contains the implementation commits and the complete pre-rewrite history.

## 8. Launch checklist

| Area                               | Status       | Evidence/condition                                                                     |
| ---------------------------------- | ------------ | -------------------------------------------------------------------------------------- |
| Authentication                     | Not verified | Unit/static controls pass; real OTP/reset/refresh staging journey requires credentials |
| Authorization                      | Pass         | Server-side role/ownership negative tests pass                                         |
| Critical calculations              | Pass         | Integer-piastre and conservation tests pass                                            |
| Data integrity                     | Not verified | Failure-injection tests pass; real PostgreSQL migrations unavailable                   |
| Main user journeys                 | Not verified | Public/local smoke passes; authenticated staging suite pending                         |
| Admin workflows                    | Not verified | Unit/route controls pass; credentialed staging workflow pending                        |
| Uploads                            | Not verified | Signature/ownership/outbox tests pass; real Supabase storage pending                   |
| Email flows                        | Not verified | Resend sandbox credentials unavailable                                                 |
| Identity-verification entry points | Not verified | Didit transaction/replay tests pass; sandbox pending                                   |
| English UI                         | Pass         | Local public and route browser tests                                                   |
| Arabic and RTL UI                  | Pass         | Localization plus RTL browser matrix                                                   |
| Mobile responsiveness              | Pass         | 320px                                                                                  |
| Tablet responsiveness              | Pass         | 768px                                                                                  |
| Desktop responsiveness             | Pass         | 1366px and 1920px                                                                      |
| Accessibility                      | Pass         | Executed public Axe matrix has zero violations                                         |
| Runtime stability                  | Pass         | Executed browser tests have zero console/page/network failures                         |
| Production build                   | Pass         | Next.js optimized build                                                                |
| Environment validation             | Pass         | Production/staging/local fail-closed tests                                             |
| Logging and privacy                | Pass         | No sensitive logging added; private-upload regression retained                         |
| Inactive payment behavior          | Pass         | Stripe absent/disabled; unfinished rails default off                                   |
| Rollback readiness                 | Pass         | Runbooks, kill switches, additive migrations, and verified bundle                      |

## 9. Remaining risks

### RISK-001 — P2 — Disposable database validation unavailable

- User impact: migration syntax, trigger behavior, and transaction interactions could still fail in a
  real PostgreSQL/Supabase environment.
- Why it remains: Docker and local PostgreSQL are unavailable; no staging database credential was
  supplied.
- Mitigation: run empty-database migrations, `supabase db lint`, integration tests, and rollback
  rehearsal against a disposable non-production project.
- Blocks launch: yes, public launch; does not prevent entering final staging testing.

### RISK-002 — P2 — External sandbox journeys unavailable

- User impact: OTP/email, Didit, NOWPayments, authenticated booking/wallet/admin, and real storage
  behavior are not end-to-end verified.
- Why it remains: sandbox URLs, credentials, accounts, and seeded fixture IDs were not supplied.
- Mitigation: run the fail-closed staging CI and the documented English/Arabic journeys.
- Blocks launch: yes, public launch.

### RISK-003 — P2 — Expiring dependency exception

- User impact: inherited Next PostCSS/Sharp advisories remain in the production dependency graph.
- Why it remains: no compatible Next 15.5 patch removes all inherited advisories. Image optimization
  is disabled, and the exception is reachability-scoped.
- Mitigation: upgrade or renew with evidence before 2026-08-27.
- Blocks launch: no while the approved exception remains valid; yes after expiry.

### RISK-004 — P2 — Historical Stripe-style secret

- User impact: potential credential exposure if the historical value is real and still active.
- Why it remains: rotation requires provider access; history rewriting changes commit hashes and
  requires explicit confirmation.
- Mitigation: revoke/verify the credential, rewrite history from the verified bundle baseline, scan
  a fresh clone, and coordinate the force-push.
- Blocks launch: yes, public launch policy completion.

## 10. Final verdict

`CONDITIONAL_LAUNCH`

The branch is ready to enter final non-production staging testing. Public launch remains conditional
on the disposable database gates, credentialed sandbox journeys, and historical-secret
rotation/purge. Advertising and all unfinished payment rails must remain production-disabled until
those gates pass.
