# Rollback Playbook

## Purpose

This runbook defines the minimum rollback process for failed deployments and unsafe migrations.

## Trigger Conditions

- Elevated 5xx error rate after deploy.
- Readiness endpoint failing continuously.
- Payment, verification, or auth regressions detected in smoke tests.
- Data migration causes query failures or application startup issues.

## Immediate Actions

1. Stop further deploys to the affected environment.
2. Route traffic away from unhealthy instances.
3. Restore previous stable service revision from the hosting dashboard.
4. Confirm `GET /health/ready` returns healthy after rollback.

## Database Safety

1. Identify migration(s) applied in the failed release.
2. If backward-incompatible changes were introduced, apply a prepared down migration or hotfix migration.
3. Re-run smoke checks against auth, services, needs, wallet, and chat.
4. Keep incident notes with exact migration IDs and timestamps.

## Verification Checklist After Rollback

- API readiness is green.
- Login and token refresh work.
- Public service detail returns only active items.
- Customer need flow and provider bid flow work.
- Wallet operations return expected responses.
- Admin critical pages load with correct permissions.

## Prevention Controls

- Require `SHIP_CONFIRM=YES` for migration pushes.
- Run full CI gates (typecheck, lint, tests, coverage, i18n validation) before deployment.
- Keep a tested rollback migration path for each schema change.
