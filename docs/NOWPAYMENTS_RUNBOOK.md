# NOWPayments runbook (deposits + withdrawals)

- **Launch:** NOWPayments is the current path for deposits and withdrawals. Stripe, Cryptomus, Paymob can be added later.
- **Deposits:** Set `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `API_PUBLIC_URL`, and `WEB_PUBLIC_URL`. Configure IPN URL in NOWPayments dashboard to `https://<API_PUBLIC_URL>/api/wallet/nowpayments/ipn`. Idempotency and error handling are implemented; ensure webhook URL is correct and secret matches.
- **Withdrawals:** To enable crypto payouts, set `NOWPAYMENTS_WITHDRAWALS_ENABLED=true`, `NOWPAYMENTS_MASS_PAYOUTS_ENABLED=true`, `NOWPAYMENTS_AUTH_EMAIL`, and `NOWPAYMENTS_AUTH_PASSWORD`. Keep `NOWPAYMENTS_MANUAL_PAYOUT_VERIFY=true` unless you intentionally want payouts to proceed without manual provider verification.
- **Launch defaults:** Admin settings default to NOWPayments crypto deposits on, InstaPay manual deposits/withdrawals on, and card deposits off. Admin can disable any method without code changes.
- **Future payment methods:** Add new rails to `PAYMENT_METHOD_DEFINITIONS` in `packages/shared/src/app-settings.ts`, then wire their API/client flow under `paymentMethodsEnabled`. Unknown keys are preserved so rollout can happen incrementally.

## Production env gate

Production startup fails when `NOWPAYMENTS_LIVE_REQUIRED=true` and the required live deposit settings are missing. Set it to `false` only if every NOWPayments method is disabled in admin settings before launch.

Required for live deposits:

- `NOWPAYMENTS_API_KEY`
- `NOWPAYMENTS_IPN_SECRET`
- `API_PUBLIC_URL`
- `WEB_PUBLIC_URL`

Required for live crypto withdrawals:

- `NOWPAYMENTS_WITHDRAWALS_ENABLED=true`
- `NOWPAYMENTS_MASS_PAYOUTS_ENABLED=true`
- `NOWPAYMENTS_AUTH_EMAIL`
- `NOWPAYMENTS_AUTH_PASSWORD`

Recommended:

- `NOWPAYMENTS_WITHDRAWAL_DEFAULT_CURRENCY=USDTTRC20`
- `NOWPAYMENTS_ALLOWED_PAY_CURRENCIES=USDTTRC20` until more currencies are intentionally supported.
- `NOWPAYMENTS_FIAT_ENABLED=false` and card deposits disabled in admin settings until a card provider is intentionally launched.

## Manual live smoke test

Use a platform-owned account and a small amount only. Do not use real customer accounts.

1. Confirm API health: `GET https://<api-domain>/health/ready` returns 200.
2. In admin settings, confirm wallet is enabled, deposits are not paused, `deposit_crypto` is on, `deposit_card` is off, and the min/max deposit limits allow the test amount.
3. Log in as the platform-owned customer account.
4. Open wallet settings and start a small crypto deposit using the allowed currency.
5. Confirm the NOWPayments checkout opens on a real NOWPayments URL.
6. Pay the invoice.
7. Wait for the NOWPayments IPN to credit the wallet.
8. Confirm the deposit request is no longer pending and the wallet balance/transaction receipt match the credited EGP amount.
9. If crypto withdrawals are enabled, log in as a platform-owned provider account, create a small withdrawal to your own payout address, complete any NOWPayments verification step, and confirm status reaches processing/finished or a clear blocked/failed status with funds held or returned.
10. After the test, withdraw or adjust the platform-owned wallet balance according to the finance/audit process.

Stop launch if any of these happen:

- Checkout creation returns `PAYMENT_UNAVAILABLE`, `INVALID_SIGNATURE`, or an untrusted return URL.
- NOWPayments IPN does not arrive at `https://<API_PUBLIC_URL>/api/wallet/nowpayments/ipn`.
- Wallet is credited more than once for the same order.
- A failed/expired payment credits the wallet.
- A withdrawal can start without the expected admin/provider verification policy.
