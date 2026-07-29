# 00 — Executive Summary

**Audit date:** 2026-07-29
**Scope:** whole repository (`apps/api`, `apps/web`, `packages/shared`, `supabase/migrations`)
**Method:** traced each feature interface → API route → service → repository → SQL migration. No production behaviour was changed in this pass.
**Working tree note:** the audit was taken against `main` @ `557bdf4` plus ~19 uncommitted UI files (`git status`). Findings reference committed code unless stated.

**Classification:** every capability is graded 1–6 in `12-capability-classification.md` — 1 working · 2 inconsistent · 3 cosmetic · 4 partial · 5 broken · 6 missing. **Nothing graded 1 or 2 is recommended for removal.** The objective is coherence, not simplification by deletion.

**Corrections applied during the audit.** Three assumptions carried in the audit brief were tested against the code and did not hold:

| Assumption | Finding |
|---|---|
| Negotiations are an isolated feature and should perhaps be hidden | **Class 1.** Wired into service detail (`app-home-screen.tsx:2181`), backed by `price_negotiations` + `_rounds` with counteroffer history, six states, and five notification emissions. The real gap is narrower: negotiations attach to `service_id` only |
| The calendar may be a disconnected placeholder | **Class 2.** Reads real `reservations`, `reservation_slots` and `reservation_profiles`; `calendar-utils.test.ts` covers the date logic. Extend it, do not hide it |
| Employment jobs should be reported as a deferred future module | **Class 1 — fully built.** Deferring means hiding a working subsystem, which is a product decision this audit does not make. See §9 |

---

## 1. The single most important finding

**MohandisHub already contains a correct, well-built launch revenue engine — and the rest of the product has not been migrated onto it.**

The MHC activation gate (migrations `20260728120000`, `20260728160000`; `apps/api/src/modules/mhc/`) is genuinely good work. It is race-safe, idempotent, fail-closed, audited, and it is the only place in the codebase where the intended business model is actually implemented:

- `mhc_job_activations` has partial unique indexes on `bid_id` and `reservation_id`, so an activation cannot be double-charged.
- The activation row is written in the same transaction that debits MHC, so "paid" and "unlocked" cannot drift.
- `ActivationGateService` fails **closed** when the settings row is missing.
- `provider_payment_disclosures` records who saw which payment details, via which activation.

Everything around it still assumes the **previous** business model — an EGP cash wallet with customer deposits, platform escrow, commission splits, and provider withdrawals. Migration `20260728160000` froze every EGP money wallet (`UPDATE public.wallets SET is_frozen = true WHERE account_type = 'money'`) but did **not** move the features that spend from it.

The result is not "some inconsistent labels". It is a set of **features that are now structurally dead** because their only funding source is frozen:

| Feature | Funding path today | Status |
|---|---|---|
| Advertisement campaigns | `walletRepo.debitWalletInTransaction` on the EGP wallet (`advertisements.service.ts:63`) | **Broken** whenever `pricePerDay > 0` |
| Plan subscriptions | `WalletRepository` injected into `PlansService` (`plans.service.ts:34`) | **Broken** for any priced plan |
| Header "+" deposit button | `WalletDepositModal` → all deposit rails `false` | **Dead** — opens to "No deposit methods are currently available." |
| Withdrawals | All three rails `false`, but `canRequestWithdrawal()` returns `true` for every role | **Dead UI, live route** |

This is the through-line of the whole audit. Almost every P0 item is a consequence of a half-completed migration from the cash model to the credit model.

---

## 2. What MohandisHub is selling at launch

Answering the acceptance-standard question directly, based on what the code can actually do:

> **MohandisHub sells providers paid access to qualified, awarded demand.** The customer posts and awards for free. The provider pays MHC to unlock an award they have already won. Payment for the work itself happens off-platform, directly between the two parties.

That is a coherent, defensible model, and the activation gate implements it correctly. It is **not** what the rest of the UI communicates.

**Revenue points that exist and work:** award activation (`award_activation`), booking activation (`booking_activation`).
**Revenue points that are seeded in `mhc_action_prices` but never charged by any code path:** `subscription_upgrade`, `advertisement`, `service_promotion`, `featured_provider`, `promoted_proposal`.
**Revenue point named in the product objective that does not exist at all:** the bid-submission fee. There is no `bid_submission` action key, no charge on `POST /api/needs/:needId/bids`, and no MHC check anywhere in the bid-creation path.

So step 3 of the intended workflow — *"Providers submit proposals using MHC platform credits"* — is **not implemented**. Bidding is currently free.

---

## 3. The workflow, step by step, against the code

| # | Intended step | Reality |
|---|---|---|
| 1 | Customer posts a need | ✅ Works — but **only** `role='customer'` (`requireRole('customer')`, `needs.routes.ts:17`). A business cannot post a need. |
| 2 | Providers discover it | ⚠️ Partial. `GET /api/needs` exists; discovery UI is buried inside a 2,430-line home screen. |
| 3 | Providers submit proposals **using MHC** | ❌ Bidding is free. No MHC charge exists. |
| 4 | Customer compares and awards | ⚠️ Award works (`awarded_pending_provider_acceptance`). There is no comparison surface — no side-by-side, no scoring. |
| 5 | Awarded provider pays MHC activation | ✅ **Fully implemented and correct.** |
| 6 | Contact + attachments unlock | ✅ Implemented via `ActivationGateService` + `contact-redaction.ts`. |
| 7 | Milestones, files, approvals on-platform | ❌ **Does not exist for needs/bids.** `job_milestones` belongs to the *employment-jobs* module and is escrow-backed by the frozen wallet. |
| 8 | Project completed | ⚠️ `needs.status = 'completed'` exists as a value; no mutual-completion flow. |
| 9 | Both parties review each other | ❌ **Impossible.** `ReviewsService.create` requires a **completed reservation** (`reviews.service.ts:73`). A need/bid job produces no reviewable entity. |
| 10 | One Help & Resolution Center | ❌ Three unconnected systems (see §5). |

**Steps 3, 7, 9 and 10 are missing. Step 1 excludes businesses.** Steps 5 and 6 — the security-critical part — are done, and done well. What is absent is the half that creates retention and trust: the provider pays at the moment of maximum uncertainty and receives a phone number, after which every interaction happens off-platform. A provider who takes the relationship off-platform after one activation never pays a second time.

---

## 4. Role model

The architecture supports **exactly one role per identity**, stored as `users.primary_role`. There is no workspace concept, no profile switching, and no way for one account to both buy and sell.

`ROLE_PERMISSION_MATRIX` (`packages/shared/src/roles.ts`) is explicit about it:

```
customer: { manageNeeds: true,  bidOnNeeds: false, ... }
business: { manageNeeds: false, bidOnNeeds: true,  ... }
```

A business therefore **cannot post a need, cannot hire another provider, and cannot procure anything.** The product objective requires exactly that. This is the deepest architectural gap in the audit and it is the one that most constrains sequencing — see `02-role-workspace-permission-matrix.md`.

The good news: `is_admin` + `admin_permissions[]` are **already** independent of `primary_role` (`load-admin-from-db.ts`, `require-role.ts`). The admin architecture the brief asks for largely exists. It is only the *shared type* (`UserRole` includes `'admin'`) and the ROLE_META table that still conflate them.

---

## 5. Support and disputes

There are **three** parallel, unconnected complaint systems:

1. `support_tickets` — free-text, category ∈ `bug | suggestion | error | other`. **No link to any entity.** A user cannot report a problem *about a specific project*.
2. `reservation_disputes` (+ `_notes`, `_evidence`) — rich case file, but **reservation-only**. A need/bid job cannot raise a dispute.
3. `review_reports` and review disputes — a third channel with its own admin tab.

No escalation path exists between them. The four categories are engineering-team taxonomy (`bug`, `error`), not user problems. See `05-support-dispute-unification.md`.

---

## 6. Business teams

The schema is more complete than expected — `business_teams`, `business_members`, `business_team_roles`, `business_team_invites`, `business_team_audit_log`, with a seven-permission enum and an audit trail.

**And not one of those permissions is checked anywhere outside the module that defines them.** `grep -rn "business_members" apps/api/src` returns five hits, all inside `business-teams.routes.ts`. Membership grants a row in a table and nothing else.

Two concrete defects:

- `GET /api/business-teams/me` calls `ensureOwnerTeam()`, which throws `403 BUSINESS_ROLE_REQUIRED` unless `role === 'business'`. **A team member can never view the team they belong to.**
- Invitations email the raw token as body text ("Invitation token: …") with no accept link and no accept UI. The `/invites/accept` endpoint exists; nothing calls it.

---

## 7. Notifications

45 notification types are declared. Producers exist for roughly 30. The gaps are concentrated exactly where the new workflow lives: **there is no notification when a provider activates an award, when contact details unlock, when an MHC purchase is approved, when MHC runs low, or when a team invitation is sent in-app.**

`NOTIFICATION_NAVIGATION_MAP` routes all five `need_bid_*` types to `/app` — the 2,430-line home screen — rather than to the entity. Deep links are effectively "go to the app and find it yourself". See `06-notification-event-matrix.md`.

---

## 8. Is the repository launch-ready?

**No.** Typecheck, lint and unit tests are not the binding constraint here; there are ~50 test files and meaningful coverage of the money paths (`mhc.activation-race.test.ts`, `award-lifecycle.test.ts`, `contact-redaction.test.ts` are all real tests of real invariants).

The binding constraints are:

1. **Dead customer-facing financial interfaces.** Header pill shows a frozen EGP balance to every role; "+" opens an empty deposit modal; withdrawal forms render for roles that can never withdraw.
2. **Two revenue features are structurally broken** (ads, paid plans) because they debit a frozen wallet.
3. **The workflow does not complete.** No milestones, no deliverables, no completion, no reviews for the need→bid path.
4. **Businesses cannot buy.** The role model forbids it.
5. **Support fragmentation.** Users must self-classify into a taxonomy built for the engineering team.

None of these require re-architecting. Items 1 and 2 are contained; item 3 is additive; item 4 is the only one needing a genuine schema decision.

---

## 9. Recommended shape of the launch

**Keep untouched (class 1):** MHC ledger, activation gate, contact redaction, provider payment disclosure, needs/bids through activation, services catalogue, reservations, negotiations, reviews-on-reservations, verification, admin RBAC, employment jobs, business team schema.

**Integrate (class 2 — working but poorly connected):** MHC screen into navigation, analytics into its own route, award-offer card onto the provider dashboard, calendar extended with workflow deadlines, notification deep links pointed at entities.

**Repair (class 5 — broken):** ads and plans debiting a frozen wallet, withdrawal and deposit surfaces, reviews after a need-job, team members locked out of their own team.

**Build (class 6 — missing):** bid-submission fee, need-side milestones/deliverables/completion, unified Help & Resolution Center, workspace model, central entitlement service.

**Hide behind route + API guards — never delete:** EGP wallet UI, deposits, withdrawals, escrow, commission.

### On deferral

The audit brief asked that physical products and employment jobs be reported as deferred future modules. Applying the classification rule — *grade before deciding* — the two cases are not alike:

- **Employment jobs: class 1, fully built.** A complete hiring subsystem: salary ranges, CV uploads, interview scheduling via reservations, seven application states, milestones, messaging. Only its milestone escrow settlement is broken (frozen wallet). **Hiding it is a product decision, not an audit conclusion.** The audit recommends giving it an honest name ("Hiring"), a navigation entry, and an escrow repair. If it is then scoped out, that is a deliberate call implemented with a flag and guards at both route and API layers.
- **Goods / products: class 6 — implementation not located.** See §11.

**Genuinely deferred:** integrated payments, split settlement, automated commission, escrow re-enablement, complex custom business permission matrices (enforce the built-in roles first).

---

## 10. Taxonomy is a proposal, not a decision

The brief proposed collapsing the marketplace to four surfaces. `04-marketplace-workflow-audit.md` §3 evaluates that rather than assuming it, and reaches a different recommendation.

Six distinct transaction types exist. They are **not duplicates** — a hiring post with a salary range, CV and interview does not map onto a need. The incoherence users experience is largely a **labelling** problem:

- `/app/projects` shows employment jobs; actual projects live under `/app`
- `/app/services` is the provider's own catalogue, not browsing
- `/app/browse` is a dead redirect
- "bid" / "proposal" / "application" name one thing; "reservation" / "booking" / "order" name another

**Recommended: Option A — rename and re-route.** Keeps all six types, no schema change, no feature loss, complexity *small*. Option B (collapse to four) requires either hiding a class-1 subsystem or forcing it into an abstraction that does not fit, complexity *large*, with real risk of breaking working code.

---

## 11. Open question blocking the taxonomy decision

An end-to-end audit of a reported **goods / products** capability in My Services **did not locate an implementation**. Searched: the `services` schema and every `ALTER TABLE services`; the shared `Service`, `CreateServiceBody` and `ServiceSearchResult` types; `createServiceSchema` / `updateServiceSchema`; the creation form in `services-screen.tsx`; all twelve seeded categories; and repo-wide terms (`product`, `goods`, `listing_type`, `item_type`, `stock`, `inventory`, `shipping`, `منتج`) across all five local branches, four remote branches and both stashes.

The only `product`-named code is `product-growth.ts` (notification preferences) and `phase2_5-product-value` (saved searches, favorites) — "product" in the software sense.

**This classification is provisional** and recorded as `D-02 / needs_reaudit` in `backlog.json`. **No taxonomy decision should be made until it is resolved.** If the capability exists under a name not covered above, it needs a full end-to-end audit — schema, API, creation form, search results, ordering flow, provider dashboard, customer experience and permissions — before any recommendation.

---

## 12. What cannot be protected without integrated payments

Stated plainly so it is not over-promised in marketing copy or in the dispute UI:

Because the platform never holds job money, **a dispute cannot recover funds.** What the platform can genuinely offer is *evidence and consequence*: an approval history, a message record, deliverable timestamps, verified identities, and a rating that follows the offending party. That is worth something — but it must be described as such. See `04-marketplace-workflow-audit.md` §7.

---

## Reading order

| File | Answers |
|---|---|
| `01-current-architecture-map.md` | What exists, where |
| `02-role-workspace-permission-matrix.md` | Who can do what; the workspace proposal |
| `03-financial-mhc-audit.md` | Money, credits, and the safe deprecation plan |
| `04-marketplace-workflow-audit.md` | The end-to-end workflow gaps |
| `05-support-dispute-unification.md` | Help & Resolution Center design |
| `06-notification-event-matrix.md` | Event → notification matrix |
| `07-search-dashboard-navigation-audit.md` | Search, dashboards, sidebars |
| `08-business-team-admin-rbac-audit.md` | Teams and internal staff |
| `09-prioritized-backlog.md` | P0–P2 and deferred, with full metadata |
| `10-safe-implementation-plan.md` | Sequencing and migration safety |
| `11-acceptance-tests.md` | How to verify each change |
| `12-capability-classification.md` | **Every capability graded 1–6, including the My Services end-to-end audit** |
| `backlog.json` | Machine-readable backlog (35 fully specified items) |

**Suggested entry point:** read `12` first. It states what is working before anything states what is wrong.
