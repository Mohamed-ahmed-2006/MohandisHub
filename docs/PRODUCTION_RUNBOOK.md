# MohandisHub Production Runbook

## Required Pre-Deploy Checks

- Confirm production env values are set in Render or the hosting dashboard.
- Confirm `DATABASE_URL`, `API_PUBLIC_URL`, `WEB_PUBLIC_URL`, JWT secrets, Sentry DSN, Resend email provider keys, verification provider keys, and Supabase service-role storage keys are present.
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

## Background Workers

`mohandishub-worker` (`node apps/api/dist/worker.js`) runs four independent sweeps.
Each is failure-isolated: one throwing does not stop the others, and none of them
holds a lock across a network call.

| Sweep | Default cadence | Configured by |
| --- | --- | --- |
| Reservation lifecycle | 60s | (fixed) |
| Retention | 15 min | `RETENTION_SWEEP_INTERVAL_MS` |
| Award-offer expiry | 5 min | (fixed) |
| Advertisement billing | 60s | `AD_BILLING_SWEEP_INTERVAL_MS` |

### Advertisement billing sweep

The process that ends a paid advertisement week and buys the next one. Full
design in [`docs/release/ADVERTISEMENT_BILLING.md`](./release/ADVERTISEMENT_BILLING.md) §5C.

| Variable | Default | Accepted range | Meaning |
| --- | --- | --- | --- |
| `AD_BILLING_SWEEP_INTERVAL_MS` | `60000` | ≥ 5000 | Time between ticks |
| `AD_BILLING_SWEEP_BATCH_SIZE` | `25` | 1–500 | Campaigns per stage per tick |
| `AD_RENEWAL_REMINDER_HOURS` | `24` | 1–168 | Lead time for the renewal reminder |

None needs to be set — the defaults are the intended production values, which is
why they are absent from `render.yaml`. A value outside the accepted range makes
the process **fail to start** rather than silently substituting a number nobody
chose; check the worker log for `Invalid environment configuration`.

Operational notes:

- **Running more than one worker instance is safe.** Claims use
  `FOR UPDATE SKIP LOCKED`, so a second instance does nothing rather than doing
  it twice. Exactly-once charging comes from row locks and unique indexes, never
  from this process being the only one.
- **A late or skipped tick costs nothing.** A renewal buys a full 168 hours from
  the instant it charges, not from the boundary it missed. There is no backlog of
  lost weeks to reconcile after downtime — restart the worker and it drains.
- **SIGTERM is safe at any moment.** The sweep checks for shutdown *between*
  campaigns and then waits for the one in flight, so a campaign has either
  committed its charge and its week or neither. A hard kill is also safe: an
  uncommitted charge is no charge.
- **Watch for** `Advertisement billing sweep failed` (structural — the sweep
  itself could not run) and `Advertisement billing sweep stage failed` (one
  campaign or one stage; the rest of the tick continued). A healthy busy worker
  logs `Advertisement billing sweep processed due items` with counts; a healthy
  idle worker logs nothing.
- **Nothing charges while the advertisement price is 0.** A zero-price week
  writes no charge row and no ledger row by design, so an idle sweep on a
  zero-price deployment is the expected steady state.

#### Notification delivery health

Advertisement renewal notifications are delivered from an outbox with a
delivery lease. External delivery (web push, email) is **at-least-once**: neither
provider is given an idempotency key, so a crash between a send and its
acknowledgement resends when the lease expires. The boundary event and the
in-app notification row are exactly once.

What to watch:

- `Advertisement notifications exhausted their retry budget` — logged at **error**
  level when an event has failed `MAX_DELIVERY_ATTEMPTS` (5) times. This is the
  one failure nothing else surfaces: the renewal itself succeeded, so no
  financial alarm fires, but an advertiser was never told.
- The sweep's `notifyRetrying` and `notifyExhausted` counters in
  `Advertisement billing sweep processed due items`.

To inspect, read-only:

```sql
SELECT delivery_status, count(*), max(attempt_count) FROM advertisement_renewal_events GROUP BY 1;
```

A row stuck in `claimed` is not stuck: `claim_expires_at` releases it, and the
sweep re-claims anything past its lease. To retry a parked event after fixing the
cause, set it back to `pending` with a cleared `claim_expires_at`; it will be
picked up on the next tick and will not duplicate the in-app notification,
because `in_app_notification_id` is already set.
