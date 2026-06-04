# E2E runbook

- **Tool:** Playwright in `apps/e2e`. Run with `npm run e2e` from repo root (or `npm run e2e` inside `apps/e2e`).
- **Base URL:** Set `PLAYWRIGHT_BASE_URL` or `BASE_URL` to the web app URL (e.g. staging `https://staging.mohandishub.app`). Default is `http://localhost:3000` for local runs.
- **Local:** Start web and API (`npm run dev`), then in another terminal run `npm run e2e`.
- **CI:** GitHub Actions runs e2e when secret `STAGING_WEB_URL` is set. All 5 must-pass journeys run on every deploy to staging.

## 5 must-pass journeys

1. **Auth + onboarding** — Auth page loads; login/register visible; home links to auth/onboarding.
2. **Customer need to expert engagement** — App and browse/needs entry points load (gated by auth).
3. **Reservation / booking lifecycle** — Bookings and calendar routes load.
4. **Admin verification flow** — Admin route loads (gated by auth).
5. **Wallet / payment flow** — Wallet/settings routes load.

Deep flows (full login, create need, place bid, create reservation, admin approve, wallet deposit) can be added to the same specs; use test/staging API and DB for stability.

## Phase 2 money checks

`apps/e2e/specs/06-real-money-sandbox.spec.ts` contains 4 extra money-safety checks. They are skipped by default because they must not run against production accounts or production payment credentials.

What they check:

1. A customer can start a NOWPayments checkout from the wallet.
2. A paid reservation creates a wallet hold and can be cleaned up.
3. Wallet withdrawal/admin manual money screens are reachable.
4. A money-only admin can reach money controls but cannot reach unrelated admin areas.

Where to put the setup:

1. Copy `apps/e2e/.env.example` to `apps/e2e/.env.local`.
2. Fill it with staging values only.
3. Run `npm run e2e` from the repo root.

Required variables:

- `E2E_API_BASE_URL`
- `E2E_CUSTOMER_EMAIL`, `E2E_CUSTOMER_PASSWORD`
- `E2E_PROVIDER_EMAIL`, `E2E_PROVIDER_PASSWORD`
- `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`
- `E2E_SCOPED_ADMIN_EMAIL`, `E2E_SCOPED_ADMIN_PASSWORD`
- Optional: `E2E_SANDBOX_PAY_CURRENCY` (default `USDTTRC20`; name is historical)

Where to get those values:

- `PLAYWRIGHT_BASE_URL`: your staging web app URL.
- `E2E_API_BASE_URL`: your staging API URL.
- Customer/provider/admin emails and passwords: create normal staging users for the test suite. Do not use real customer accounts.
- Scoped admin: create one staging admin with only `manage_transactions`. This proves money admins cannot access support/media/admin areas they should not.
- `E2E_SANDBOX_PAY_CURRENCY`: use the NOWPayments currency you want the suite to request, usually `USDTTRC20`.

Required for the paid reservation hold test:

- `E2E_PAID_PROVIDER_ID`
- `E2E_PAID_SERVICE_ID`
- `E2E_PAID_SLOT_ID`
- Optional: `E2E_PAID_RESERVATION_MODE` (`online` by default)
- Optional: `E2E_PAID_RESERVATION_ONLINE_TYPE` (`voice` by default)

The paid reservation fixture must point to an active paid service and an available future slot for the provider. The customer account must have enough staging wallet balance to create the fixed-price hold. The test cancels the created reservation after asserting the hold.

Where to get the paid reservation IDs:

- `E2E_PAID_PROVIDER_ID`: the staging provider user's id.
- `E2E_PAID_SERVICE_ID`: an active paid service owned by that provider.
- `E2E_PAID_SLOT_ID`: a future available slot for that provider/service.

You can get these from the staging database/admin panel after creating the provider, service, and slot.

The scoped admin account is expected to have `manage_transactions` only for this suite: reservation money endpoints should return `200`, while support and media admin endpoints should return `403`.

Use only staging test accounts. Do not run this automated suite with production customer credentials.

## Manual live payment smoke

If you do not have a NOWPayments sandbox, do not put production payment credentials into Playwright. Use the manual live checklist in `docs/NOWPAYMENTS_RUNBOOK.md` with a platform-owned account and a small amount. That manual pass replaces only the payment-provider proof; the normal 5 browser journeys above must still pass automatically.
