# Card payment status

Stripe is intentionally not integrated or enabled in MohandisHub.

- The repository contains no Stripe SDK, client, credentials, webhook handler, or live checkout UI.
- The legacy `/api/wallet/deposit/stripe` and
  `/api/wallet/deposit/confirm-stripe` aliases remain only for backward
  compatibility. Both return HTTP 503 with code `STRIPE_DISABLED` and make no
  provider call or wallet mutation.
- Card, Paymob, InstaPay, and other unfinished payment rails are protected by
  server-side feature flags that default to disabled.
- Staging permits only explicitly configured NOWPayments crypto sandbox
  deposits. Production activation of any additional rail requires a separate
  approved release.

Do not add provider credentials or activation instructions to this repository
without an approved payment-integration change and its security review.
