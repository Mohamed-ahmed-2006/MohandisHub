# 01 — Current Architecture Map

Every row below was verified by reading the file, not inferred from naming.

---

## 1. Repository shape

```
apps/api        Express + TypeScript, module-per-domain (routes → controller → service → repository)
apps/web        Next.js 15 App Router, [locale] segment (en | ar), CSS files per component
apps/e2e        Playwright, 6 specs
packages/shared Types + pure logic shared by API and web
supabase/migrations  103 SQL migrations, forward-only, idempotent style (IF NOT EXISTS / DO $$)
```

API module convention: `*.routes.ts` → `*.controller.ts` → `*.service.ts` → `*.repository.ts`, with `*.validation.ts` (zod) and `*.types.ts`. Two modules break it: `business-teams` (everything in `business-teams.routes.ts`, 520 lines) and `operations` (routes only).

---

## 2. API surface (`apps/api/src/routes/index.ts`)

| Mount                     | Router                | Auth posture                                                |
| ------------------------- | --------------------- | ----------------------------------------------------------- |
| `/api/app`                | app                   | public status                                               |
| `/api/auth`               | auth                  | `authRateLimiter`                                           |
| `/api/otp`                | otp                   | `authRateLimiter`                                           |
| `/api/users`              | users                 | authenticate                                                |
| `/api/profiles`           | profiles              | authenticate                                                |
| `/api/recommendations`    | recommendations       | authenticate                                                |
| `/api/admin`              | admin                 | authenticate + `loadAdminFromDb` + `requireAdminPermission` |
| `/api/analytics`          | analytics             | `requireRole('expert','business','craftsman')`              |
| `/api/advertisements`     | advertisements        | authenticate                                                |
| `/api/support`            | support               | authenticate + emailVerified                                |
| `/api/services`           | services              | mixed public/auth                                           |
| `/api/wallet`             | wallet                | authenticate + emailVerified                                |
| `/api/credits`            | **mhc**               | authenticate + emailVerified                                |
| `/api/provider-payments`  | provider-payments     | authenticate                                                |
| `/api/chat`               | chat                  | authenticate                                                |
| `/api/coupons`            | coupons               | authenticate                                                |
| `/api/favorites`          | favorites             | authenticate                                                |
| `/api/verification`       | verification          | authenticate                                                |
| `/api/upload`             | upload                | authenticate                                                |
| `/api/plans`              | plans                 | authenticate                                                |
| `/api/negotiations`       | negotiations          | authenticate                                                |
| `/api/needs`, `/api/bids` | needs                 | authenticate + emailVerified (+ `requireVerified` to bid)   |
| `/api/reservations`       | reservations          | authenticate                                                |
| `/api/reviews`            | reviews               | authenticate                                                |
| `/api/saved-searches`     | saved-searches        | authenticate                                                |
| `/api/jobs`               | jobs (**employment**) | authenticate                                                |
| `/api/notifications`      | notifications         | authenticate                                                |
| `/api/geo`, `/api/media`  | geo, media            | mixed                                                       |
| `/api/business-teams`     | business-teams        | authenticate + emailVerified                                |

**Naming trap:** the MHC router is mounted at `/api/credits`, not `/api/mhc`. Anyone grepping for `/mhc` in HTTP paths will find nothing.

Webhooks bypass `express.json()` and are registered directly in `app.ts` with `express.raw()` for signature verification: three NOWPayments wallet IPNs, one NOWPayments **credits** IPN (`/api/credits/nowpayments/ipn`), one Paymob webhook. The separation of the credit IPN from the wallet IPN is deliberate and correct.

---

## 3. Frontend routes (`apps/web/app/[locale]/`)

| Route                  | Component                          | In sidebar?                                          |
| ---------------------- | ---------------------------------- | ---------------------------------------------------- |
| `/app`                 | `AppHomeScreen` (2,430 lines)      | ✅                                                   |
| `/app/bookings`        | `BookingsScreen` (1,699 lines)     | ✅                                                   |
| `/app/disputes`        | `DisputesScreen`                   | ✅                                                   |
| `/app/services`        | `ServicesScreen`                   | ✅ providers only                                    |
| `/app/negotiations`    | `NegotiationsScreen`               | ✅ providers only                                    |
| `/app/advertisements`  | `MyAdsScreen`                      | ✅ providers only                                    |
| `/app/calendar`        | `CalendarScreen`                   | ✅ providers only                                    |
| `/app/settings`        | settings                           | ✅                                                   |
| `/app/settings/wallet` | `WalletSettingsScreen`             | ❌ (linked from pill + notifications)                |
| `/app/chat`            | `ChatScreen`                       | ✅                                                   |
| `/app/history`         | `HistoryScreen`                    | ✅                                                   |
| `/app/support`         | `SupportScreen`                    | ✅                                                   |
| `/app/plan`            | `MyPlanScreen`                     | ✅ (unless `featurePlansEnabled === false`)          |
| `/app/admin`           | `AdminPanel`                       | ✅ admins only                                       |
| `/app/profile`         | `ProfileScreen`                    | ❌ **orphan from sidebar** — reached via avatar menu |
| `/app/projects`        | `ProjectsScreen` → employment jobs | ❌ **orphan from sidebar**                           |
| `/app/browse`          | redirect → `/app/services`         | ❌ dead route                                        |

**Two significant surfaces are unreachable from the sidebar:**

- `/app/profile` hosts `MhcCreditsScreen` (`profile-screen.tsx:928`). **The MHC balance and purchase surface — the entire launch revenue mechanism — lives inside the profile page and has no navigation entry.** Meanwhile the frozen EGP balance has a permanent pill in the header.
- `/app/projects` is the employment-jobs workspace and is not navigable.

`MANAGED_SIDEBAR_HREFS` (`packages/shared/src/app-settings.ts:6`) lets an admin hide sidebar entries. It lists 13 hrefs and does **not** include `/app/profile` or `/app/projects` — consistent with them not being sidebar items, but it means there is no admin control over them either.

---

## 4. Database — domain by domain

### 4.1 Identity and access

| Table                                                 | Key columns                                                                | Notes                                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `users`                                               | `primary_role`, `is_admin`, `admin_permissions[]`, `plan_id`, `deleted_at` | **One role per identity.** Admin is a flag + permission array, already orthogonal to role. |
| `otp_codes`, `password_reset_tokens`, `pending_email` | —                                                                          | Standard                                                                                   |
| `audit_log`                                           | migration `20260316000001`                                                 | Generic admin audit                                                                        |

### 4.2 Profiles

`expert_profiles`, `business_profiles`, `craftsman_profiles`, `customer` fields on `users`. Craftsman added late (`20260318000005_craftsman_role.sql`) — a common source of "expert OR craftsman" branching duplicated across the codebase.

### 4.3 Money (legacy EGP model)

| Table                 | Status                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `wallets`             | Extended with `account_type` (`money`\|`provider_credit`) and `asset_code` (`EGP`\|`MHC`). Unique on `(user_id, account_type)`. **All `money` rows frozen.** |
| `transactions`        | Shared ledger for EGP and MHC. MHC meaning carried by `wallets.asset_code` + `reference_type` + metadata; the `type` CHECK was deliberately not changed.     |
| `wallet_holds`        | Escrow holds. Used by `job_milestones` and withdrawals.                                                                                                      |
| `deposit_requests`    | Extended with `purpose` (`wallet_topup`\|`credit_purchase`), `target_account_type`, `credit_package_id`, `mhc_grant_amount`. **Dual-purpose table.**         |
| `withdrawal_requests` | All rails off                                                                                                                                                |
| `commission_settings` | Legacy percentage model                                                                                                                                      |

### 4.4 Money (MHC model)

| Table                          | Purpose                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `mhc_credit_packages`          | Admin-configurable; `mhc_amount` + `external_price_amount` + currency                                           |
| `mhc_action_prices`            | 7 seeded keys, `mhc_price` + `is_active`. **Only 2 are ever charged.**                                          |
| `mhc_job_activations`          | The gate record. Partial unique on `bid_id` (award) and `reservation_id` (booking) → idempotent by construction |
| `provider_payment_methods`     | `bank_transfer`\|`instapay`\|`mobile_wallet`; `details` JSONB is the sensitive part                             |
| `provider_payment_disclosures` | Audit: which customer saw which activation's details. Unique `(activation_id, customer_user_id)`                |

### 4.5 Marketplace — needs / bids (the RFP path)

| Table          | Notable columns                                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `needs`        | `status ∈ open, closed, awarded_pending_provider_acceptance, awarded, in_progress, completed`; `pending_award_bid_id`, `pending_award_expires_at`, **`activated_at`**                   |
| `bids`         | `status ∈ pending, awarded_pending, accepted, rejected, withdrawn, expired`; `award_offered_at/accepted_at/rejected_at/expired_at`; `paid_at`, `payment_transaction_id` (legacy escrow) |
| `bid_messages` | `contact_redacted` bool + `raw_content` (audit copy of pre-redaction text)                                                                                                              |

`needs.activated_at` is the single source of truth for "workspace unlocked", written in the same transaction as the MHC debit.

### 4.6 Marketplace — services / reservations (the booking path)

`services`, `reservation_profiles`, `reservation_slots`, `reservations`, `reservation_location_proposals`, `reservation_checkin_codes`, `reservation_call_sessions`, `reservation_call_participants`, `reservation_disputes`, plus `service_view_events` and aggregate triggers.

This is the most mature subsystem: check-in codes, Agora video calls, location proposals, a lifecycle worker, and a real dispute case file.

### 4.7 Employment jobs — **a separate product**

`jobs` (`salary_range`, `application_fee_amount`, `interview_enabled`), `job_applications` (`cv_file_url`, `profile_snapshot`, `interview_reservation_id`), `job_milestones` (+ `wallet_hold_id`, `commission_amount`, `provider_payout_amount`), `job_submissions`, `job_application_messages`.

This is a **hiring/recruitment module**, not project delivery. It has the only milestone implementation in the codebase, and that implementation is escrow-backed by the frozen wallet.

### 4.8 Support / disputes / reviews — three systems

| Table                                             | Scope                                                 | Links to       |
| ------------------------------------------------- | ----------------------------------------------------- | -------------- |
| `support_tickets` (+ `_messages`, `_attachments`) | Free text, `category ∈ bug, suggestion, error, other` | **Nothing**    |
| `reservation_disputes` (+ `_notes`, `_evidence`)  | Reservations only                                     | `reservations` |
| `review_reports`, review disputes                 | Reviews only                                          | `reviews`      |

### 4.9 Everything else

`plans` (+ `plan_subscriptions`, `plan_limits`, `user_plan_usage_counters`, `allowed_roles`), `notifications` (+ preferences, push subscriptions), `price_negotiations` (+ `_rounds`), `advertisements` (+ `advertisement_plans`, ad-center resolution, pricing overrides, scheduling), `business_teams` / `business_members` / `business_team_roles` / `business_team_invites` / `business_team_audit_log`, `coupons`, `favorites`, `saved_searches`, `conversations` / `messages`, `private_uploads` / `upload_object_registry`, `app_settings` (single row), retention governance tables.

---

## 5. Cross-cutting mechanisms

### 5.1 `app_settings` — a single-row global config

Feature flags: `featureNeedsEnabled`, `featurePlansEnabled`, `featureWalletEnabled`, `featureHourlyPricingEnabled`.
Kill switches: `depositsPaused`, `moneyMovementsPaused`, `pausePlanSubscriptions`, `mhc_activation_gate_enabled`, `block_precontact_sharing`.
Config: `payment_methods_enabled` JSONB, `award_acceptance_expiry_hours`, `sidebar_hidden_hrefs`, withdrawal limits, FX rates.

**Note a deliberate and important subtlety:** `isPaymentMethodEnabled` is fail-**open** for unknown keys; `isPaymentMethodEnabledStrict` is fail-**closed** and must be used for `LAUNCH_RETIRED_PAYMENT_METHOD_KEYS`. This distinction is documented in the source and is correct. Any new code touching retired rails must use the strict variant.

### 5.2 Authorization layers

1. `authenticate` — JWT
2. `requireEmailVerified`
3. `requireVerified` — KYC (bidding)
4. `requireRole(...roles)` — `primary_role`, with an `'admin'` special case that checks `isAdmin`
5. `loadAdminFromDb` — re-reads `is_admin` + `admin_permissions` per request (avoids stale JWT)
6. `requireAdminPermission` / `requireAdminAnyPermission` — `super_admin` implies all
7. `ActivationGateService.assertAwardActivated` — the 402 paywall
8. `usage-quota.service.ts` — `withActionLock` for plan quotas

Layer 7 is the newest and the only one that guards data disclosure rather than actions.

### 5.3 Real-time

Socket.IO (`chat.socket.ts`, `socket-instance.ts`). Notifications are emitted over the same socket. `AppShell` joins `join_user` and toasts every `notification` event; `AppSidebar` maintains five independent unread booleans by prefix-matching notification type strings — a fragile, duplicated dispatch (`app-sidebar.tsx:44-88`).

### 5.4 i18n

`en` / `ar` dictionaries as TypeScript objects, `[locale]` route segment, `validate-i18n.mjs` in CI. RTL handled with logical CSS properties. Some user-facing strings are **hardcoded English in components** rather than dictionary keys — e.g. `wallet-settings-screen.tsx:29-48` (`formatStatus`), `wallet-deposit-modal.tsx` fallback errors, `projects-screen.tsx` empty state (inline `locale === 'ar' ? … : …`).

---

## 6. Dead, orphaned, and unused

### Dead UI (renders, but the action cannot succeed)

- Header "+" deposit button → `WalletDepositModal` → every rail `false` → "No deposit methods are currently available."
- Withdrawal form in `WalletSettingsScreen` — `canWithdraw` is true for all four roles; `anyWithdrawMethod` is false, so the form is suppressed but the **section, history list, and heading still render**.
- Advertisement creation with `pricePerDay > 0` → debits a frozen wallet → fails.
- Plan subscription for a priced plan → same.

### Orphaned routes

- `/app/browse` — pure redirect to `/app/services`.
- `/app/projects` — not in sidebar.
- `/app/profile` — not in sidebar (hosts MHC).

### Unused backend capability

- `mhc_action_prices`: `subscription_upgrade`, `advertisement`, `service_promotion`, `featured_provider`, `promoted_proposal` — seeded, priced, never read.
- `business_team_roles.permissions` — seven permissions, zero enforcement outside the module.
- `PlanLimits.maxTeamSlots`, `canBusinessFeatured`, `canPriorityListing` — defined, validated by zod, never enforced.
- `POST /api/needs/:id/bids/:bidId/pay` — correctly fenced behind fail-closed `escrow_bid_payment`, returns `410 ESCROW_PAYMENTS_RETIRED`. **This one is handled well** and is the model to copy for other deprecations.

### Conflicting business logic

- `canRequestWithdrawal()` returns `true` for all four roles while every withdrawal rail is off.
- `NOTIFICATION_NAVIGATION_MAP` deep-links five wallet notification types to `/app/settings/wallet`, a screen that should be retired.
- `computeCommissionSplit()` in `packages/shared/src/wallet.ts` implements a commission model the launch product has abandoned; still exported and imported.

### Inconsistent terminology

| Concept                         | Names in use                          |
| ------------------------------- | ------------------------------------- |
| A customer's posted requirement | need, RFP, project, request           |
| A provider's response           | bid, proposal, application            |
| A hiring post                   | job, project, hiring post             |
| A service booking               | reservation, booking, order           |
| MHC                             | MHC, credits, نقطة, platform credits  |
| Provider                        | expert, craftsman, business, provider |

`/app/projects` showing employment jobs, while actual projects live under `/app`, is the worst instance.

---

## 7. Test coverage map

| Area                 | Tests                                                               | Verdict                  |
| -------------------- | ------------------------------------------------------------------- | ------------------------ |
| MHC race safety      | `mhc.activation-race.test.ts`                                       | Strong                   |
| Award lifecycle      | `award-lifecycle.test.ts`                                           | Strong                   |
| Contact redaction    | `contact-redaction.test.ts`                                         | Strong                   |
| Chat access gate     | `chat-access.test.ts`, `needs.bid-chat-gate.test.ts`                | Strong                   |
| Money controls       | `phase2-money-controls.test.ts`, `phase4-marketplace-money.test.ts` | Legacy model             |
| Auth                 | 3 files                                                             | Adequate                 |
| Plans                | `plans.service.test.ts`                                             | Limits only              |
| **Notifications**    | `notifications.demo.test.ts` only                                   | **Effectively untested** |
| **Business teams**   | none                                                                | **Untested**             |
| **Support/disputes** | none                                                                | **Untested**             |
| **Search**           | none                                                                | **Untested**             |
| **Entitlements**     | none                                                                | **Untested**             |

The tests are concentrated exactly on the newest, best-built subsystem, and absent exactly where this audit finds the most defects.
