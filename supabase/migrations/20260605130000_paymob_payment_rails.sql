-- ============================================================================
-- MohandisHub — Paymob payment rails (deposit + withdrawal)
-- ============================================================================
-- Adds Paymob reconciliation columns and registers the new payment-method
-- toggles. Crypto withdrawal is hidden by default (admin can re-enable).

-- --------------------------------------------------------------------------
-- 1) deposit_requests — Paymob reconciliation / idempotency
-- --------------------------------------------------------------------------
ALTER TABLE deposit_requests
  ADD COLUMN IF NOT EXISTS paymob_intention_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS paymob_order_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS paymob_transaction_id VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_deposit_requests_paymob_order
  ON deposit_requests(paymob_order_id);
CREATE INDEX IF NOT EXISTS idx_deposit_requests_paymob_txn
  ON deposit_requests(paymob_transaction_id);

-- --------------------------------------------------------------------------
-- 2) withdrawal_requests — Paymob payout reference
-- --------------------------------------------------------------------------
ALTER TABLE withdrawal_requests
  ADD COLUMN IF NOT EXISTS paymob_recipient VARCHAR(128),
  ADD COLUMN IF NOT EXISTS paymob_payout_reference VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_paymob_payout
  ON withdrawal_requests(paymob_payout_reference);

-- --------------------------------------------------------------------------
-- 3) user_payout_preferences — Paymob recipient
-- --------------------------------------------------------------------------
ALTER TABLE user_payout_preferences
  ADD COLUMN IF NOT EXISTS paymob_recipient VARCHAR(128);

-- --------------------------------------------------------------------------
-- 4) app_settings.payment_methods_enabled — register new toggles
--    - deposit_paymob / withdrawal_paymob default to false (no keys yet)
--    - withdrawal_crypto forced false (hidden by default; admin can re-enable)
-- --------------------------------------------------------------------------
UPDATE app_settings
SET payment_methods_enabled =
  (
    jsonb_build_object('deposit_paymob', false, 'withdrawal_paymob', false)
    || COALESCE(payment_methods_enabled, '{}'::jsonb)
  )
  || jsonb_build_object('withdrawal_crypto', false);
