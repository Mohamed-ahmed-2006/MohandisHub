-- ============================================================================
-- MohandisHub — Minimum transaction amount (EGP)
-- ============================================================================
-- Admin-configurable floor for paid transactions (bids, reservation fixed
-- price) so the provider always nets a positive payout after commission.
-- Default 0 = no floor (defensive commission cap still prevents negatives).

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS min_transaction_egp NUMERIC(10,2) NOT NULL DEFAULT 0;
