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
