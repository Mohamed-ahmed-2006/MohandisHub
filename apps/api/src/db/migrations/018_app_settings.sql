-- ============================================================================
-- MohandisHub - v018: App settings table for admin-controlled app-wide flags
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  maintenance_message TEXT,
  signups_locked BOOLEAN NOT NULL DEFAULT false,
  deposits_paused BOOLEAN NOT NULL DEFAULT false,
  money_movements_paused BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id),

  -- Phase 2
  lock_logins BOOLEAN NOT NULL DEFAULT false,
  disable_crypto_deposits BOOLEAN NOT NULL DEFAULT false,
  disable_card_deposits BOOLEAN NOT NULL DEFAULT false,
  min_deposit_amount NUMERIC(10, 2),
  max_deposit_amount NUMERIC(10, 2),
  pause_plan_subscriptions BOOLEAN NOT NULL DEFAULT false,
  pause_needs BOOLEAN NOT NULL DEFAULT false,
  pause_bids BOOLEAN NOT NULL DEFAULT false,
  pause_award_bids BOOLEAN NOT NULL DEFAULT false,
  pause_uploads BOOLEAN NOT NULL DEFAULT false,
  pause_verification_submissions BOOLEAN NOT NULL DEFAULT false,
  pause_chat BOOLEAN NOT NULL DEFAULT false,
  pause_otp_emails BOOLEAN NOT NULL DEFAULT false,
  feature_needs_enabled BOOLEAN NOT NULL DEFAULT true,
  feature_plans_enabled BOOLEAN NOT NULL DEFAULT true,
  feature_wallet_enabled BOOLEAN NOT NULL DEFAULT true,
  global_announcement TEXT
);

-- Ensure exactly one row
DO $$
DECLARE
  row_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO row_count FROM app_settings;
  IF row_count = 0 THEN
    INSERT INTO app_settings (maintenance_mode, signups_locked, deposits_paused, money_movements_paused)
    VALUES (false, false, false, false);
  END IF;
END $$;
