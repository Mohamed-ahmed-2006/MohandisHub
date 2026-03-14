# OTP / Email runbook

- **Provider:** Set `OTP_EMAIL_PROVIDER=brevo` (or `sendgrid`) in production. Default `console` logs to stdout only.
- **Brevo:** Get API key from [Brevo → Settings → API Keys](https://app.brevo.com/settings/keys/api). Set `BREVO_API_KEY` and `EMAIL_FROM` (sender must be verified in Brevo: Senders & IP).
- **SendGrid:** Set `OTP_EMAIL_PROVIDER=sendgrid`, `SENDGRID_API_KEY`, and `EMAIL_FROM` (verified sender).
- **Flows:** Password reset and verify-email use this pipeline. Test both after configuring.
