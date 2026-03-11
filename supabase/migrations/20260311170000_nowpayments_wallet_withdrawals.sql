-- ============================================================================
-- MohandisHub - v033: NOWPayments deposits + freelancer withdrawals
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) Deposit requests: provider metadata for NOWPayments
-- --------------------------------------------------------------------------
ALTER TABLE deposit_requests
  ADD COLUMN IF NOT EXISTS provider VARCHAR(40) NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS provider_payment_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS provider_invoice_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS provider_purchase_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS provider_parent_payment_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS provider_status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_deposit_requests_provider
  ON deposit_requests(provider);
CREATE INDEX IF NOT EXISTS idx_deposit_requests_provider_payment
  ON deposit_requests(provider_payment_id);

-- --------------------------------------------------------------------------
-- 2) Expert payout settings (used by freelancer withdrawals)
-- --------------------------------------------------------------------------
ALTER TABLE expert_profiles
  ADD COLUMN IF NOT EXISTS payout_currency VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payout_address TEXT,
  ADD COLUMN IF NOT EXISTS payout_extra_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS payout_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_expert_profiles_payout_currency
  ON expert_profiles(payout_currency);

-- --------------------------------------------------------------------------
-- 3) Withdrawal requests: async lifecycle tracking + idempotency
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  hold_id UUID REFERENCES wallet_holds(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(20) NOT NULL,
  payout_address TEXT,
  payout_extra_id VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'pending_verification'
    CHECK (
      status IN (
        'pending_verification',
        'processing',
        'finished',
        'failed',
        'rejected',
        'cancelled',
        'blocked'
      )
    ),
  provider VARCHAR(40) NOT NULL DEFAULT 'nowpayments',
  provider_batch_withdrawal_id VARCHAR(255),
  provider_withdrawal_id VARCHAR(255),
  provider_status VARCHAR(40),
  provider_error TEXT,
  provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification_required BOOLEAN NOT NULL DEFAULT true,
  verified_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user
  ON withdrawal_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status
  ON withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_batch
  ON withdrawal_requests(provider_batch_withdrawal_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_withdrawal
  ON withdrawal_requests(provider_withdrawal_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'trigger_set_updated_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_withdrawal_requests_updated_at'
      AND tgrelid = 'withdrawal_requests'::regclass
  ) THEN
    CREATE TRIGGER set_withdrawal_requests_updated_at
      BEFORE UPDATE ON withdrawal_requests
      FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
  END IF;
END $$;
