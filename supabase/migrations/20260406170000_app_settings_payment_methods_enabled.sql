-- Per-method visibility for wallet deposits/withdrawals (admin-controlled).
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS payment_methods_enabled JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE app_settings
SET payment_methods_enabled = jsonb_build_object(
  'deposit_crypto', NOT disable_crypto_deposits,
  'deposit_card', NOT disable_card_deposits,
  'deposit_instapay', true,
  'withdrawal_crypto', true,
  'withdrawal_instapay', true
)
WHERE payment_methods_enabled = '{}'::jsonb;
