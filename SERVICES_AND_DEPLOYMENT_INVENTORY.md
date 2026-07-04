# Services And Deployment Inventory

Date: 2026-07-04

Scope: repo-only service/deployment inventory. I did not read real local secret files. Required environment values below are intentionally redacted.

## Summary

The project depends on a Vercel-hosted Next.js web app, a Render-hosted API and worker, Supabase/Postgres plus Supabase Storage, Resend email, Didit KYC, NOWPayments wallet payments, Agora online calls, Sentry error reporting, and optional/disabled payment or messaging integrations.

Production readiness depends as much on provider dashboard setup as on code. Before testers, manually confirm every active service is live, verified, unpaused, and using production-safe env vars.

## Inventory

### Vercel

- Service name: Vercel.
- Where it appears: `apps/web/vercel.json`, `apps/web/package.json`, `apps/web/app/layout.tsx`, `apps/web/components/speed-insights-client.tsx`, `docs/DEPLOYMENT_RUNBOOK.md`.
- Used for: Next.js web deployment and Vercel Speed Insights.
- Required env vars, redacted: `NEXT_PUBLIC_API_URL=[redacted]`, `API_INTERNAL_URL=[redacted]`, `NEXT_PUBLIC_AUTH_SAME_ORIGIN=[redacted optional]`, `NEXT_PUBLIC_AGORA_APP_ID=[redacted optional for calls]`, `NEXT_PUBLIC_NOWPAYMENTS_FIAT_ENABLED=[redacted optional]`, `NEXT_PUBLIC_PAYMOB_ENABLED=[redacted optional]`.
- Required for local dev: No, local Next can run without Vercel.
- Required for production: Yes, if Vercel is the production web host.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page.
- Manual dashboard checks: production project points at `apps/web`; env vars are production values; domain `mohandishub.app` is attached with valid SSL; latest deployment is live; build command matches `apps/web/vercel.json`.
- What can fail during tester usage: web deployment can point to wrong API URL, missing same-origin rewrite target, missing Agora public ID, wrong domain, or stale deployment.
- Suggested backup/alternative: Render static/web service, Netlify, Cloudflare Pages, or self-hosted Next deployment.
- Confidence: High.

### Render

- Service name: Render.
- Where it appears: `render.yaml`, `docs/DEPLOYMENT_RUNBOOK.md`, `docs/PRODUCTION_RUNBOOK.md`.
- Used for: API web service `mohandishub-api` and worker service `mohandishub-worker`.
- Required env vars, redacted: `DATABASE_URL=[redacted]`, `CORS_ORIGIN=[redacted]`, `CORS_EXTRA_ORIGINS=[redacted optional]`, `API_PUBLIC_URL=[redacted]`, `WEB_PUBLIC_URL=[redacted]`, `JWT_SECRET=[redacted]`, `JWT_REFRESH_SECRET=[redacted]`, plus service-specific vars listed below.
- Required for local dev: No.
- Required for production: Yes, if Render is the production API/worker host.
- Free-tier/quota/activation risks: `render.yaml` uses `plan: starter`; current pricing/limits must be verified from provider dashboard/current pricing page. Confirm whether services sleep, cold-start, throttle builds, or require paid plan for always-on API/worker.
- Manual dashboard checks: both API and worker deployed; worker is not accidentally configured as a web service; health endpoint works; logs show no boot env validation failure; custom API domain `api.mohandishub.app` is attached; CORS matches the Vercel domain.
- What can fail during tester usage: sleeping/cold service, missing worker lifecycle sweeps, wrong env var on worker, failed build, bad CORS, failed health check, unprocessed reservations/retention tasks.
- Suggested backup/alternative: Fly.io, Railway, DigitalOcean App Platform, AWS ECS/App Runner.
- Confidence: High.

### Supabase PostgreSQL And Storage

- Service name: Supabase.
- Where it appears: `supabase/config.toml`, `supabase/migrations/*`, `apps/api/src/db/*`, `apps/api/src/config/env.ts`, `apps/api/src/modules/upload/*`, `apps/api/src/middleware/public-uploads.ts`, `render.yaml`, `.github/workflows/ci.yml`, deployment docs.
- Used for: Postgres database, migrations, storage buckets `uploads` and `verification-docs`, optional backup provider, local Supabase Studio/Inbucket.
- Required env vars, redacted: `DATABASE_URL=[redacted]`, `SUPABASE_URL=[redacted]`, `SUPABASE_SERVICE_ROLE_KEY=[redacted]`, `BACKUP_PROVIDER=[redacted optional]`, `BACKUP_SUPABASE_PROJECT_REF=[redacted optional]`, `BACKUP_SUPABASE_ACCESS_TOKEN=[redacted optional]`.
- Required for local dev: Yes for realistic DB-backed flows; local Supabase can be used.
- Required for production: Yes.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page. Check project pause status, database size, storage quotas, bandwidth, connection limits, backup/PITR availability, and email/local studio settings if used.
- Manual dashboard checks: project active and not paused; migrations applied; RLS/storage policies match backend-only assumptions; `uploads` bucket public only as intended; `verification-docs` is private; service-role key only exists on API/worker; backups/PITR configured if required.
- What can fail during tester usage: missing migrations, paused project, service-role key missing, storage buckets missing, private upload preview failure, local reset failure due missing `supabase/seed.sql`.
- Suggested backup/alternative: Neon/Supabase-compatible Postgres plus S3/R2 for uploads; managed Postgres plus object storage.
- Confidence: High.

### Resend

- Service name: Resend.
- Where it appears: `apps/api/src/modules/otp/otp.provider.ts`, `apps/api/src/modules/auth/auth.service.ts`, `apps/api/src/utils/send-transactional-email.ts`, `apps/api/src/utils/resend-email.ts`, `apps/api/.env.example`, `render.yaml`, `docs/OTP_EMAIL_RUNBOOK.md`.
- Used for: email OTP/verification codes, password reset emails, shared transactional emails from profiles, business teams, and notifications.
- Required env vars, redacted: `OTP_EMAIL_PROVIDER=resend`, `RESEND_API_KEY=[redacted]`, `EMAIL_FROM=[redacted]`, `EMAIL_LOGO_URL=[redacted optional]`.
- Required for local dev: No, console email provider can be used.
- Required for production: Yes, if email verification/reset is enabled for testers.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page. Check sender/domain verification, daily sending limit, API status, suppression/bounce status.
- Where email sending happens:
  - OTP code email: `apps/api/src/modules/otp/otp.provider.ts:118`.
  - Password reset email: `apps/api/src/modules/auth/auth.service.ts:419`.
  - Shared transactional email: `apps/api/src/utils/send-transactional-email.ts:79`.
- Types of emails detected: verification/OTP code, password reset, business-team invitation, notification email, profile/verification status emails.
- Failure handling issues: OTP and reset flows surface send failures to the API caller; notification emails are fire-and-forget and log failures while in-app notification creation continues.
- Required sender/domain checks: `EMAIL_FROM` mailbox/domain must be verified in Resend; API key must have email sending permission; SPF/DKIM/DMARC should be verified for deliverability.
- What can fail during tester usage: signup verification email does not arrive, password reset does not arrive, Resend rate/quota blocks, unverified sender rejected, emails land in spam.
- Suggested backup/alternative options: legacy Brevo provider, Postmark, Mailgun, SendGrid, Amazon SES. Do not replace Resend automatically without a separate decision.
- Confidence: High.

### Didit

- Service name: Didit.
- Where it appears: `apps/api/src/modules/verification/verification.provider.ts`, `apps/api/src/modules/verification/verification.routes.ts`, `apps/api/src/modules/verification/verification.service.ts`, `apps/api/src/config/env.ts`, `render.yaml`, `docs/KYC_RUNBOOK.md`.
- Used for: KYC/identity verification sessions and webhooks.
- Required env vars, redacted: `VERIFICATION_PROVIDER=didit`, `DIDIT_API_KEY=[redacted]`, `DIDIT_WEBHOOK_SECRET=[redacted]`, `DIDIT_WORKFLOW_ID=[redacted]`, `DIDIT_BASE_URL=[redacted optional]`.
- Required for local dev: No, manual provider can be used.
- Required for production: Yes if KYC is active for testers.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page.
- Manual dashboard checks: workflow exists and is active; webhook points to `/api/verification/webhook`; webhook secret matches; callback/redirect domains match production; test and live modes are not mixed.
- What can fail during tester usage: KYC session creation fails, webhook signature mismatch, provider callback not delivered, user remains pending.
- Suggested backup/alternative: Manual verification fallback, Idenfy, Veriff, Sumsub.
- Confidence: High.

### Idenfy

- Service name: Idenfy.
- Where it appears: `apps/api/src/modules/verification/verification.provider.ts`, `apps/api/src/config/env.ts`.
- Used for: placeholder/alternate KYC provider.
- Required env vars, redacted: `IDENFY_API_KEY=[redacted optional]`, `IDENFY_API_SECRET=[redacted optional]`.
- Required for local dev: No.
- Required for production: No, unless `VERIFICATION_PROVIDER=idenfy`.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page if enabled.
- Manual dashboard checks: do not set `VERIFICATION_PROVIDER=idenfy` in production until implementation is complete.
- What can fail during tester usage: provider path is not fully implemented; webhook handling is marked not implemented.
- Suggested backup/alternative: Keep Didit or manual verification.
- Confidence: Medium.

### NOWPayments

- Service name: NOWPayments.
- Where it appears: `apps/api/src/lib/nowpayments.client.ts`, `apps/api/src/modules/wallet/*`, `apps/api/src/config/env.ts`, `render.yaml`, `docs/NOWPAYMENTS_RUNBOOK.md`, `docs/E2E_RUNBOOK.md`, `docs/DEPLOYMENT_RUNBOOK.md`.
- Used for: crypto wallet deposits, IPN callbacks, optional crypto withdrawals/mass payouts.
- Required env vars, redacted: `NOWPAYMENTS_API_KEY=[redacted]`, `NOWPAYMENTS_IPN_SECRET=[redacted]`, `NOWPAYMENTS_LIVE_REQUIRED=[redacted]`, `NOWPAYMENTS_WITHDRAWALS_ENABLED=[redacted]`, `NOWPAYMENTS_MASS_PAYOUTS_ENABLED=[redacted]`, `NOWPAYMENTS_AUTH_EMAIL=[redacted optional for payouts]`, `NOWPAYMENTS_AUTH_PASSWORD=[redacted optional for payouts]`, `NOWPAYMENTS_MANUAL_PAYOUT_VERIFY=[redacted]`, `NOWPAYMENTS_WITHDRAWAL_DEFAULT_CURRENCY=[redacted]`, `NOWPAYMENTS_ALLOWED_PAY_CURRENCIES=[redacted]`, `NOWPAYMENTS_FIAT_ENABLED=[redacted optional]`.
- Required for local dev: No, unless testing wallet payments.
- Required for production: Yes if crypto deposits/withdrawals are in the tester flow.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page. Check supported currencies, payout availability, KYC/account activation, IPN delivery limits, min deposit/withdrawal amounts.
- Manual dashboard checks: IPN callback URL is `https://<api-domain>/api/wallet/nowpayments/ipn`; IPN secret matches; API key is live; allowed currencies match admin settings; mass payouts enabled before crypto withdrawals are enabled.
- What can fail during tester usage: checkout cannot be created, IPN does not arrive, signature mismatch, deposit not credited, payout stuck awaiting manual provider verification.
- Suggested backup/alternative: Manual InstaPay deposit/withdrawal for early testing, Stripe/Paymob for card rails later, Coinbase Commerce or other crypto processor if needed.
- Confidence: High.

### Paymob

- Service name: Paymob.
- Where it appears: `apps/api/src/lib/paymob.client.ts`, `apps/api/src/modules/wallet/*`, `apps/api/src/modules/admin/admin.service.ts`, `apps/web/lib/admin/client.ts`, `apps/api/src/config/env.ts`, `render.yaml`, `docs/PRODUCTION_RUNBOOK.md`, `docs/DEPLOYMENT_RUNBOOK.md`, `docs/LAUNCH_SCOPE.md`.
- Used for: EGP card/wallet deposits and payout/disbursement path, currently documented as disabled until account activation/live keys are ready.
- Required env vars, redacted: `PAYMOB_SECRET_KEY=[redacted]`, `PAYMOB_PUBLIC_KEY=[redacted]`, `PAYMOB_HMAC_SECRET=[redacted]`, `PAYMOB_INTEGRATION_IDS=[redacted]`, `PAYMOB_DEPOSITS_ENABLED=[redacted]`, `PAYMOB_WITHDRAWALS_ENABLED=[redacted]`, `PAYMOB_PAYOUT_CLIENT_ID=[redacted optional]`, `PAYMOB_PAYOUT_CLIENT_SECRET=[redacted optional]`, `PAYMOB_PAYOUT_BASE_URL=[redacted optional]`, `NEXT_PUBLIC_PAYMOB_ENABLED=[redacted optional]`.
- Required for local dev: No.
- Required for production: No if Paymob remains disabled; yes if card deposits/payouts are enabled.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page. Account activation and live keys are specifically noted in docs as launch blockers.
- Manual dashboard checks: merchant account active; live secret/public/HMAC keys set; integration IDs correct; webhook URL points to `/api/wallet/paymob/webhook`; payout product active before withdrawals are enabled.
- What can fail during tester usage: card deposit hidden/disabled, checkout creation failure, HMAC mismatch, payout stuck if enabled before account/product activation.
- Suggested backup/alternative: Keep disabled for first testers; use NOWPayments and manual InstaPay; later use Stripe or another card processor if Paymob readiness is weak.
- Confidence: High.

### Stripe

- Service name: Stripe.
- Where it appears: `apps/api/src/lib/stripe.client.ts`, `apps/api/src/modules/wallet/wallet.routes.ts`, `apps/api/src/config/env.ts`, `render.yaml`, `apps/api/docs/STRIPE.md`, `docs/LOVABLE_APP_SPEC.md`.
- Used for: legacy card deposit route/client and documentation; current launch docs favor NOWPayments and Paymob.
- Required env vars, redacted: `STRIPE_SECRET_KEY=[redacted optional]`, `STRIPE_WEBHOOK_SECRET=[redacted optional]`, `STRIPE_PUBLISHABLE_KEY=[redacted optional]`.
- Required for local dev: No.
- Required for production: No unless legacy Stripe card route is intentionally enabled.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page.
- Manual dashboard checks: rotate/revoke committed test credentials; ensure no Stripe test keys are used in production; disable routes/UI if Stripe is not a launch provider.
- What can fail during tester usage: accidental use of legacy route, bad webhook secret, confusion between test/live credentials.
- Suggested backup/alternative: Keep disabled; use Paymob for EGP card rails when active, or choose Stripe later if market/account setup supports it.
- Confidence: High for presence, Medium for active usage.

### Cryptomus

- Service name: Cryptomus.
- Where it appears: `apps/api/src/lib/cryptomus.client.ts`, `apps/api/src/config/env.ts`, wallet repository fields, `docs/LOVABLE_APP_SPEC.md`.
- Used for: legacy/alternate crypto payment client and fields.
- Required env vars, redacted: `CRYPTOMUS_MERCHANT_ID=[redacted optional]`, `CRYPTOMUS_API_KEY=[redacted optional]`, `CRYPTOMUS_WEBHOOK_KEY=[redacted optional]`.
- Required for local dev: No.
- Required for production: No unless this legacy/alternate crypto path is enabled.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page.
- Manual dashboard checks: leave unset unless intentionally launching Cryptomus; confirm no UI links point to it.
- What can fail during tester usage: confusing dormant code path if accidentally exposed.
- Suggested backup/alternative: NOWPayments is the documented current crypto path.
- Confidence: Medium.

### Agora

- Service name: Agora.
- Where it appears: `apps/api/src/lib/agora-token.ts`, `apps/api/src/modules/reservations/reservations.service.ts`, `apps/web/components/app/online-call-modal.tsx`, `apps/api/src/config/env.ts`, `apps/web/.env.example`, `render.yaml`, `docs/AGORA_RUNBOOK.md`.
- Used for: online voice/video reservation calls and RTC token generation.
- Required env vars, redacted: API `AGORA_APP_ID=[redacted]`, `AGORA_APP_CERTIFICATE=[redacted]`; web `NEXT_PUBLIC_AGORA_APP_ID=[redacted]`.
- Required for local dev: No unless testing calls.
- Required for production: Yes if online calls are in tester scope.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page.
- Manual dashboard checks: app ID and certificate match the same Agora project; certificate enabled; project active; quotas/billing OK; web public ID matches API token issuer.
- What can fail during tester usage: call modal shows `AGORA_NOT_CONFIGURED`, token creation fails, mic/camera permission issues, expired token renewal failure.
- Suggested backup/alternative: disable online call test cases or use external meeting links until RTC is confirmed.
- Confidence: High.

### Sentry

- Service name: Sentry.
- Where it appears: `apps/api/src/config/sentry.ts`, `apps/api/src/server.ts`, `apps/api/src/worker.ts`, `apps/api/src/middleware/error-handler.ts`, `render.yaml`, operations readiness routes/tests.
- Used for: API and worker error reporting.
- Required env vars, redacted: `SENTRY_DSN=[redacted]`.
- Required for local dev: No.
- Required for production: Strongly recommended; production env validation/tests indicate it is expected.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page.
- Manual dashboard checks: DSN valid; project receives test error; environment/release tags are useful; alert routing is configured.
- What can fail during tester usage: silent production errors if DSN missing, event quota exhausted, noisy untriaged errors.
- Suggested backup/alternative: Render logs plus another error tracker such as Rollbar, Bugsnag, or OpenTelemetry-based logging.
- Confidence: High.

### Web Push / VAPID

- Service name: Browser Web Push.
- Where it appears: `apps/api/src/modules/notifications/notifications.service.ts`, `apps/api/src/config/env.ts`, `apps/web/components/profile/profile-screen.tsx`.
- Used for: push notification subscriptions and delivery.
- Required env vars, redacted: `WEB_PUSH_ENABLED=[redacted optional]`, `WEB_PUSH_VAPID_PUBLIC_KEY=[redacted optional]`, `WEB_PUSH_VAPID_PRIVATE_KEY=[redacted optional]`, `WEB_PUSH_SUBJECT=[redacted optional]`.
- Required for local dev: No.
- Required for production: Optional unless push notifications are in tester scope.
- Free-tier/quota/activation risks: Browser/vendor dependent; must verify current browser support and delivery behavior.
- Manual dashboard checks: none, but keys must be generated and subject should be valid.
- What can fail during tester usage: push controls appear but delivery does not work if VAPID keys are missing or browser permission is denied.
- Suggested backup/alternative: in-app notifications and email notifications.
- Confidence: High.

### Twilio / HTTP SMS / Meta WhatsApp

- Service name: Twilio, generic HTTP SMS adapter, Meta WhatsApp.
- Where it appears: `apps/api/src/modules/otp/otp.provider.ts`, `apps/api/src/config/env.ts`.
- Used for: optional OTP delivery over SMS or WhatsApp.
- Required env vars, redacted: `OTP_SMS_PROVIDER=[redacted optional]`, `TWILIO_ACCOUNT_SID=[redacted optional]`, `TWILIO_AUTH_TOKEN=[redacted optional]`, `TWILIO_PHONE_NUMBER=[redacted optional]`, `SMS_HTTP_ENDPOINT=[redacted optional]`, `SMS_HTTP_API_KEY=[redacted optional]`, `SMS_HTTP_FROM=[redacted optional]`, `META_WHATSAPP_TOKEN=[redacted optional]`, `META_WHATSAPP_PHONE_NUMBER_ID=[redacted optional]`, `META_WHATSAPP_OTP_TEMPLATE=[redacted optional]`, `META_WHATSAPP_LANGUAGE=[redacted optional]`.
- Required for local dev: No.
- Required for production: No if email OTP is the only tester path.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page if enabled.
- Manual dashboard checks: keep disabled unless fully verified; confirm phone/template approvals and quotas if enabled.
- What can fail during tester usage: OTP send failure, template rejection, SMS/WhatsApp rate limits.
- Suggested backup/alternative: Resend email OTP.
- Confidence: Medium.

### SendGrid

- Service name: SendGrid.
- Where it appears: `apps/api/src/modules/otp/otp.provider.ts`, `apps/api/src/utils/send-transactional-email.ts`, `apps/api/src/config/env.ts`.
- Used for: placeholder alternate email provider.
- Required env vars, redacted: `SENDGRID_API_KEY=[redacted optional]`.
- Required for local dev: No.
- Required for production: No; code comments indicate SendGrid is blocked until implemented.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page if later enabled.
- Manual dashboard checks: do not set `OTP_EMAIL_PROVIDER=sendgrid` in production until implementation is complete.
- What can fail during tester usage: email sending throws not configured if selected.
- Suggested backup/alternative: Keep Resend active; Brevo remains optional legacy only.
- Confidence: High.

### GitHub Actions

- Service name: GitHub Actions.
- Where it appears: `.github/workflows/ci.yml`.
- Used for: CI, optional staging migrations, optional staging E2E.
- Required env vars/secrets, redacted: `STAGING_DATABASE_URL=[redacted optional]`, `STAGING_WEB_URL=[redacted optional]`.
- Required for local dev: No.
- Required for production: No at runtime, but important for release checks.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page.
- Manual dashboard checks: CI secrets set for staging if you expect migrations/E2E to run; branch protection uses passing checks if desired.
- What can fail during tester usage: unrun migrations or E2E gaps if CI secrets are absent.
- Suggested backup/alternative: local command checklist plus Render/Vercel dashboard checks.
- Confidence: High.

### Domain, DNS, SSL, And Email Domain

- Service name: Domain/DNS/SSL/email-domain dependencies.
- Where it appears: `render.yaml`, `docs/DEPLOYMENT_RUNBOOK.md`, `docs/PRODUCTION_RUNBOOK.md`, CORS/public URL env vars.
- Used for: `mohandishub.app`, `api.mohandishub.app`, optional `www`, CORS, auth refresh/logout trusted origin, webhook callback URLs, Resend sender domain.
- Required env vars, redacted: `CORS_ORIGIN=[redacted]`, `CORS_EXTRA_ORIGINS=[redacted optional]`, `API_PUBLIC_URL=[redacted]`, `WEB_PUBLIC_URL=[redacted]`, web API URL env vars.
- Required for local dev: No.
- Required for production: Yes.
- Free-tier/quota/activation risks: Must verify DNS/registrar/SSL provider status manually.
- Manual dashboard checks: DNS A/CNAME records correct; SSL valid on web and API; Resend sender/domain DNS verified; payment/KYC webhook URLs use final API domain.
- What can fail during tester usage: blocked CORS, failed cookies due domain mismatch, webhook callback to wrong host, email deliverability problems.
- Suggested backup/alternative: use provider preview domains for internal smoke only; use final custom domains for external testers.
- Confidence: High.

### Custom Backup HTTP Provider

- Service name: Custom HTTP backup provider.
- Where it appears: `apps/api/src/config/env.ts`, `apps/api/src/modules/operations/backup-restore.routes.ts`.
- Used for: optional operations backup/restore integration.
- Required env vars, redacted: `BACKUP_PROVIDER=[redacted optional]`, `BACKUP_CUSTOM_BASE_URL=[redacted optional]`, `BACKUP_CUSTOM_API_KEY=[redacted optional]`, `BACKUP_CUSTOM_LIST_PATH=[redacted optional]`, `BACKUP_CUSTOM_STATUS_PATH=[redacted optional]`, `BACKUP_CUSTOM_DRY_RUN_PATH=[redacted optional]`, `BACKUP_CUSTOM_RESTORE_PATH=[redacted optional]`.
- Required for local dev: No.
- Required for production: No if Supabase backup path is used.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page if used.
- Manual dashboard checks: only configure if there is an actual backup service behind it.
- What can fail during tester usage: admin operations backup page may show unavailable backup integration.
- Suggested backup/alternative: Supabase PITR/backups.
- Confidence: Medium.

### OpenAI / Supabase Studio AI And S3-Like Supabase Local Config

- Service name: OpenAI key for Supabase Studio AI, optional S3 env for Supabase local advanced storage.
- Where it appears: `supabase/config.toml`.
- Used for: local Supabase Studio AI helper and optional local Supabase S3/analytics/vector settings. No app runtime usage was detected.
- Required env vars, redacted: `OPENAI_API_KEY=[redacted local optional]`, `S3_HOST=[redacted optional]`, `S3_REGION=[redacted optional]`, `S3_ACCESS_KEY=[redacted optional]`, `S3_SECRET_KEY=[redacted optional]`.
- Required for local dev: No.
- Required for production: No app dependency detected.
- Free-tier/quota/activation risks: Must verify from provider dashboard/current pricing page if ever used.
- Manual dashboard checks: do not add production OpenAI/S3 keys unless a real feature requires them.
- What can fail during tester usage: no tester-facing failure expected.
- Suggested backup/alternative: not applicable.
- Confidence: Low for app relevance, High for config presence.

## Before Sending To Testers: Manual Dashboard Checklist

- [ ] Vercel deployment is live and using the correct production env vars.
- [ ] Vercel custom domain `mohandishub.app` has valid SSL.
- [ ] Vercel build uses `apps/web` root behavior from `apps/web/vercel.json`.
- [ ] Render API service is active, deployed, and health endpoint works.
- [ ] Render worker service is active and running the worker start command.
- [ ] Render API custom domain `api.mohandishub.app` has valid SSL.
- [ ] Render API and worker have the same required production env vars where needed.
- [ ] Supabase project is active, not paused, and migrations are applied.
- [ ] Supabase RLS/policies match backend-only assumptions.
- [ ] Supabase `uploads` and `verification-docs` buckets exist with intended public/private access.
- [ ] Supabase backups/PITR are enabled or consciously accepted as out of scope.
- [ ] Resend sender/domain is verified.
- [ ] Resend API key is active and transactional sending works.
- [ ] Email sending works in production for signup verification and password reset.
- [ ] Didit workflow is active and webhook URL/secret are correct.
- [ ] NOWPayments API key and IPN secret are active if wallet crypto deposits are in tester scope.
- [ ] NOWPayments IPN URL points to the production API domain.
- [ ] NOWPayments mass payouts are enabled only if crypto withdrawals are in tester scope.
- [ ] Paymob stays disabled unless live account, live keys, HMAC, and integrations are verified.
- [ ] Stripe committed test credentials have been rotated/revoked and docs are redacted.
- [ ] Agora app ID/certificate are active and web/API env vars match.
- [ ] Sentry receives errors from both API and worker.
- [ ] Production URL/callback URLs are correct for auth, KYC, payments, and emails.
- [ ] No test keys are used in production unless a provider is intentionally in sandbox for tester scope.
- [ ] No expired free trials, paused projects, disabled services, or exhausted quotas.
- [ ] Logs are checked after a full signup/login/main-flow test.

## Production Readiness Checks By Core Provider

### Render

- API and worker both deploy successfully.
- `DATABASE_URL`, JWT secrets, public URLs, CORS, Supabase, Resend, Sentry, KYC, and payment vars are set.
- Worker env is not missing service vars used by startup validation.
- Free-tier/sleep/build/runtime limits: Must verify from provider dashboard/current pricing page.
- Must manually activate/check before testers: service health, worker logs, custom domain, CORS.

### Vercel

- Web deployment points to the right API.
- Same-origin API rewrites work when configured.
- Public env vars match the final production domain and enabled services.
- Free-tier/build/bandwidth limits: Must verify from provider dashboard/current pricing page.
- Must manually activate/check before testers: latest deployment, domain, SSL, production env vars.

### Supabase

- Project active and not paused.
- Migrations applied.
- Storage buckets and backend-only policies correct.
- Backups/PITR and quotas checked.
- Free-tier/database/storage/bandwidth limits: Must verify from provider dashboard/current pricing page.
- Must manually activate/check before testers: database health, RLS/storage, service-role key only on backend.

### Resend

- Sender/domain verified.
- API key active.
- Email sending enabled.
- Signup OTP and password reset tested in production.
- Free-tier/email sending limits: Must verify from provider dashboard/current pricing page.
- Must manually activate/check before testers: sender verification, deliverability, suppression list.

## Repo Secret Handling Notes

- Real local env files detected but not tracked: `apps/api/.env`, `apps/web/.env.local`.
- Tracked env examples detected: `apps/api/.env.example`, `apps/web/.env.example`, `apps/e2e/.env.example`.
- `git ls-files` did not show real `.env` files tracked.
- Separate audit finding: `apps/api/docs/STRIPE.md` previously contained actual-looking Stripe test credentials. The working tree is redacted, but the exposed Stripe test values should still be rotated/revoked before external sharing.
