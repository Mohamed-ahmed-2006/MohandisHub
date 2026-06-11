# MohandisHub Production Runbook

## Required Pre-Deploy Checks

- Confirm production env values are set in Render or the hosting dashboard.
- Confirm `DATABASE_URL`, `API_PUBLIC_URL`, `WEB_PUBLIC_URL`, JWT secrets, Sentry DSN, email provider keys, verification provider keys, and Supabase service-role storage keys are present.
- Generate unique `JWT_SECRET` and `JWT_REFRESH_SECRET` values. Production startup rejects copied placeholder values and rejects using the same value for both secrets.
- Tune `DB_POOL_MAX` for the deployed database plan. The default is 10 connections per API/worker process; lower it if your Supabase plan has a small connection cap.
- Keep Paymob disabled until the account is active and live keys are available. Enable Paymob only after all Paymob env values are set.
- Run the full gate before release: typecheck, lint, tests, i18n validation, format check, build, and E2E smoke.

## Database Migration Safety

- Take a Supabase backup before production migrations.
- Run migrations only through `scripts/push-migrations.mjs`.
- For production-looking database URLs, set:

```bash
CONFIRM_PRODUCTION_MIGRATION=I_UNDERSTAND_RUN_PRODUCTION_MIGRATIONS
```

- If a migration changes money, auth, storage, or RLS behavior, run a staging dry run first.
- Do not run destructive manual SQL in production without a fresh backup and rollback notes.

## Backup And Rollback

- Before release, export the Supabase project backup from the dashboard.
- Keep a copy of the exact commit SHA and env change list used for the release.
- Roll back application code first if the issue is API/web-only.
- Restore the database backup only if data integrity is affected and the impact has been reviewed.

## Storage Posture

- Browser access to database tables is intentionally denied.
- Public files live in the `uploads` bucket and are browser-readable.
- Private/KYC files live in `verification-docs` and must be accessed through backend-mediated signed URLs only.
- Keep `RETENTION_UPLOADS_DAYS=0`. Production startup rejects this legacy global upload cleanup knob because safe cleanup needs table references. Use the category-specific retention settings for verification codes, refresh tokens, chat messages, need references, bid attachments, and verified private uploads.
- Password-reset links use a URL fragment (`#token=...`) so new reset tokens are not sent in HTTP requests. The reset page still accepts old query-string links for compatibility.

## Payment Readiness

- Paymob deposits and withdrawals are implemented for mocked callbacks and admin completion.
- Live Paymob checkout/payout verification remains blocked until the merchant account is active and live env keys are set.
- Money reviews should monitor deposit requests, withdrawal requests, wallet holds, dispute settlements, reversals, and failed lifecycle workers.
