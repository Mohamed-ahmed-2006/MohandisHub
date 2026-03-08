-- ============================================================================
-- MohandisHub — v019: Commission settings for bid/booking payments
-- ============================================================================

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS commission_percent NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS commission_min_egp NUMERIC(10,2) NOT NULL DEFAULT 0;
