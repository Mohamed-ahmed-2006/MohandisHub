-- ============================================================================
-- MohandisHub — advertisements move onto MHC
-- ----------------------------------------------------------------------------
-- Backlog P0-03. Advertisement creation debits the EGP money wallet, which
-- migration 20260728160000 froze. It works today only because the configured
-- price is 0; the moment an admin sets a price, ad creation fails outright.
--
-- After this migration the advertisement price lives in
-- `mhc_action_prices.advertisement` and is charged through the generic MHC
-- charge primitive (P0-07). This file does three things and nothing else:
--
--   1. activates the `advertisement` action price WITHOUT changing its value,
--   2. gives `advertisements` a database-enforced domain idempotency key,
--   3. labels the EGP pricing columns as legacy, without dropping any of them.
--
-- ----------------------------------------------------------------------------
-- ROLLBACK (tested on scratch replay copies):
--
--   DROP INDEX IF EXISTS public.uq_advertisements_advertiser_idempotency;
--   ALTER TABLE public.advertisements DROP COLUMN IF EXISTS client_idempotency_key;
--   UPDATE public.mhc_action_prices SET is_active = false WHERE action_key = 'advertisement';
--
-- The comments are cosmetic and may be left in place. No advertisement row, no
-- pricing row and no ledger row is destroyed by this migration or its reversal.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Activate the advertisement action price — at its CURRENT value
-- ---------------------------------------------------------------------------
-- Deliberately does not set a price. The seeded value is 0, which keeps ads
-- exactly as free as they are today; choosing a launch price is a commercial
-- decision and an admin action, not a migration.
--
-- Activation is required because the generic charge primitive fails CLOSED on
-- an inactive price (409 MHC_ACTION_DISABLED) rather than treating "off" as
-- "free". An active row priced 0 is the supported way to say "free".
INSERT INTO public.mhc_action_prices (action_key, name, mhc_price, is_active)
VALUES ('advertisement', 'Advertisement', 0, true)
ON CONFLICT (action_key) DO UPDATE
  SET is_active = true,
      updated_at = now();

COMMENT ON TABLE public.mhc_action_prices IS
  'Admin-configurable MHC price per paid platform action. The single source of '
  'truth for what any action costs. Never hardcode a price in application code.';

-- ---------------------------------------------------------------------------
-- 2. Domain idempotency for advertisement creation
-- ---------------------------------------------------------------------------
-- Without this, two clicks on "create campaign" create two advertisements. The
-- MHC charge table would then hold two charges too, because each ad is a
-- different business reference — the charge primitive cannot deduplicate what
-- the domain has already duplicated.
--
-- Same shape and same reasoning as uq_deposit_requests_user_provider_idempotency
-- (20260727091000): a client-supplied UUID, scoped to the owning account so two
-- advertisers cannot collide, and partial so the column stays optional for
-- callers that predate it.
ALTER TABLE public.advertisements
  ADD COLUMN IF NOT EXISTS client_idempotency_key UUID;

COMMENT ON COLUMN public.advertisements.client_idempotency_key IS
  'Client-provided UUID (Idempotency-Key header) preventing a retried create '
  'request from producing a second advertisement and a second MHC charge.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_advertisements_advertiser_idempotency
  ON public.advertisements (advertiser_id, client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Mark the EGP pricing fields legacy — retained, never used for charging
-- ---------------------------------------------------------------------------
-- Every column below is kept. Historic advertisements were genuinely paid for
-- in EGP and those amounts remain the record of what was charged; the refund
-- path for those campaigns still reads them. Nothing new is ever written to
-- them by the charging path.
COMMENT ON COLUMN public.advertisements.amount_paid IS
  'LEGACY (EGP). Historic wallet-funded ad payments only. Launch advertisements '
  'are charged in MHC and recorded in mhc_action_charges; this stays 0 for them.';

COMMENT ON COLUMN public.advertisements.daily_price_piastres IS
  'LEGACY (EGP piastres). Not used for launch charging.';

COMMENT ON COLUMN public.advertisements.quoted_amount_piastres IS
  'LEGACY (EGP piastres). Not used for launch charging.';

COMMENT ON COLUMN public.advertisements.wallet_hold_id IS
  'LEGACY. Escrow-era hold reference. The launch ad path places no wallet hold.';

DO $$
BEGIN
  IF to_regclass('public.advertisement_plans') IS NOT NULL THEN
    -- Retained for duration/placement metadata. Its price and currency are NOT
    -- read by any code path and must not become a charging source again.
    EXECUTE $c$COMMENT ON COLUMN public.advertisement_plans.price IS
      'LEGACY (EGP). Not a charging source. Advertisement pricing comes from '
      'mhc_action_prices.advertisement.'$c$;
    EXECUTE $c$COMMENT ON COLUMN public.advertisement_plans.currency IS
      'LEGACY. Advertisements are charged in MHC, which is not a currency.'$c$;
  END IF;

  IF to_regclass('public.ad_pricing_rules') IS NOT NULL THEN
    -- flat_fee on the __GLOBAL_AD_CONTROLS__ row was the real EGP price source
    -- before this change. is_active on that same row is NOT legacy: it remains
    -- the "accepting new campaigns" switch.
    EXECUTE $c$COMMENT ON COLUMN public.ad_pricing_rules.flat_fee IS
      'LEGACY (EGP per day). Was the advertisement price source before P0-03. '
      'Charging now reads mhc_action_prices.advertisement. Retained for history.'$c$;
  END IF;
END $$;
