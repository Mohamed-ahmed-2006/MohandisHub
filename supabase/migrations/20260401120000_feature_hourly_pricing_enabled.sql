-- Hourly pricing visibility: admin + App Status (default true = no behavior change until toggled off)
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS feature_hourly_pricing_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN app_settings.feature_hourly_pricing_enabled IS
  'When false, hourly pricing is hidden in the web app and API rejects hourly payloads.';
