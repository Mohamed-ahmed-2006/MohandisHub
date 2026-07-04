# OTP / Email runbook

- **Provider:** Set `OTP_EMAIL_PROVIDER=resend` in production. Default `console` logs to stdout only and is blocked when `NODE_ENV=production`.
- **Resend:** Set `RESEND_API_KEY` and `EMAIL_FROM`. Use a verified sender such as `MohandisHub <otp@mail.mohandishub.app>`.
- **Brevo:** Still available as a legacy optional provider with `OTP_EMAIL_PROVIDER=brevo` and `BREVO_API_KEY`, but it is no longer the production launch path.
- **SendGrid:** Not launch-ready in this repo. `OTP_EMAIL_PROVIDER=sendgrid` is blocked in production until the sender implementation is completed and tested.
- **Flows:** Password reset and verify-email use this pipeline. Test both after configuring.
