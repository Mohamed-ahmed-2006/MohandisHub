-- ============================================================================
-- MohandisHub — EGP-primary wallet, InstaPay manual rails, FX settings, USD→EGP migration
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) App settings: FX, platform InstaPay, migration bookkeeping
-- --------------------------------------------------------------------------
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS wallet_egp_per_usdt_deposit NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS wallet_egp_per_usdt_withdrawal NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS platform_instapay_display JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS wallet_usd_to_egp_migration_rate NUMERIC(18, 6) DEFAULT 48.5,
  ADD COLUMN IF NOT EXISTS wallet_migration_usd_to_egp_applied BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN app_settings.wallet_egp_per_usdt_deposit IS 'EGP credited per 1 USDT (or stablecoin unit) on crypto deposit settlement';
COMMENT ON COLUMN app_settings.wallet_egp_per_usdt_withdrawal IS 'EGP debited per 1 USDT when quoting crypto withdrawal from EGP balance';
COMMENT ON COLUMN app_settings.platform_instapay_display IS 'JSON shown to users for manual InstaPay deposits (phone, name, bank, instructions)';

CREATE TABLE IF NOT EXISTS app_settings_wallet_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES users (id) ON DELETE SET NULL,
  field_key TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_settings_wallet_audit_created ON app_settings_wallet_audit (created_at DESC);

-- --------------------------------------------------------------------------
-- 2) User payout preferences (expert / craftsman / business)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_payout_preferences (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  instapay_phone VARCHAR(64),
  crypto_payout_currency VARCHAR(32),
  crypto_payout_address TEXT,
  crypto_payout_extra_id VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- 3) deposit_requests — manual InstaPay + review + FX snapshot
-- --------------------------------------------------------------------------
ALTER TABLE deposit_requests
  ADD COLUMN IF NOT EXISTS proof_upload_id UUID REFERENCES private_uploads (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS destination_account_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS credited_transaction_id UUID REFERENCES transactions (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rate_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS credited_amount_egp NUMERIC(12, 2);

ALTER TABLE deposit_requests DROP CONSTRAINT IF EXISTS deposit_requests_status_check;
ALTER TABLE deposit_requests ADD CONSTRAINT deposit_requests_status_check CHECK (
  status IN (
    'pending',
    'paid',
    'expired',
    'failed',
    'cancelled',
    'pending_review',
    'rejected'
  )
);

-- --------------------------------------------------------------------------
-- 4) withdrawal_requests — EGP source + crypto payout amount + InstaPay + proof
-- --------------------------------------------------------------------------
ALTER TABLE withdrawal_requests
  ADD COLUMN IF NOT EXISTS withdrawal_method VARCHAR(20) NOT NULL DEFAULT 'crypto',
  ADD COLUMN IF NOT EXISTS source_amount_egp NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS payout_crypto_amount NUMERIC(24, 8),
  ADD COLUMN IF NOT EXISTS instapay_recipient VARCHAR(128),
  ADD COLUMN IF NOT EXISTS admin_proof_upload_id UUID REFERENCES private_uploads (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rate_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE withdrawal_requests DROP CONSTRAINT IF EXISTS withdrawal_requests_status_check;
ALTER TABLE withdrawal_requests ADD CONSTRAINT withdrawal_requests_status_check CHECK (
  status IN (
    'pending_verification',
    'processing',
    'finished',
    'failed',
    'rejected',
    'cancelled',
    'blocked',
    'awaiting_transfer'
  )
);

-- --------------------------------------------------------------------------
-- 5) One-time USD → EGP migration (wallets + transactions linked to USD wallets)
-- --------------------------------------------------------------------------
DO $$
DECLARE
  r NUMERIC(18, 6);
  applied BOOLEAN;
  settings_count INT;
BEGIN
  SELECT COUNT(*) INTO settings_count FROM app_settings;
  IF settings_count = 0 THEN
    RAISE NOTICE 'app_settings empty; skip USD→EGP migration';
    RETURN;
  END IF;

  SELECT
    COALESCE(wallet_usd_to_egp_migration_rate, 48.5),
    COALESCE(wallet_migration_usd_to_egp_applied, false)
  INTO r, applied
  FROM app_settings
  LIMIT 1;

  IF applied IS TRUE THEN
    RETURN;
  END IF;

  UPDATE transactions t
  SET
    amount = ROUND((t.amount::numeric * r), 2),
    balance_after = ROUND((t.balance_after::numeric * r), 2),
    metadata = COALESCE(t.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'migrated_usd_to_egp',
        true,
        'migration_rate_egp_per_usd',
        r,
        'migration_applied_at',
        to_jsonb (now())
      )
  FROM wallets w
  WHERE
    t.wallet_id = w.id
    AND w.currency = 'USD';

  UPDATE wallets
  SET
    balance = ROUND(balance::numeric * r, 2),
    currency = 'EGP'
  WHERE
    currency = 'USD';

  UPDATE wallets
  SET currency = 'EGP'
  WHERE
    currency IS NOT NULL
    AND currency <> 'EGP';

  UPDATE deposit_requests
  SET
    amount = ROUND(amount::numeric * r, 2),
    currency = 'EGP'
  WHERE
    currency = 'USD';

  UPDATE app_settings
  SET wallet_migration_usd_to_egp_applied = true;

  RAISE NOTICE 'wallet USD→EGP migration applied at rate %', r;
END $$;
