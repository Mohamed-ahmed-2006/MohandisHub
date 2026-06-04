# OTP / Email runbook

- **Provider:** Set `OTP_EMAIL_PROVIDER=brevo` in production. Default `console` logs to stdout only and is blocked when `NODE_ENV=production`.
- **Brevo:** Get API key from [Brevo → Settings → API Keys](https://app.brevo.com/settings/keys/api). Set `BREVO_API_KEY` and `EMAIL_FROM` (sender must be verified in Brevo: Senders & IP).
- **SendGrid:** Not launch-ready in this repo. `OTP_EMAIL_PROVIDER=sendgrid` is blocked in production until the sender implementation is completed and tested.
- **Flows:** Password reset and verify-email use this pipeline. Test both after configuring.
