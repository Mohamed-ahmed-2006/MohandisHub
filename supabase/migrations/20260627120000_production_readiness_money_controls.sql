-- Production readiness money controls:
-- - launch payment method defaults
-- - configurable withdrawal limits
-- - optional manual transfer references
-- - signed wallet ledger deltas for safe reversals

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS withdrawal_limits JSONB NOT NULL DEFAULT '{
    "crypto": {"minAmountEgp": 20, "maxAmountEgp": 10000, "dailyMaxAmountEgp": 20000},
    "instapay": {"minAmountEgp": 20, "maxAmountEgp": 10000, "dailyMaxAmountEgp": 20000},
    "paymob": {"minAmountEgp": 20, "maxAmountEgp": 10000, "dailyMaxAmountEgp": 20000}
  }'::jsonb;

UPDATE public.app_settings
SET payment_methods_enabled =
  COALESCE(payment_methods_enabled, '{}'::jsonb)
  || '{
    "deposit_crypto": true,
    "deposit_instapay": true,
    "withdrawal_crypto": true,
    "withdrawal_instapay": true,
    "deposit_card": false,
    "deposit_paymob": false,
    "withdrawal_paymob": false
  }'::jsonb,
  disable_crypto_deposits = false,
  disable_card_deposits = true;

ALTER TABLE public.deposit_requests
  ADD COLUMN IF NOT EXISTS transfer_reference TEXT;

ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS admin_transfer_reference TEXT;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS balance_delta NUMERIC(12,2);

UPDATE public.transactions
SET balance_delta = CASE
  WHEN type IN ('deposit', 'bonus', 'refund', 'commission', 'release') THEN amount
  WHEN type IN ('withdrawal', 'hold') THEN -amount
  ELSE balance_delta
END
WHERE balance_delta IS NULL;

ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS chk_transactions_completed_balance_delta;

ALTER TABLE public.transactions
  ADD CONSTRAINT chk_transactions_completed_balance_delta
  CHECK (status <> 'completed' OR balance_delta IS NOT NULL)
  NOT VALID;

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_method_created
  ON public.withdrawal_requests(user_id, withdrawal_method, created_at DESC);

