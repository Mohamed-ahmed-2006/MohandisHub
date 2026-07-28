-- ============================================================================
-- fx_rate_freshness
-- ----------------------------------------------------------------------------
-- RECOVERED MIGRATION — restored to version control on 2026-07-29.
--
-- This file was applied to the database but was missing from the repository.
-- The SQL below is the ORIGINAL text, recovered verbatim from
-- supabase_migrations.schema_migrations.statements (the statement list the
-- Supabase CLI recorded when it applied this migration). It is NOT a
-- reconstruction from the live schema.
--
-- Statements are re-joined in their recorded execution order. Only the
-- statement separator was re-added; no statement text was altered.
--
-- Applied version: 20260727092000
-- Statements:      5
-- ============================================================================

-- Explicit freshness timestamps for administrator-provided FX fallback rates.

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS wallet_egp_per_usdt_deposit_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wallet_egp_per_usdt_withdrawal_updated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION set_wallet_fx_rate_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.wallet_egp_per_usdt_deposit IS DISTINCT FROM OLD.wallet_egp_per_usdt_deposit THEN
    NEW.wallet_egp_per_usdt_deposit_updated_at = now();
  END IF;
  IF NEW.wallet_egp_per_usdt_withdrawal IS DISTINCT FROM OLD.wallet_egp_per_usdt_withdrawal THEN
    NEW.wallet_egp_per_usdt_withdrawal_updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_settings_wallet_fx_rate_timestamps ON app_settings;

CREATE TRIGGER trg_app_settings_wallet_fx_rate_timestamps
BEFORE UPDATE OF wallet_egp_per_usdt_deposit, wallet_egp_per_usdt_withdrawal
ON app_settings
FOR EACH ROW
EXECUTE FUNCTION set_wallet_fx_rate_timestamps();

COMMENT ON COLUMN app_settings.wallet_egp_per_usdt_deposit_updated_at IS
  'Freshness timestamp for the administrator-provided deposit fallback rate.';
