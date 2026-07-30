-- ============================================================================
-- MohandisHub — per-plan MHC pricing
-- ============================================================================
-- Approved product decision (supersedes launch constraint LC-02): every paid
-- plan has its OWN admin-configured MHC price. One shared
-- `subscription_upgrade` price for all plans was rejected, and so was creating
-- one action key per plan.
--
-- The mechanism is a generic SCOPED PRICE table. `mhc_action_prices` stays the
-- global action catalogue; `mhc_action_price_scopes` overrides it per entity:
--
--     action_key = 'subscription_upgrade', scope_type = 'plan', scope_id = plan.id
--
-- Generic on purpose. The same table will price a spotlight per service or a
-- promotion per listing without another schema change, and without the
-- action-key explosion that per-plan keys would have caused.
--
-- The price is NEVER supplied by a caller. A consumer passes a SCOPE; the
-- charging primitive resolves the price from this table itself, so the wallet
-- lock, balance check, ledger write, charge record, idempotency and rollback all
-- stay where they already are.
--
-- ----------------------------------------------------------------------------
-- ROLLBACK (tested on scratch replay copies):
--
--   DROP TABLE IF EXISTS public.mhc_action_price_scopes;
--   DROP INDEX IF EXISTS public.uq_plan_subscriptions_user_idempotency;
--   ALTER TABLE public.plan_subscriptions
--     DROP COLUMN IF EXISTS mhc_price_paid,
--     DROP COLUMN IF EXISTS duration_days_used,
--     DROP COLUMN IF EXISTS action_charge_id,
--     DROP COLUMN IF EXISTS client_idempotency_key;
--   ALTER TABLE public.plans
--     DROP COLUMN IF EXISTS is_purchasable,
--     DROP COLUMN IF EXISTS is_visible;
--   ALTER TABLE public.app_settings
--     ALTER COLUMN pause_plan_subscriptions SET DEFAULT true;
--   UPDATE public.app_settings SET pause_plan_subscriptions = true;
--
-- Dropping the snapshot columns loses the record of WHAT a subscription was
-- charged. The `transactions` and `mhc_action_charges` rows survive either way
-- and remain the authoritative financial history.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.mhc_action_prices') IS NULL THEN
    RAISE EXCEPTION 'public.mhc_action_prices is missing; apply 20260728120000 first.';
  END IF;
  IF to_regclass('public.mhc_action_charges') IS NULL THEN
    RAISE EXCEPTION 'public.mhc_action_charges is missing; apply 20260729140000 first.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Scoped MHC prices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mhc_action_price_scopes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Key in the global catalogue this row overrides. Not an FK: prices are
  -- admin-editable and deleting a catalogue row must not erase the record of
  -- what a scoped price was, nor cascade into charge history.
  action_key    VARCHAR(80)   NOT NULL,
  -- What kind of entity the scope_id points at. Constrained so a typo cannot
  -- create a silently unmatched scope that then falls back to nothing.
  scope_type    VARCHAR(40)   NOT NULL,
  scope_id      UUID          NOT NULL,
  mhc_price     NUMERIC(14,2) NOT NULL CHECK (mhc_price >= 0),
  is_active     BOOLEAN       NOT NULL DEFAULT true,
  -- Who last set this price. Nullable so a migration-seeded row is honest about
  -- having no human author.
  updated_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT chk_mhc_action_price_scope_type
    CHECK (scope_type IN ('plan'))
);

COMMENT ON TABLE public.mhc_action_price_scopes IS
  'Per-entity MHC price overrides for a global mhc_action_prices action. One '
  'ACTIVE row per (action_key, scope_type, scope_id). Resolved by the charging '
  'primitive itself — a price is never accepted from a caller.';
COMMENT ON COLUMN public.mhc_action_price_scopes.mhc_price IS
  'MHC charged for this action on this entity. 0 means free, which is different '
  'from having no row at all: an absent or inactive row fails CLOSED.';

-- "One active MHC price configuration per plan", enforced by the database.
-- Partial, so superseded rows can be kept as history by deactivating them
-- rather than deleting them.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mhc_action_price_scope_active
  ON public.mhc_action_price_scopes (action_key, scope_type, scope_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_mhc_action_price_scopes_lookup
  ON public.mhc_action_price_scopes (scope_type, scope_id, action_key);

CREATE TRIGGER set_mhc_action_price_scopes_updated_at
  BEFORE UPDATE ON public.mhc_action_price_scopes
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DO $$
BEGIN
  IF to_regclass('public.mhc_action_price_scopes') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.mhc_action_price_scopes ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.mhc_action_price_scopes FROM anon, authenticated';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Admin control over plan visibility and purchasability
-- ---------------------------------------------------------------------------
-- `is_active` already existed and keeps its meaning (the plan exists and can
-- resolve entitlements). These two split the two questions it was conflating:
-- may a user SEE the plan, and may a user BUY it.
--
-- `is_purchasable` defaults to FALSE. A plan becomes sellable only when an admin
-- deliberately prices it and switches it on — a new plan is never accidentally
-- on sale, and neither is an existing one after this migration.
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS is_purchasable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_visible     BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.plans.is_purchasable IS
  'Admin switch: may this plan be bought? Defaults to false so a plan is never '
  'on sale without a deliberate decision AND an active scoped MHC price.';
COMMENT ON COLUMN public.plans.is_visible IS
  'Admin switch: is this plan listed to users? A non-purchasable visible plan '
  'renders as "Coming soon".';
COMMENT ON COLUMN public.plans.price IS
  'LEGACY (EGP). Retired from every reachable purchase path; retained for '
  'historical reference. New subscriptions are priced in MHC via '
  'mhc_action_price_scopes.';
COMMENT ON COLUMN public.plans.currency IS
  'LEGACY. Plans are bought with MHC, which is not a currency.';

-- ---------------------------------------------------------------------------
-- 3. Immutable price snapshot on the subscription
-- ---------------------------------------------------------------------------
-- A later admin price change must not rewrite what an existing subscriber paid,
-- so the amount, the duration used and the charge record are recorded on the row.
ALTER TABLE public.plan_subscriptions
  ADD COLUMN IF NOT EXISTS mhc_price_paid         NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS duration_days_used     INTEGER,
  ADD COLUMN IF NOT EXISTS action_charge_id       UUID REFERENCES public.mhc_action_charges(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS client_idempotency_key UUID;

COMMENT ON COLUMN public.plan_subscriptions.mhc_price_paid IS
  'Immutable snapshot of the MHC actually charged. NULL on historic rows bought '
  'in EGP before per-plan MHC pricing.';
COMMENT ON COLUMN public.plan_subscriptions.action_charge_id IS
  'The mhc_action_charges row that paid for this subscription. NULL for a free '
  'plan and for historic EGP subscriptions.';
COMMENT ON COLUMN public.plan_subscriptions.client_idempotency_key IS
  'Client-provided UUID (Idempotency-Key header) preventing a retried purchase '
  'from creating a second subscription and a second MHC charge.';

-- Domain idempotency, same shape and reasoning as
-- uq_advertisements_advertiser_idempotency and
-- uq_deposit_requests_user_provider_idempotency.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_subscriptions_user_idempotency
  ON public.plan_subscriptions (user_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plan_subscriptions_charge
  ON public.plan_subscriptions (action_charge_id)
  WHERE action_charge_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Lift the global subscription pause — its blocker is resolved
-- ---------------------------------------------------------------------------
-- 20260730090000 froze subscriptions because plan pricing could not be expressed
-- in MHC without flattening every tier. Per-plan scoped pricing resolves exactly
-- that, so the global kill switch goes back to off.
--
-- This does NOT put anything on sale. Two further conditions must both hold per
-- plan: `plans.is_purchasable = true` AND an active scoped MHC price. Both
-- default to absent, so the composition is fail-closed and every plan that goes
-- on sale does so by a deliberate admin action.
ALTER TABLE public.app_settings
  ALTER COLUMN pause_plan_subscriptions SET DEFAULT false;

UPDATE public.app_settings
SET pause_plan_subscriptions = false
WHERE pause_plan_subscriptions IS DISTINCT FROM false;

COMMENT ON COLUMN public.app_settings.pause_plan_subscriptions IS
  'Global kill switch for plan purchasing. Independent of the per-plan '
  'is_purchasable flag and the per-plan scoped MHC price, both of which must '
  'also be set before any plan can be bought.';

-- ---------------------------------------------------------------------------
-- 5. Assert the end state
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  sellable INTEGER;
BEGIN
  -- Nothing may be purchasable straight out of this migration.
  SELECT count(*) INTO sellable FROM public.plans WHERE is_purchasable = true;
  IF sellable > 0 THEN
    RAISE EXCEPTION '% plan(s) became purchasable by migration; must be opt-in', sellable;
  END IF;

  IF EXISTS (SELECT 1 FROM public.mhc_action_price_scopes) THEN
    RAISE EXCEPTION 'mhc_action_price_scopes must start empty; prices are an admin action';
  END IF;
END $$;
