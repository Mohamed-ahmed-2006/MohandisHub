# Part B — End-to-End Completion Plan

**Scope:** everything after MHC recovery (Part A), through to a launch-readiness decision.
**Status:** plan only. No application code modified.
**Date:** 2026-07-28

---

## B0. How to read this

Part A (`MHC_RECOVERY_PLAN.md`) runs first and must be green before Phase 1 starts. The one
exception is **Phase 0**, below, which is pure investigation and can run in parallel with
Part A.

**Confidence levels differ across phases.** Phases 1–13 cover ground I have read directly;
phases 14–24 cover modules I have only surveyed. Where I have not read the code, the phase
says so and its first task is always "audit before changing". I would rather state that than
present a uniform-looking plan built partly on guesswork.

Every phase carries the same seven fields. A phase is **not complete** until its completion
criteria are met *and* `npm run typecheck`, `npm run lint`, and `npm test` are green.

**Legend:** ⛔ blocked by a decision · 🔍 audit-first (code not yet read) · ⚡ launch-critical

---

## Phase 0 — Baseline audit and instrumentation 🔍

- **Goal.** Establish an accurate, evidence-backed picture of every module not yet read, and
  make the test suite trustworthy before relying on it.
- **Scope.** Deep-read `wallet.service.ts`, the rest of `wallet.repository.ts`, reservations,
  jobs/milestone escrow, disputes, notifications, admin permissions, and auth. Record findings
  in `AUDIT_MASTER.md`. Run `npm run lint` for the first time and record the baseline. No
  behaviour changes.
- **Dependencies.** None. Can start immediately, in parallel with Part A.
- **Risks.** Low. The main risk is discovering that a later phase's scope is much larger than
  estimated — which is the point of doing it first.
- **Files/modules.** `apps/api/src/modules/{wallet,reservations,jobs,moderation,notifications,admin,auth}`, `apps/api/src/middleware`.
- **Required tests.** None produced; the deliverable is findings.
- **Completion criteria.** Every module has an `AUDIT_MASTER.md` row or an explicit
  "no findings" note. Lint baseline recorded. All Part B phase estimates revised against
  what was found.

---

## Phase 1 — Authentication and account recovery 🔍⚡

- **Goal.** Sign-up, sign-in, email verification, password reset, session refresh, and logout
  work correctly and securely for every role.
- **Scope.** `authenticate` middleware, JWT issue/refresh/revoke, cookie flags and
  cross-site behaviour, OTP email, password reset token lifetime and single-use enforcement,
  rate limiting, account lockout. Recent commits (`9e2b39c` "cross-site refresh cookies if
  NODE_ENV is mis-set", `9ea3f81` "same-origin auth proxy") indicate this area has had
  environment-sensitive bugs.
- **Dependencies.** Phase 0.
- **Risks.** Medium-high. Auth changes can lock out every user simultaneously; cookie
  behaviour differs between local, preview, and production origins.
- **Files/modules.** `apps/api/src/modules/{auth,otp}`, `apps/api/src/middleware/authenticate.ts`, `require-email-verified.ts`, `apps/web/middleware.ts`, `apps/web/lib/auth`.
- **Required tests.** Unit per token path; expired/reused/forged token rejection; reset token
  single-use; rate-limit enforcement; an E2E covering register → verify → login → refresh →
  logout.
- **Completion criteria.** All flows pass in staging on the production cookie configuration.
  No token accepted after logout or expiry. Reset tokens are single-use and time-bounded.

---

## Phase 2 — Customer onboarding ⚡

- **Goal.** A new customer reaches a usable dashboard without dead ends.
- **Scope.** Role selection, profile creation, required-versus-optional fields, prefill from
  account data, completion tracking, and the empty-state dashboard.
- **Dependencies.** Phase 1.
- **Risks.** Low.
- **Files/modules.** `apps/api/src/modules/profiles`, `apps/web/app/(onboarding)`, customer dashboard components.
- **Required tests.** Validation unit tests; E2E register → onboard → dashboard.
- **Completion criteria.** A fresh customer completes onboarding and posts a need without
  encountering an error or an unexplained empty screen.

---

## Phase 3 — Provider onboarding and verification ⛔⚡

- **Goal.** Experts, craftsmen, and businesses complete onboarding, submit verification, and
  reach a state where they can bid.
- **Scope.** Three role-specific profile flows, identity/business document upload, the
  verification review queue, the platform-verified badge, and — per **D5** — provider payment
  method registration during onboarding.
- **Dependencies.** Phase 1. **D5** (payment-method configuration is part of this flow).
  Part A M4.
- **Risks.** Medium. Documents are private uploads with retention rules; the storage
  posture (`20260317000000_private_uploads.sql`, `20260405180000_retention_upload_governance.sql`)
  must be verified, not assumed.
- **Files/modules.** `apps/api/src/modules/{profiles,verification,upload,media}`, provider onboarding web routes.
- **Required tests.** Per-role onboarding completion; document upload authorization (a user
  cannot read another's documents); verification state transitions.
- **Completion criteria.** Each provider role completes onboarding, submits verification, is
  approved by an admin, and can bid. Payment methods captured per D5.

---

## Phase 4 — Need creation, editing, and cancellation ⚡

- **Goal.** Customers create, edit, close, and cancel needs with correct quota enforcement.
- **Scope.** Create/update validation, plan quota checks, status transitions, attachments,
  category selection. Closes **MHC-15** (status enum) and **MHC-16** (divergent quota counts).
- **Dependencies.** Phase 2. Part A M8.
- **Risks.** Low-medium — the status transition map now includes the MHC pending state, and
  two quota code paths must be reconciled.
- **Files/modules.** `apps/api/src/modules/needs/*`, `apps/api/src/modules/plans/plans.service.ts`, `apps/web/app/needs`.
- **Required tests.** Transition matrix covering every from→to pair including
  `awarded_pending_provider_acceptance`; quota enforcement agreement between both paths;
  ownership checks on edit and close.
- **Completion criteria.** Every status transition behaves per the matrix. Both quota paths
  return identical counts for identical data. Closing a need with a pending award cleans up
  correctly (**MHC-17**).

---

## Phase 5 — Browsing and provider discovery

- **Goal.** Customers find providers and providers find needs, without contact leakage.
- **Scope.** Open-need listing, search, filters, pagination, category browsing, provider
  directory, public profiles, saved searches, favourites, recommendations. Confirms the
  `COALESCE(display_name, 'Customer'|'Provider')` fix holds everywhere and resolves **MHC-09**
  per D5.
- **Dependencies.** Phase 3, Phase 4. **D5** (sub-question on portfolio/website links).
- **Risks.** Low-medium — listing queries are the classic place for a contact field to
  reappear in a `SELECT *`.
- **Files/modules.** `apps/api/src/modules/{needs,profiles,services,saved-searches,favorites,recommendations,geo}`.
- **Required tests.** Payload snapshot tests asserting no email or phone appears in any list
  or public profile response, for every role.
- **Completion criteria.** No listing or public endpoint returns contact data. Search,
  filters, and pagination behave correctly in both languages.

---

## Phase 6 — Bid submission, editing, and withdrawal ⚡

- **Goal.** Providers bid, edit, and withdraw cleanly, with quota and status integrity.
- **Scope.** Create/update/withdraw, per-need bid limits (`countActiveBidsOnNeed` now
  includes `awarded_pending`), plan-based priority bidding, duplicate prevention, and the
  `bids_status_check` set extended by the MHC migration.
- **Dependencies.** Phase 4, Phase 5. **D4** (whether losing bids are rejected or held
  changes the status model).
- **Risks.** Medium — the bid status set is shared with the award flow; a change here can
  destabilise Part A M6.
- **Files/modules.** `apps/api/src/modules/needs/{needs.service,needs.repository}.ts`, provider bid UI.
- **Required tests.** Bid limit enforcement; withdrawal releases the slot; a bid in
  `awarded_pending` cannot be edited or withdrawn behind the customer's back.
- **Completion criteria.** All bid transitions correct, including the MHC-introduced states.

---

## Phase 7 — Awarding and provider activation ⛔⚡

- **Goal.** The MHC award/activation loop works end to end for real users.
- **Scope.** This is Part A M3, M6, and M7 landing together: offer semantics, per-bid gating,
  TOCTOU-safe charging, expiry, decline, re-award, and the full UI. Closes **MHC-01**,
  **MHC-03**, **MHC-07**, **MHC-14**, **MHC-17**, **MHC-18**.
- **Dependencies.** Part A M1–M7. **D3**, **D4**.
- **Risks.** **Highest in the plan.** This is money movement, state transitions, and a
  paywall in one flow. Every concurrency scenario in `MHC_RECOVERY_PLAN.md` A5 must pass.
- **Files/modules.** `apps/api/src/modules/mhc/*`, `apps/api/src/modules/needs/*`, `apps/api/src/worker.ts`, provider and customer award UI.
- **Required tests.** The full A5 scenario set as automated tests where possible: single
  charge under concurrency, expiry-versus-activation race, decline-then-reaward,
  insufficient credits, frozen wallet, kill switch.
- **Completion criteria.** All nine A5 scenarios pass manually in staging, in both languages.
  No path produces a charge without an open job, or an open job without a charge.

---

## Phase 8 — Chat and contact unlocking ⛔⚡

- **Goal.** Exactly one coherent contact-disclosure rule across every messaging surface.
- **Scope.** Part A M5 (general chat per D2) plus the bid-chat redaction already built, plus
  the socket layer, plus the provider payment-detail disclosure from M4. Closes **MHC-04**,
  **MHC-05**, **MHC-06**.
- **Dependencies.** Phase 7. **D2**, **D3**, **D5**.
- **Risks.** High. Chat is live and socket-backed; the socket path must enforce the same rule
  as HTTP or it becomes a third bypass.
- **Files/modules.** `apps/api/src/modules/chat/*`, `apps/api/src/modules/needs/needs.service.ts`, `apps/api/src/utils/contact-redaction.ts`, the new provider-payment-methods module.
- **Required tests.** Gate coverage matrix: one test per privileged endpoint asserting 402
  before activation and 200 after, over both HTTP and socket paths. Redaction unit tests
  already exist (`contact-redaction.test.ts`) and should be extended with adversarial cases.
- **Completion criteria.** A documented matrix of every endpoint that can disclose contact or
  payment data, each with a passing gate test. No known bypass remains open.

---

## Phase 9 — Work completion 🔍

- **Goal.** A job moves from activated to completed with both parties agreeing.
- **Scope.** `awarded → in_progress → completed`, who may trigger each transition,
  provider-side completion signalling, and the interaction with milestone escrow (which I
  have not yet read).
- **Dependencies.** Phase 7. **D6** (milestone escrow's fate).
- **Risks.** Medium. With escrow retired, completion is customer-attested and unverified —
  a provider can be marked incomplete despite having been paid off-platform. That is inherent
  to the direct-payment model and should be documented in `KNOWN_LIMITATIONS.md`, not
  engineered around at launch.
- **Files/modules.** `apps/api/src/modules/needs`, `apps/api/src/modules/jobs`.
- **Required tests.** Transition authorization; completion is idempotent; a completed need
  cannot revert.
- **Completion criteria.** The completion path works without any escrow dependency, and the
  provider has a visible way to dispute a wrongly-withheld completion (see Phase 11).

---

## Phase 10 — Reviews and ratings

- **Goal.** Reviews are trustworthy and only from real, completed engagements.
- **Scope.** Eligibility (`need.status === 'completed'` and `awarded_bid_id` present —
  VERIFIED as the current rule), one review per need, customer and provider directions,
  rating aggregation, review reports.
- **Dependencies.** Phase 9.
- **Risks.** Low-medium. Eligibility depends on `awarded_bid_id`, which the MHC flow now sets
  at activation rather than at award — this must be re-verified end to end after Phase 7.
- **Files/modules.** `apps/api/src/modules/reviews/*`.
- **Required tests.** Ineligible review attempts rejected; duplicate prevented; aggregation
  correct; the post-MHC award path still satisfies eligibility.
- **Completion criteria.** Reviews can only follow a genuinely completed, activated job.

---

## Phase 11 — Disputes, cancellations, and refunds ⛔🔍

- **Goal.** A coherent dispute path in a world where the platform holds no job money.
- **Scope.** Dispute cases, reservation disputes, review reports, cancellation policy, and —
  critically — what "refund" now means. **MHC is explicitly non-refundable to money.** If a
  job goes wrong after activation, the provider has spent credits and the platform holds
  nothing to return.
- **Dependencies.** Phase 9, Phase 10. **D1**, **D6**. Very likely a new decision once
  audited.
- **Risks.** High, and partly unknown — I have not read this module. The core policy question
  (is activation MHC ever refunded, and in what form) is not answered anywhere in the
  repository.
- **Files/modules.** `apps/api/src/modules/{moderation,reviews}`, dispute case tables, `docs/ESCROW_AND_DISPUTES.md`.
- **Required tests.** Dispute lifecycle; any MHC adjustment is ledger-recorded via
  `type='adjustment'` and attributed to an admin.
- **Completion criteria.** A documented dispute policy consistent with a non-refundable
  credit, and an admin tool to execute it with a full audit trail.
- **Note.** Expect this phase to generate a new blocking decision. Flagging now.

---

## Phase 12 — MHC purchasing and spending ⛔

- **Goal.** The credit economy is complete and safe.
- **Scope.** Part A M2 (fulfilment tightening) plus the admin review queue, package and
  action-price configuration, purchase history, and the balance/transaction UI. Closes
  **MHC-11**, **MHC-12**, and the remainder of **MHC-01**.
- **Dependencies.** Part A M2, M7. **S3** (launch prices must be set).
- **Risks.** Medium. Admin `overrideMhcAmount` is a direct grant lever and needs authorization
  and audit as tight as any money movement.
- **Files/modules.** `apps/api/src/modules/mhc/*`, `apps/api/src/modules/admin/admin.routes.ts`, admin and provider web surfaces.
- **Required tests.** Fulfilment only from `pending`/`pending_review`; double-approve grants
  once; reference reuse refused; override grants are audited.
- **Completion criteria.** Purchase → approval → grant → spend is fully covered by tests, and
  launch prices are configured.

---

## Phase 13 — Advertisements, boosts, and promotions ⛔

- **Goal.** Promotional features either work or are cleanly disabled.
- **Scope.** Per **D6**: my recommendation is free-only ads at launch, with the four seeded
  MHC action keys implemented afterwards. Minimum required work is fixing the 402 that
  currently blocks free ads for providers without an EGP wallet row (**MHC-19**).
- **Dependencies.** Phase 12. **D6**.
- **Risks.** Medium. The ad refund path also moves EGP and needs the same treatment as the
  charge path.
- **Files/modules.** `apps/api/src/modules/advertisements/*`.
- **Required tests.** Free-ad creation with no money wallet; paid-ad path per D6; refund path.
- **Completion criteria.** No advertisement path depends on a frozen or unfundable wallet.

---

## Phase 14 — Notifications and email 🔍

- **Goal.** Every state change the user must know about produces exactly one clear message.
- **Scope.** In-app notifications, transactional email (Resend, per commit `fc23142`),
  templates in Arabic and English, delivery failure handling, and the
  `cap_pending_email_attempts` cap. The MHC flow adds several new notification types
  (award offered, activation required, offer expiring, offer expired, credits granted,
  purchase rejected) — some already emitted by `awardBid`, most not yet.
- **Dependencies.** Phases 7–12 (they define what must be notified).
- **Risks.** Medium — `notifyUser` is called fire-and-forget in `needs.service`; failures may
  be silent.
- **Files/modules.** `apps/api/src/modules/notifications/*`, email templates.
- **Required tests.** One test per notification trigger; template rendering in both
  languages; failure does not roll back the originating transaction.
- **Completion criteria.** Every MHC and job state change has a tested notification in both
  languages.

---

## Phase 15 — Admin and super-admin workflows 🔍⚡

- **Goal.** Operators can run the platform without direct database access.
- **Scope.** The permission matrix (`requireAdminPermission`), user management, verification
  review, credit purchase review, pricing configuration, payment-method toggles, audit log,
  support tickets, backup/restore, and any factory-reset or destructive tooling.
- **Dependencies.** Phase 12. Possibly new decisions on destructive operations.
- **Risks.** High. Admin endpoints are the highest-privilege surface. The MHC admin routes
  were added under `manage_transactions` and `manage_plans` (VERIFIED) — that mapping needs
  review, since `manage_plans` now also grants control over what every activation costs.
- **Files/modules.** `apps/api/src/modules/{admin,operations,audit,support}`, `apps/api/src/middleware/require-role.ts`.
- **Required tests.** Every admin route asserted against every permission, positive and
  negative. Destructive operations require explicit confirmation and are audit-logged.
- **Completion criteria.** A complete route→permission matrix with tests. No destructive
  operation is reachable without confirmation and an audit record.

---

## Phase 16 — Authorization and security ⚡

- **Goal.** No user can read or modify data they do not own.
- **Scope.** A systematic ownership-check sweep across every module, IDOR testing, rate
  limiting, CORS, input validation coverage, private upload access control, RLS posture, and
  secret handling.
- **Dependencies.** Phases 1–15.
- **Risks.** Medium — likely to surface findings requiring rework in earlier phases, which is
  why it sits late but not last.
- **Files/modules.** Repository-wide; concentrated in middleware and repositories.
- **Required tests.** An authorization test per resource-owning endpoint. Automated IDOR
  sweep where feasible.
- **Completion criteria.** Every endpoint returning user-scoped data has a passing negative
  authorization test. `/security-review` run on the cumulative diff with no unresolved
  high-severity findings.

---

## Phase 17 — Database integrity ⛔🔍

- **Goal.** Schema, migrations, application types, and real data agree.
- **Scope.** Migration replay against an empty database; migration tracking (**MHC-13**);
  reconciling hand-written row types against actual columns; validating the constraints left
  `NOT VALID`; foreign keys and cascade behaviour; index coverage for the new query patterns.
- **Dependencies.** Phase 16. **D1**, **S2**.
- **Risks.** High. This phase touches production schema state.
- **Files/modules.** `supabase/migrations/*`, every `*.repository.ts`, `scripts/`.
- **Required tests.** CI job replaying all migrations from empty. A schema-versus-types
  consistency check.
- **Completion criteria.** Migrations replay cleanly from empty. Applied-migration state is
  recorded per environment. No hand-written row type contradicts its table.

---

## Phase 18 — UI and UX

- **Goal.** Every screen is coherent, complete, and free of dead ends.
- **Scope.** All 31 web routes: loading states, empty states, error states, form validation
  feedback, navigation consistency, and the new MHC surfaces. Existing checklists
  (`docs/ui-ux-route-checklist.md`) should be reconciled with reality.
- **Dependencies.** Phases 1–15.
- **Risks.** Low individually, large in aggregate.
- **Files/modules.** `apps/web/app/*`, `apps/web/components/*`.
- **Completion criteria.** Every route has defined loading, empty, and error states. No
  unhandled promise rejection or blank screen in normal use.

---

## Phase 19 — Arabic RTL and English LTR

- **Goal.** Both languages are first-class.
- **Scope.** Translation completeness (`npm run validate:i18n`), RTL layout correctness
  (mirroring, icon direction, text alignment), Arabic-Indic numeral display, date and
  currency formatting, and MHC amount presentation in both locales.
- **Dependencies.** Phase 18.
- **Risks.** Medium. RTL bugs are pervasive and easy to miss without deliberate review.
- **Files/modules.** `apps/web` throughout; i18n resources; `scripts/validate-i18n.mjs`.
- **Required tests.** i18n validation in CI; visual RTL pass on every route.
- **Completion criteria.** No missing translation keys. Every route reviewed in Arabic RTL.

---

## Phase 20 — Mobile and tablet responsiveness

- **Goal.** The product works on the devices the market actually uses.
- **Scope.** Every route at phone, tablet, and desktop widths; touch targets; tables and
  long forms on small screens; the MHC purchase and activation flows on mobile specifically.
- **Dependencies.** Phase 19.
- **Risks.** Low.
- **Completion criteria.** Every route usable at 375 px width without horizontal scroll.

---

## Phase 21 — Performance and error handling 🔍

- **Goal.** The system stays responsive and fails legibly.
- **Scope.** N+1 query review (the bid-listing queries with correlated subqueries are the
  obvious candidates), index coverage, payload sizes, error boundaries, and consistent API
  error shapes.
- **Dependencies.** Phase 17, Phase 18.
- **Risks.** Low-medium.
- **Completion criteria.** No unbounded query on a hot path. Every API error returns the
  standard `{ success, code, message }` shape. No unhandled server exception in a normal flow.

---

## Phase 22 — Deployment and production configuration 🔍⚡

- **Goal.** A deploy is reproducible and correctly configured.
- **Scope.** `render.yaml`, environment variable validation at boot, secret management,
  build pipeline, the worker process (which must now also run the award-expiry sweep per
  Part A M6), health checks, and CORS origins.
- **Dependencies.** Phase 17.
- **Risks.** High. Prior commits show repeated production-startup and environment problems
  (`8ac3acf`, `6cc9187`, `9ea9e2b`).
- **Files/modules.** `render.yaml`, `apps/api/src/config/*`, `apps/api/src/worker.ts`, CI workflows.
- **Required tests.** A boot test asserting that missing required environment variables fail
  fast with a clear message. Staging deploy from a clean checkout.
- **Completion criteria.** A clean checkout deploys to staging with no manual steps. Both the
  API and worker processes start and pass health checks.

---

## Phase 23 — Logging, monitoring, backups, and rollback 🔍

- **Goal.** Problems are detectable and recoverable.
- **Scope.** Structured logging with no secrets or PII, Sentry coverage, money-movement audit
  logging (every MHC grant and spend must be traceable to an actor), backup schedule and a
  **tested** restore, and the rollback playbook (`docs/rollback-playbook.md`) verified rather
  than assumed.
- **Dependencies.** Phase 22.
- **Risks.** Medium. An untested backup is not a backup.
- **Completion criteria.** A restore has been performed successfully at least once. Every MHC
  balance mutation is traceable to an actor and a reference. No secret or contact detail
  appears in logs.

---

## Phase 24 — Full regression testing

- **Goal.** Everything still works together.
- **Scope.** Full automated suite; E2E specs written for the critical paths (`apps/e2e`
  currently has no spec files); the complete manual scenario set from `MHC_RECOVERY_PLAN.md`
  A5 plus each phase's scenarios; cross-role, cross-language, cross-device passes.
- **Dependencies.** All prior phases.
- **Risks.** Medium — this is where cross-phase interactions surface.
- **Completion criteria.** Full suite green. Every A5 scenario passes in staging in both
  languages. No open Rank 1–3 finding in `AUDIT_MASTER.md`.

---

## Phase 25 — Launch-readiness decision ⚡

- **Goal.** An explicit, evidence-backed go or no-go — recommended by me, made by you.
- **Scope.** Compile the state of every finding, every decision, every phase, and every
  known limitation into a single recommendation.
- **Dependencies.** Phase 24.
- **Completion criteria.** A written recommendation stating: all Rank 1–3 findings closed or
  explicitly accepted; all decisions D1–D6 answered and implemented; `KNOWN_LIMITATIONS.md`
  reviewed and accepted by you; rollback tested; a named plan for the first 48 hours after
  launch.

---

## B1. Critical path

Not every phase gates the others. The shortest route to controlled launch testing:

```
D1..D6 answered
   ↓
Part A M0-M8  ──►  Phase 7 (award + activation)  ──►  Phase 8 (chat + contact + payment details)
                            ↓                                    ↓
                   Phase 12 (MHC economy)              Phase 16 (authorization)
                            ↓                                    ↓
                   Phase 22 (deployment)  ──►  Phase 24 (regression)  ──►  Phase 25 (decision)
```

Phases 2, 5, 10, 13, 18–21, and 23 are required for launch quality but do not gate the
others and can proceed in parallel once their dependencies are met.

## B2. Sequencing risks

1. **Phase 11 (disputes) will probably generate a new blocking decision** about whether
   activation MHC is ever refunded. Nothing in the repository answers it, and it cannot be
   settled by reading code. Raising it early is better than discovering it late.
2. **Phase 17 (database integrity) touches production schema state** and depends on
   information only you have (**S2**).
3. **Phases 14, 18, 19, and 20 all depend on the MHC UI existing** (Part A M7). If M7 slips,
   four phases slip with it.
4. **Phase 0's findings may materially change phases 9, 11, and 15.** Those three are the
   least-read areas of the codebase and their estimates are the least reliable in this plan.
