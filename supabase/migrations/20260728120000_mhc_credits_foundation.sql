-- ============================================================================
-- MohandisHub — MHC (Mohandis Credits) foundation
-- ----------------------------------------------------------------------------
-- Introduces a closed-loop, provider-only credit ("MHC") that is:
--   * separate from the existing EGP wallet,
--   * non-withdrawable, non-transferable, non-redeemable for cash/crypto,
--   * spendable only on MohandisHub-owned platform actions.
--
-- Design notes
--   * We REUSE the existing wallets/transactions ledger. The asset is carried by
--     wallets.asset_code ('EGP' | 'MHC') and the account by wallets.account_type
--     ('money' | 'provider_credit'). The transactions.type CHECK is NOT changed:
--     MHC grants use type='deposit', MHC spends use type='payment', and audited
--     super_admin corrections use type='adjustment'. The MHC meaning is carried
--     by wallets.asset_code + transactions.reference_type + metadata.
--   * The existing EGP wallet per user is preserved and FROZEN for launch so its
--     history remains intact and no customer deposits/withdrawals/escrow occur.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Wallet accounts: add account_type + asset_code, relax single-wallet rule
-- ---------------------------------------------------------------------------
ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS account_type VARCHAR(20) NOT NULL DEFAULT 'money',
  ADD COLUMN IF NOT EXISTS asset_code   VARCHAR(8)  NOT NULL DEFAULT 'EGP';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_wallets_account_type'
      AND conrelid = 'public.wallets'::regclass
  ) THEN
    ALTER TABLE public.wallets
      ADD CONSTRAINT chk_wallets_account_type
      CHECK (account_type IN ('money', 'provider_credit'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_wallets_asset_code'
      AND conrelid = 'public.wallets'::regclass
  ) THEN
    ALTER TABLE public.wallets
      ADD CONSTRAINT chk_wallets_asset_code
      CHECK (asset_code IN ('EGP', 'MHC'));
  END IF;

  -- A money account must be EGP; a provider_credit account must be MHC.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_wallets_account_asset_pairing'
      AND conrelid = 'public.wallets'::regclass
  ) THEN
    ALTER TABLE public.wallets
      ADD CONSTRAINT chk_wallets_account_asset_pairing
      CHECK (
        (account_type = 'money' AND asset_code = 'EGP')
        OR (account_type = 'provider_credit' AND asset_code = 'MHC')
      );
  END IF;
END $$;

-- Backfill: existing rows are the EGP money account.
UPDATE public.wallets
SET account_type = 'money', asset_code = 'EGP'
WHERE account_type IS NULL OR account_type = '' OR asset_code IS NULL OR asset_code = '';

-- Replace the single-wallet-per-user constraint with per-account uniqueness.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'wallets_user_id_key'
      AND conrelid = 'public.wallets'::regclass
  ) THEN
    ALTER TABLE public.wallets DROP CONSTRAINT wallets_user_id_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallets_user_account
  ON public.wallets(user_id, account_type);

-- ---------------------------------------------------------------------------
-- 2. MHC credit packages (admin-configurable; NO hardcoded values)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mhc_credit_packages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  VARCHAR(60)   NOT NULL UNIQUE,
  name                  VARCHAR(120)  NOT NULL,
  name_ar               VARCHAR(120),
  mhc_amount            NUMERIC(14,2) NOT NULL CHECK (mhc_amount > 0),
  external_price_amount NUMERIC(12,2) NOT NULL CHECK (external_price_amount > 0),
  external_price_currency VARCHAR(3)  NOT NULL DEFAULT 'EGP',
  is_active             BOOLEAN       NOT NULL DEFAULT true,
  sort_order            INTEGER       NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mhc_credit_packages_active
  ON public.mhc_credit_packages(is_active, sort_order);

CREATE TRIGGER set_mhc_credit_packages_updated_at
  BEFORE UPDATE ON public.mhc_credit_packages
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. MHC action pricing catalog (admin-configurable per action)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mhc_action_prices (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key   VARCHAR(80)   NOT NULL UNIQUE,
  name         VARCHAR(160)  NOT NULL,
  mhc_price    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (mhc_price >= 0),
  is_active    BOOLEAN       NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE TRIGGER set_mhc_action_prices_updated_at
  BEFORE UPDATE ON public.mhc_action_prices
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Seed the known action keys (inactive-safe: price 0 + active flag), so admin
-- can configure prices before enabling. Normal bids remain free (not listed).
INSERT INTO public.mhc_action_prices (action_key, name, mhc_price, is_active)
VALUES
  ('award_activation',      'Award activation',        0, false),
  ('booking_activation',    'Booking activation',      0, false),
  ('subscription_upgrade',  'Subscription / upgrade',  0, false),
  ('advertisement',         'Advertisement',           0, false),
  ('service_promotion',     'Service promotion',       0, false),
  ('featured_provider',     'Featured-provider placement', 0, false),
  ('promoted_proposal',     'Promoted proposal',       0, false)
ON CONFLICT (action_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. deposit_requests: MHC purchase support
-- ---------------------------------------------------------------------------
ALTER TABLE public.deposit_requests
  ADD COLUMN IF NOT EXISTS purpose               VARCHAR(30) NOT NULL DEFAULT 'wallet_topup',
  ADD COLUMN IF NOT EXISTS target_account_type   VARCHAR(20) NOT NULL DEFAULT 'money',
  ADD COLUMN IF NOT EXISTS credit_package_id      UUID REFERENCES public.mhc_credit_packages(id),
  ADD COLUMN IF NOT EXISTS mhc_grant_amount       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS external_price_amount  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS external_price_currency VARCHAR(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_deposit_requests_purpose'
      AND conrelid = 'public.deposit_requests'::regclass
  ) THEN
    ALTER TABLE public.deposit_requests
      ADD CONSTRAINT chk_deposit_requests_purpose
      CHECK (purpose IN ('wallet_topup', 'credit_purchase'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_deposit_requests_target_account'
      AND conrelid = 'public.deposit_requests'::regclass
  ) THEN
    ALTER TABLE public.deposit_requests
      ADD CONSTRAINT chk_deposit_requests_target_account
      CHECK (target_account_type IN ('money', 'provider_credit'));
  END IF;

  -- A credit_purchase must target provider_credit and carry a grant amount.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_deposit_requests_credit_purchase_shape'
      AND conrelid = 'public.deposit_requests'::regclass
  ) THEN
    ALTER TABLE public.deposit_requests
      ADD CONSTRAINT chk_deposit_requests_credit_purchase_shape
      CHECK (
        purpose <> 'credit_purchase'
        OR (target_account_type = 'provider_credit'
            AND mhc_grant_amount IS NOT NULL
            AND mhc_grant_amount > 0)
      ) NOT VALID;
  END IF;
END $$;

-- Manual InstaPay reference must be unique per provider to prevent reuse.
-- Bank references are not globally unique across banks, so admin manual
-- verification remains the authority; this index blocks re-submission.
CREATE UNIQUE INDEX IF NOT EXISTS uq_deposit_requests_instapay_reference
  ON public.deposit_requests(provider, lower(btrim(transfer_reference)))
  WHERE transfer_reference IS NOT NULL AND provider = 'instapay_manual';

-- ---------------------------------------------------------------------------
-- 5. Provider direct-payment methods (customer pays provider directly)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_payment_methods (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method_type   VARCHAR(30) NOT NULL
    CHECK (method_type IN ('bank_transfer', 'instapay', 'mobile_wallet')),
  -- Non-sensitive label shown before activation (e.g. "Bank transfer", "InstaPay").
  label         VARCHAR(120),
  -- Sensitive details, revealed to a customer only after MHC activation.
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_payment_methods_user
  ON public.provider_payment_methods(user_id, is_active, sort_order);

CREATE TRIGGER set_provider_payment_methods_updated_at
  BEFORE UPDATE ON public.provider_payment_methods
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Job activations: one MHC charge per awarded bid / booking (idempotent)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mhc_job_activations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_type   VARCHAR(20) NOT NULL CHECK (activation_type IN ('award', 'booking')),
  -- Provider account charged (owner user id for a business).
  provider_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The acting user (may be a business team member).
  acting_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  need_id           UUID REFERENCES needs(id) ON DELETE CASCADE,
  bid_id            UUID,
  reservation_id    UUID,
  action_key        VARCHAR(80) NOT NULL,
  mhc_charged       NUMERIC(14,2) NOT NULL CHECK (mhc_charged >= 0),
  transaction_id    UUID REFERENCES transactions(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: at most one award activation per bid, one booking activation
-- per reservation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mhc_activation_award
  ON public.mhc_job_activations(bid_id)
  WHERE activation_type = 'award' AND bid_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mhc_activation_booking
  ON public.mhc_job_activations(reservation_id)
  WHERE activation_type = 'booking' AND reservation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mhc_activation_provider
  ON public.mhc_job_activations(provider_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. App settings: MHC + launch feature flags
-- ---------------------------------------------------------------------------
UPDATE public.app_settings
SET payment_methods_enabled =
  COALESCE(payment_methods_enabled, '{}'::jsonb)
  || jsonb_build_object(
    -- Providers buy MHC via manual InstaPay (always available for launch).
    'credit_purchase_instapay', true,
    -- NOWPayments MHC purchase gated by env flag (see env config).
    'credit_purchase_nowpayments', true,
    -- Launch: customers never fund a balance; no withdrawals; no escrow.
    'deposit_instapay', false,
    'deposit_crypto', false,
    'withdrawal_instapay', false,
    'withdrawal_crypto', false,
    'withdrawal_paymob', false,
    'deposit_card', false,
    'deposit_paymob', false
  )
WHERE TRUE;
