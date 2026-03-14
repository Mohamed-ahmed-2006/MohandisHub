# NOWPayments runbook (deposits + withdrawals)

- **Launch:** NOWPayments is the current path for deposits and withdrawals. Stripe, Cryptomus, Paymob can be added later.
- **Deposits:** Set `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`. Configure IPN URL in NOWPayments dashboard to `https://<API_PUBLIC_URL>/api/wallet/nowpayments/ipn` (and deposit/payout endpoints if separate). Idempotency and error handling are implemented; ensure webhook URL is correct and secret matches.
- **Withdrawals:** Set `NOWPAYMENTS_WITHDRAWALS_ENABLED=true`, and auth for payout APIs: `NOWPAYMENTS_AUTH_EMAIL`, `NOWPAYMENTS_AUTH_PASSWORD`. IPN for payout status: use same or dedicated payout IPN URL. Document min amount (`NOWPAYMENTS_WITHDRAWAL_MIN_AMOUNT`), default currency (`NOWPAYMENTS_WITHDRAWAL_DEFAULT_CURRENCY`), and manual verification if used (`NOWPAYMENTS_MANUAL_PAYOUT_VERIFY`).
