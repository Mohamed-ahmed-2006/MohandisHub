-- ============================================================================
-- MohandisHub — plan subscriptions frozen for launch
-- ----------------------------------------------------------------------------
-- Backlog P0-04, launch constraint LC-02. Only the Free plan is available at
-- launch; paid plans are not purchasable and render as "Coming soon".
--
-- `PlansService.subscribeToPlan` refuses with 503 PLAN_SUBSCRIPTIONS_PAUSED
-- while `app_settings.pause_plan_subscriptions` is true, before any EGP wallet
-- is read, locked or debited and before any plan_subscriptions row is written.
-- That flag was already true in the live database — but the column DEFAULTS to
-- false (20240101000018), so a fresh environment, a clean replay, or a newly
-- inserted settings row would have shipped with paid plans live.
--
-- This migration makes the freeze a property of the schema rather than of one
-- hand-edited row.
--
-- Why paid plans are not simply moved onto MHC: the plan catalogue is multi-tier
-- by design — every plan carries its own price, currency, billing_cycle and
-- duration_days — while MHC pricing is a single price per action key. Charging
-- `subscription_upgrade` would either flatten every paid tier onto one identical
-- price (silently mispricing a 55-tier and a 1000-tier the same, and again the
-- moment an admin activates another paid plan) or require per-plan action keys,
-- which is a new monetisation model rather than a migration of the existing one.
-- Neither was approved. The legacy EGP subscription code is left intact behind
-- the pause so whichever model is chosen starts from working code.
--
-- What this migration does NOT do:
--   * it does not convert the Pro plan to free, or change any plan's price;
--   * it does not deactivate, delete or rewrite any plan;
--   * it does not touch plan_subscriptions — every historical row, active or
--     expired, is left exactly as it is and keeps resolving entitlements;
--   * it does not touch users.plan_id, so the free-plan fallback keeps working;
--   * it does not create an MHC action price for subscriptions.
--
-- ----------------------------------------------------------------------------
-- ROLLBACK (restores the pre-launch-freeze schema default):
--
--   ALTER TABLE public.app_settings
--     ALTER COLUMN pause_plan_subscriptions SET DEFAULT false;
--   UPDATE public.app_settings SET pause_plan_subscriptions = false;
--
-- Run the UPDATE only when paid plans are genuinely ready to sell: it is the
-- switch that makes the legacy EGP debit path reachable again. Per LC-02 the
-- pricing model must be decided, implemented and tested first.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.app_settings') IS NULL THEN
    RAISE EXCEPTION 'public.app_settings is missing; apply 20240101000018_app_settings.sql first.';
  END IF;
END $$;

-- New settings rows are frozen by default. Fail-closed: shipping a fresh
-- environment with paid plans purchasable would expose the legacy EGP wallet
-- debit against wallets that 20260728160000 froze.
ALTER TABLE public.app_settings
  ALTER COLUMN pause_plan_subscriptions SET DEFAULT true;

-- Idempotent: only rows that are not already frozen are touched, so re-running
-- writes nothing and never overrides a deliberate future un-pause twice.
UPDATE public.app_settings
SET pause_plan_subscriptions = true
WHERE pause_plan_subscriptions IS DISTINCT FROM true;

COMMENT ON COLUMN public.app_settings.pause_plan_subscriptions IS
  'Launch freeze (LC-02): when true, PlansService.subscribeToPlan returns '
  '503 PLAN_SUBSCRIPTIONS_PAUSED before touching any wallet. Defaults to true. '
  'Do not clear it until per-plan MHC pricing is decided, implemented and tested '
  '— clearing it re-exposes the legacy EGP wallet debit path.';

-- ---------------------------------------------------------------------------
-- Assert the end state, so a bad edit fails loudly instead of silently
-- shipping purchasable paid plans.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  unfrozen INTEGER;
BEGIN
  SELECT count(*) INTO unfrozen
  FROM public.app_settings
  WHERE pause_plan_subscriptions IS DISTINCT FROM true;

  IF unfrozen > 0 THEN
    RAISE EXCEPTION '% app_settings row(s) still allow plan subscriptions', unfrozen;
  END IF;
END $$;
